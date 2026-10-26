const mongoose = require('mongoose');
const SparePartRequest = require('../models/SparePartRequest');
const { notifySellersNewRequest } = require('../utils/socket');
const { notifySellersNewPartRequestPushOnly } = require('../utils/notificationDispatcher');
const { getOsrmDistanceBatch } = require('../utils/distance');

// @desc    Create a new spare part search request (Realtime enabled)
// @route   POST /api/requests
// @access  Private (Client only)
exports.createRequest = async (req, res, next) => {
  try {
    const {
      partName,
      carBrand,
      carModel,
      carYear,
      description,
      referenceNumber,
      latitude,
      longitude,
      address,
      deliveryRequired,
      deliveryWilaya,
      deliveryCommune,
      deliveryAddressDetails
    } = req.body;

    // Collect uploaded photos if any or from request body
    let photos = [];
    if (req.files && req.files.length > 0) {
      photos = req.files.map(file => `/uploads/${file.filename}`);
    } else if (req.body.photos) {
      if (Array.isArray(req.body.photos)) {
        photos = req.body.photos;
      } else if (typeof req.body.photos === 'string') {
        try {
          const parsed = JSON.parse(req.body.photos);
          if (Array.isArray(parsed)) photos = parsed;
          else photos = [req.body.photos];
        } catch (_) {
          photos = [req.body.photos];
        }
      }
    }

    let location = { type: 'Point', coordinates: [3.0588, 36.7538] };
    if (longitude && latitude) {
      location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      };
    } else if (req.user.location && req.user.location.coordinates) {
      location = req.user.location;
    }

    const isDelivery = deliveryRequired === true || deliveryRequired === 'true';

    const request = await SparePartRequest.create({
      client: req.user.id,
      partName,
      carBrand,
      carModel,
      carYear: carYear ? parseInt(carYear) : null,
      description: description || '',
      referenceNumber: referenceNumber || '',
      photos,
      location,
      address: address || req.user.address || '',
      deliveryRequired: isDelivery,
      deliveryWilaya: isDelivery ? (deliveryWilaya || '') : '',
      deliveryCommune: isDelivery ? (deliveryCommune || '') : '',
      deliveryAddressDetails: isDelivery ? (deliveryAddressDetails || '') : ''
    });

    // REALTIME: Notify all listening spare parts sellers
    notifySellersNewRequest({
      requestId: request._id,
      partName: request.partName,
      carBrand: request.carBrand,
      carModel: request.carModel,
      carYear: request.carYear,
      description: request.description,
      location: request.location,
      clientName: req.user.fullName,
      deliveryRequired: request.deliveryRequired,
      deliveryWilaya: request.deliveryWilaya,
      deliveryCommune: request.deliveryCommune,
      deliveryAddressDetails: request.deliveryAddressDetails,
      createdAt: request.createdAt
    });

    // PUSH NOTIFICATION: Alert sellers on their phones ONLY (without saving to database)
    notifySellersNewPartRequestPushOnly({
      requestId: request._id,
      partName: request.partName,
      carBrand: request.carBrand,
      carModel: request.carModel,
      carYear: request.carYear,
      address: request.address,
      clientLocation: request.location
    });

    res.status(201).json({
      success: true,
      message: 'تم نشر طلب قطعة الغيار بنجاح، ستصلك عروض المحلات القريبة / Demande publiée avec succès',
      data: request
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get requests published by current logged-in client
// @route   GET /api/requests/my
// @access  Private (Client)
exports.getMyRequests = async (req, res, next) => {
  try {
    const requests = await SparePartRequest.find({ client: req.user.id })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get nearby spare part requests for sellers ($geoNear)
// @route   GET /api/requests/nearby
// @access  Private (Seller only)
exports.getNearbyRequestsForSellers = async (req, res, next) => {
  try {
    const {
      longitude,
      latitude,
      maxDistance = 100, // in km
      carBrand
    } = req.query;

    const sellerLng = parseFloat(longitude) || (req.user.location ? req.user.location.coordinates[0] : 3.0588);
    const sellerLat = parseFloat(latitude) || (req.user.location ? req.user.location.coordinates[1] : 36.7538);
    
    // Support unlimited All Algeria range
    const isUnlimited = maxDistance === 'all' || maxDistance === 'unlimited' || (!maxDistance && maxDistance !== 0) || parseFloat(maxDistance) >= 2000;
    const maxMeters = isUnlimited ? null : ((parseFloat(maxDistance) || 100) * 1000);

    const matchStage = {
      status: 'open',
      client: { $ne: new mongoose.Types.ObjectId(req.user.id) }
    };
    if (carBrand) {
      matchStage.carBrand = { $regex: carBrand, $options: 'i' };
    }

    const geoNearStage = {
      near: {
        type: 'Point',
        coordinates: [sellerLng, sellerLat]
      },
      distanceField: 'distanceMeters',
      spherical: true,
      query: matchStage
    };
    if (maxMeters !== null) {
      geoNearStage.maxDistance = maxMeters;
    }

    const requests = await SparePartRequest.aggregate([
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
        $lookup: {
          from: 'users',
          localField: 'client',
          foreignField: '_id',
          as: 'clientDetails'
        }
      },
      {
        $unwind: {
          path: '$clientDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          partName: 1,
          carBrand: 1,
          carModel: 1,
          carYear: 1,
          description: 1,
          referenceNumber: 1,
          photos: 1,
          location: 1,
          address: 1,
          status: 1,
          quotesCount: 1,
          distanceKm: 1,
          createdAt: 1,
          client: 1,
          deliveryRequired: 1,
          deliveryWilaya: 1,
          deliveryCommune: 1,
          deliveryAddressDetails: 1,
          'clientDetails.fullName': 1,
          'clientDetails.phone': 1,
          'clientDetails.avatar': 1
        }
      },
      {
        $sort: { distanceMeters: 1, createdAt: -1 }
      }
    ]);

    // Calculate accurate OpenStreetMap OSRM road distance & duration
    if (requests && requests.length > 0) {
      const destinations = requests.map(r =>
        (r.location && r.location.coordinates) ? r.location.coordinates : null
      );
      const routes = await getOsrmDistanceBatch(sellerLng, sellerLat, destinations);
      requests.forEach((r, idx) => {
        if (routes[idx]) {
          r.distanceKm = routes[idx].distanceKm;
          r.durationMin = routes[idx].durationMin;
        }
      });
      // Sort by real road driving distance
      requests.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }

    res.status(200).json({
      success: true,
      count: requests.length,
      data: requests
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get single request by ID
// @route   GET /api/requests/:id
// @access  Private
exports.getRequestById = async (req, res, next) => {
  try {
    const request = await SparePartRequest.findById(req.params.id)
      .populate('client', 'fullName phone avatar');

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'الطلب غير موجود / Demande introuvable'
      });
    }

    res.status(200).json({
      success: true,
      data: request
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update request status (fulfilled / cancelled)
// @route   PATCH /api/requests/:id/status
// @access  Private (Client author)
exports.updateRequestStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const request = await SparePartRequest.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'الطلب غير موجود / Demande introuvable'
      });
    }

    // Ensure only the request owner can close it
    if (request.client.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بتعديل هذا الطلب / Non autorisé'
      });
    }

    request.status = status || 'fulfilled';
    await request.save();

    res.status(200).json({
      success: true,
      message: 'تم تحديث حالة الطلب بنجاح / Statut de la demande mis à jour',
      data: request
    });
  } catch (err) {
    next(err);
  }
};
