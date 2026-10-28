const User = require('../models/User');
const { getOsrmDistanceBatch } = require('../utils/distance');
const { computeShopOpenStatus } = require('../utils/scheduleHelper');

// @desc    Get nearby service providers / spare parts shops with accurate distance in km ($geoNear)
// @route   GET /api/providers/nearby
// @access  Public
exports.getNearbyProviders = async (req, res, next) => {
  try {
    const {
      longitude,
      latitude,
      role, // mechanic | electrician | seller
      maxDistance = 50, // in kilometers
      deliveryOnly,
      search,
      brand
    } = req.query;

    const userLng = parseFloat(longitude) || 3.0588; // Default Algiers
    const userLat = parseFloat(latitude) || 36.7538;
    
    // Support unlimited All Algeria range
    const isUnlimited = maxDistance === 'all' || maxDistance === 'unlimited' || (!maxDistance && maxDistance !== 0) || parseFloat(maxDistance) >= 2000;
    const maxMeters = isUnlimited ? null : ((parseFloat(maxDistance) || 50) * 1000);

    const matchStage = {
      isActive: true,
      hasLocationSet: true,
      role: { $in: ['mechanic', 'electrician', 'seller'] }
    };

    if (role) {
      matchStage.role = role;
    }

    if (deliveryOnly === 'true') {
      matchStage.deliveryAvailable = true;
    }

    if (brand) {
      matchStage.brandsSupported = { $regex: brand, $options: 'i' };
    }

    if (search) {
      matchStage.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { businessName: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { 'services.title': { $regex: search, $options: 'i' } }
      ];
    }

    const geoNearStage = {
      near: {
        type: 'Point',
        coordinates: [userLng, userLat]
      },
      distanceField: 'distanceMeters',
      spherical: true,
      query: matchStage
    };
    if (maxMeters !== null) {
      geoNearStage.maxDistance = maxMeters;
    }

    const providers = await User.aggregate([
      {
        $geoNear: geoNearStage
      },
      {
        $addFields: {
          straightKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 1] },
          distanceKm: {
            $round: [
              {
                $multiply: [
                  { $divide: ['$distanceMeters', 1000] },
                  {
                    $cond: [
                      { $lt: ['$distanceMeters', 5000] },
                      1.25,
                      {
                        $cond: [
                          { $lt: ['$distanceMeters', 25000] },
                          1.35,
                          1.42
                        ]
                      }
                    ]
                  }
                ]
              },
              1
            ]
          }
        }
      },
      {
        $project: {
          password: 0,
          __v: 0
        }
      },
      {
        $sort: { distanceMeters: 1 }
      }
    ]);

    // Calculate accurate OpenStreetMap OSRM road distance & duration
    if (providers && providers.length > 0) {
      const destinations = providers.map(p =>
        (p.location && p.location.coordinates) ? p.location.coordinates : null
      );
      const routes = await getOsrmDistanceBatch(userLng, userLat, destinations);
      providers.forEach((p, idx) => {
        if (routes[idx]) {
          p.distanceKm = routes[idx].distanceKm;
          p.durationMin = routes[idx].durationMin;
        }
        const openStatus = computeShopOpenStatus(p);
        p.isOpen = openStatus.isOpen;
        p.openReason = openStatus.reason;
        p.openStatusTextAr = openStatus.statusTextAr;
        p.openStatusTextFr = openStatus.statusTextFr;
      });
      // Sort by real road driving distance
      providers.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    } else if (providers) {
      providers.forEach(p => {
        const openStatus = computeShopOpenStatus(p);
        p.isOpen = openStatus.isOpen;
        p.openReason = openStatus.reason;
        p.openStatusTextAr = openStatus.statusTextAr;
        p.openStatusTextFr = openStatus.statusTextFr;
      });
    }

    res.status(200).json({
      success: true,
      count: providers.length,
      data: providers
    });
  } catch (err) {
    console.error('[Nearby Providers Aggregation Error]:', err.message);
    try {
      const fallbackQuery = {
        isActive: true,
        role: { $in: ['mechanic', 'electrician', 'seller'] }
      };
      if (req.query.role) fallbackQuery.role = req.query.role;
      const fallbackProviders = await User.find(fallbackQuery)
        .select('-password -__v')
        .limit(50);

      if (fallbackProviders && fallbackProviders.length > 0) {
        const destinations = fallbackProviders.map(p =>
          (p.location && p.location.coordinates) ? p.location.coordinates : null
        );
        const routes = await getOsrmDistanceBatch(userLng, userLat, destinations);
        const formatted = fallbackProviders.map((p, idx) => {
          const obj = p.toObject();
          obj.distanceKm = routes[idx] ? routes[idx].distanceKm : 10.0;
          obj.durationMin = routes[idx] ? routes[idx].durationMin : null;
          const openStatus = computeShopOpenStatus(p);
          obj.isOpen = openStatus.isOpen;
          obj.openReason = openStatus.reason;
          obj.openStatusTextAr = openStatus.statusTextAr;
          obj.openStatusTextFr = openStatus.statusTextFr;
          return obj;
        });
        formatted.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
        return res.status(200).json({
          success: true,
          count: formatted.length,
          data: formatted,
          isFallback: true
        });
      }

      return res.status(200).json({
        success: true,
        count: fallbackProviders.length,
        data: fallbackProviders,
        isFallback: true
      });
    } catch (_) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: []
      });
    }
  }
};

// @desc    Get single provider details by ID
// @route   GET /api/providers/:id
// @access  Public
exports.getProviderById = async (req, res, next) => {
  try {
    const provider = await User.findById(req.params.id).select('-password');

    if (!provider || !['mechanic', 'electrician', 'seller'].includes(provider.role)) {
      return res.status(404).json({
        success: false,
        message: 'مقدم الخدمة غير موجود / Prestataire introuvable'
      });
    }

    const providerObj = provider.toObject();
    const openStatus = computeShopOpenStatus(provider);
    providerObj.isOpen = openStatus.isOpen;
    providerObj.openReason = openStatus.reason;
    providerObj.openStatusTextAr = openStatus.statusTextAr;
    providerObj.openStatusTextFr = openStatus.statusTextFr;

    res.status(200).json({
      success: true,
      data: providerObj
    });
  } catch (err) {
    next(err);
  }
};
