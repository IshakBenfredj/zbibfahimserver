const Review = require('../models/Review');
const User = require('../models/User');

// @desc    Add or update a rating & review for a provider
// @route   POST /api/reviews
// @access  Private (Client only)
exports.addReview = async (req, res, next) => {
  try {
    const { providerId, rating, comment } = req.body;

    if (!providerId || !rating) {
      return res.status(400).json({
        success: false,
        message: 'يرجى تحديد مقدم الخدمة والتقييم بالنجوم / Fournisseur et note requis'
      });
    }

    const provider = await User.findById(providerId);
    if (!provider || !['mechanic', 'electrician', 'seller'].includes(provider.role)) {
      return res.status(404).json({
        success: false,
        message: 'مقدم الخدمة غير موجود / Prestataire introuvable'
      });
    }

    // Prevent reviewing oneself
    if (providerId === req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'لا يمكنك تقييم نفسك / Vous ne pouvez pas vous évaluer vous-même'
      });
    }

    // Upsert review (update if client already reviewed this provider)
    let review = await Review.findOne({
      client: req.user.id,
      provider: providerId
    });

    if (review) {
      review.rating = Number(rating);
      review.comment = comment || '';
      await review.save();
    } else {
      review = await Review.create({
        client: req.user.id,
        provider: providerId,
        rating: Number(rating),
        comment: comment || ''
      });
    }

    await review.populate('client', 'fullName avatar');
    const updatedProvider = await User.findById(providerId).select('rating reviewsCount');

    res.status(200).json({
      success: true,
      message: 'شكراً لك، تم تسجيل تقييمك بنجاح / Merci, votre avis a été enregistré',
      data: review,
      providerRating: updatedProvider ? updatedProvider.rating : 5.0,
      providerReviewsCount: updatedProvider ? updatedProvider.reviewsCount : 1
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get all reviews for a provider
// @route   GET /api/reviews/provider/:providerId
// @access  Public
exports.getProviderReviews = async (req, res, next) => {
  try {
    const reviews = await Review.find({ provider: req.params.providerId })
      .populate('client', 'fullName avatar')
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
