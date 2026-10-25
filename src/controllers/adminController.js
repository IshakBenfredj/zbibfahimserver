const User = require('../models/User');
const SparePartRequest = require('../models/SparePartRequest');
const PartQuote = require('../models/PartQuote');
const Review = require('../models/Review');

// @desc    Get Admin Dashboard Analytics & Overview Stats
// @route   GET /api/admin/stats
// @access  Private (Admin)
exports.getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalClients,
      totalSellers,
      totalMechanics,
      totalElectricians,
      frozenUsers,
      totalRequests,
      openRequests,
      fulfilledRequests,
      totalQuotes,
      acceptedQuotes,
      totalReviews
    ] = await Promise.all([
      User.countDocuments({ role: 'client' }),
      User.countDocuments({ role: 'seller' }),
      User.countDocuments({ role: 'mechanic' }),
      User.countDocuments({ role: 'electrician' }),
      User.countDocuments({ isActive: false }),
      SparePartRequest.countDocuments(),
      SparePartRequest.countDocuments({ status: 'open' }),
      SparePartRequest.countDocuments({ status: 'fulfilled' }),
      PartQuote.countDocuments(),
      PartQuote.countDocuments({ isAccepted: true }),
      Review.countDocuments(),
    ]);

    const totalUsers = totalClients + totalSellers + totalMechanics + totalElectricians;
    const totalProviders = totalSellers + totalMechanics + totalElectricians;

    // Recent 5 requests
    const recentRequests = await SparePartRequest.find()
      .populate('client', 'fullName phone')
      .sort({ createdAt: -1 })
      .limit(5);

    // Recent 5 users
    const recentUsers = await User.find()
      .select('fullName phone role businessName address isActive isVerified createdAt')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          clients: totalClients,
          sellers: totalSellers,
          mechanics: totalMechanics,
          electricians: totalElectricians,
          providers: totalProviders,
          frozen: frozenUsers,
        },
        requests: {
          total: totalRequests,
          open: openRequests,
          fulfilled: fulfilledRequests,
        },
        quotes: {
          total: totalQuotes,
          accepted: acceptedQuotes,
        },
        reviews: {
          total: totalReviews,
        },
        recentRequests,
        recentUsers,
      }
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get All Users with search, role filter, status filter
// @route   GET /api/admin/users
// @access  Private (Admin)
exports.getAllUsers = async (req, res, next) => {
  try {
    const { role, search, status, isVerified, page = 1, limit = 50 } = req.query;

    const query = {};

    if (role && role !== 'all') {
      query.role = role;
    }

    if (status === 'active') {
      query.isActive = true;
    } else if (status === 'frozen') {
      query.isActive = false;
    } else if (status === 'verified') {
      query.isVerified = true;
    } else if (status === 'unverified') {
      query.isVerified = false;
    }

    if (isVerified !== undefined) {
      query.isVerified = isVerified === 'true' || isVerified === true;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { fullName: regex },
        { phone: regex },
        { businessName: regex },
        { address: regex }
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('fullName phone role businessName address location rating reviewsCount isActive isVerified createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      data: users
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Toggle User Active / Freeze status or verify
// @route   PATCH /api/admin/users/:id/status
// @access  Private (Admin)
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const { isActive, isVerified } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'المستخدم غير موجود / Utilisateur non trouvé'
      });
    }

    if (isActive !== undefined) {
      user.isActive = Boolean(isActive);
    }
    if (isVerified !== undefined) {
      user.isVerified = Boolean(isVerified);
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: user.isActive
          ? 'تم تفعيل الحساب بنجاح / Compte activé avec succès'
          : 'تم تجميد وتعطيل الحساب / Compte suspendu avec succès',
      data: user
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get All Spare Part Requests (Admin monitoring)
// @route   GET /api/admin/requests
// @access  Private (Admin)
exports.getAllRequests = async (req, res, next) => {
  try {
    const { status, search } = req.query;
    const query = {};

    if (status && status !== 'all') {
      query.status = status;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { partName: regex },
        { 'carInfo.make': regex },
        { 'carInfo.model': regex },
        { description: regex }
      ];
    }

    const requests = await SparePartRequest.find(query)
      .populate('client', 'fullName phone')
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

// @desc    Update Request status (open / fulfilled / cancelled)
// @route   PATCH /api/admin/requests/:id/status
// @access  Private (Admin)
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

    if (['open', 'fulfilled', 'cancelled'].includes(status)) {
      request.status = status;
      await request.save();
    }

    res.status(200).json({
      success: true,
      message: 'تم تحديث حالة الطلب بنجاح / Statut mis à jour',
      data: request
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete a request (Admin moderation)
// @route   DELETE /api/admin/requests/:id
// @access  Private (Admin)
exports.deleteRequest = async (req, res, next) => {
  try {
    const request = await SparePartRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'الطلب غير موجود / Demande introuvable'
      });
    }

    // Delete associated quotes
    await PartQuote.deleteMany({ partRequest: request._id });
    await request.deleteOne();

    res.status(200).json({
      success: true,
      message: 'تم حذف الطلب وعروضه بنجاح / Demande supprimée'
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get All Reviews for monitoring
// @route   GET /api/admin/reviews
// @access  Private (Admin)
exports.getAllReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find()
      .populate('client', 'fullName phone avatar')
      .populate('provider', 'fullName businessName role')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: reviews.length,
      data: reviews
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete an abusive review (Admin moderation)
// @route   DELETE /api/admin/reviews/:id
// @access  Private (Admin)
exports.deleteReview = async (req, res, next) => {
  try {
    const review = await Review.findOneAndDelete({ _id: req.params.id });
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'المراجعة غير موجودة / Avis introuvable'
      });
    }

    res.status(200).json({
      success: true,
      message: 'تم حذف التقييم وتحديث متوسط تقييم المحل تلقائياً / Avis supprimé avec succès'
    });
  } catch (err) {
    next(err);
  }
};
