const PartQuote = require('../models/PartQuote');
const SparePartRequest = require('../models/SparePartRequest');
const { notifyClientNewQuote } = require('../utils/socket');

// Helper to calculate approximate distance in kilometers between two geo coordinates (Haversine)
function calculateHaversineDistance(lon1, lat1, lon2, lat2) {
  if (lon1 == null || lat1 == null || lon2 == null || lat2 == null) return null;
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

// @desc    Submit or update a quote/offer for a spare part request (Realtime enabled)
// @route   POST /api/quotes
// @access  Private (Seller only)
exports.createOrUpdateQuote = async (req, res, next) => {
  try {
    const { partRequestId, price, notes, deliveryAvailable } = req.body;

    const request = await SparePartRequest.findById(partRequestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'طلب قطعة الغيار غير موجود / Demande introuvable'
      });
    }

    if (request.status !== 'open') {
      return res.status(400).json({
        success: false,
        message: 'هذا الطلب مغلق أو تم تلبيته مسبقاً / Cette demande est déjà clôturée'
      });
    }

    // Upsert quote (create if new, update if already quoted)
    let quote = await PartQuote.findOne({
      partRequest: partRequestId,
      seller: req.user.id
    });

    const isNewQuote = !quote;

    if (quote) {
      quote.price = price !== undefined ? parseFloat(price) : quote.price;
      quote.notes = notes !== undefined ? notes : quote.notes;
      quote.deliveryAvailable = deliveryAvailable !== undefined ? deliveryAvailable : quote.deliveryAvailable;
      await quote.save();
    } else {
      quote = await PartQuote.create({
        partRequest: partRequestId,
        seller: req.user.id,
        price: price !== undefined && price !== '' ? parseFloat(price) : null,
        notes: notes || '',
        deliveryAvailable: deliveryAvailable === true || deliveryAvailable === 'true'
      });

      // Increment quotes count on the request
      await SparePartRequest.findByIdAndUpdate(partRequestId, {
        $inc: { quotesCount: 1 }
      });
    }

    // Calculate real-time distance between seller and client request
    let liveDistanceKm = null;
    if (
      req.user.location &&
      req.user.location.coordinates &&
      request.location &&
      request.location.coordinates
    ) {
      const [sellerLng, sellerLat] = req.user.location.coordinates;
      const [clientLng, clientLat] = request.location.coordinates;
      liveDistanceKm = calculateHaversineDistance(sellerLng, sellerLat, clientLng, clientLat);
    }

    // REALTIME: Dispatch instant socket notification to the client
    const updatedRequest = await SparePartRequest.findById(partRequestId);
    notifyClientNewQuote(request.client.toString(), {
      quoteId: quote._id,
      partRequestId: request._id,
      partName: request.partName,
      price: quote.price,
      notes: quote.notes,
      deliveryAvailable: quote.deliveryAvailable,
      sellerName: req.user.businessName || req.user.fullName,
      sellerRating: req.user.rating,
      sellerPhone: req.user.phone,
      sellerAvatar: req.user.avatar,
      sellerVerified: req.user.isVerified || false,
      distanceKm: liveDistanceKm,
      quotesCount: updatedRequest ? updatedRequest.quotesCount : 1,
      createdAt: quote.createdAt
    });

    res.status(isNewQuote ? 201 : 200).json({
      success: true,
      message: 'تم إرسال عرضك بنجاح، يظهر سعرك للزبون صاحب الطلب حصراً وبسرية تامة / Offre envoyée avec succès',
      data: {
        ...quote.toObject(),
        distanceKm: liveDistanceKm
      }
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get all quotes for a specific request with STRICT price confidentiality & realtime distance
// @route   GET /api/quotes/request/:requestId
// @access  Private (Client author or Sellers)
exports.getQuotesForRequest = async (req, res, next) => {
  try {
    const request = await SparePartRequest.findById(req.params.requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'طلب قطعة الغيار غير موجود / Demande introuvable'
      });
    }

    const isRequestOwner = request.client.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';

    // Support live user GPS location if passed in query params, or fallback to request location
    const clientLng = req.query.longitude
      ? parseFloat(req.query.longitude)
      : (request.location ? request.location.coordinates[0] : null);
    const clientLat = req.query.latitude
      ? parseFloat(req.query.latitude)
      : (request.location ? request.location.coordinates[1] : null);

    // Fetch all quotes for this request
    const allQuotes = await PartQuote.find({ partRequest: req.params.requestId })
      .populate('seller', 'fullName businessName phone address location rating reviewsCount avatar deliveryAvailable isVerified')
      .sort({ createdAt: -1 });

    const totalQuotesCount = allQuotes.length;

    // STRICT CONFIDENTIALITY RULE:
    // If user is NOT the request owner and NOT an admin (i.e. is a seller):
    // The seller is ONLY allowed to see the count of quotes and their OWN quote (if they submitted one).
    // Other competing quotes are completely excluded from the payload!
    let sanitizedQuotes = [];

    if (isRequestOwner || isAdmin) {
      // Client sees all received quotes with distances
      sanitizedQuotes = allQuotes.map(q => {
        const quoteObj = q.toObject();
        quoteObj.isPriceHidden = false;
        quoteObj.isMyQuote = false;

        if (
          q.seller &&
          q.seller.location &&
          q.seller.location.coordinates &&
          clientLng != null &&
          clientLat != null
        ) {
          const [sellerLng, sellerLat] = q.seller.location.coordinates;
          quoteObj.distanceKm = calculateHaversineDistance(sellerLng, sellerLat, clientLng, clientLat);
        } else {
          quoteObj.distanceKm = null;
        }

        return quoteObj;
      });
    } else {
      // Seller view: ONLY return this seller's own quote if it exists
      const myQuote = allQuotes.find(
        q => q.seller && q.seller._id.toString() === req.user.id
      );
      if (myQuote) {
        const quoteObj = myQuote.toObject();
        quoteObj.isPriceHidden = false;
        quoteObj.isMyQuote = true;
        sanitizedQuotes = [quoteObj];
      } else {
        sanitizedQuotes = [];
      }
    }

    res.status(200).json({
      success: true,
      count: totalQuotesCount, // Seller only sees the number of quotes!
      isRequestOwner,
      data: sanitizedQuotes
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get quotes submitted by the logged-in seller
// @route   GET /api/quotes/my-offers
// @access  Private (Seller only)
exports.getMyQuotes = async (req, res, next) => {
  try {
    const quotes = await PartQuote.find({ seller: req.user.id })
      .populate('partRequest')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: quotes.length,
      data: quotes
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Accept a quote by the client
// @route   PUT /api/quotes/:id/accept
// @access  Private (Client author)
exports.acceptQuote = async (req, res, next) => {
  try {
    const quote = await PartQuote.findById(req.params.id).populate('partRequest');
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'العرض غير موجود / Offre introuvable'
      });
    }

    // Verify current user is the owner of the request or an admin
    if (quote.partRequest.client.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بقبول هذا العرض / Non autorisé'
      });
    }

    quote.status = 'accepted';
    await quote.save();

    // Mark the request as fulfilled
    await SparePartRequest.findByIdAndUpdate(quote.partRequest._id, {
      status: 'fulfilled'
    });

    res.status(200).json({
      success: true,
      message: 'تم قبول العرض بنجاح وإغلاق الطلب / Offre acceptée avec succès',
      data: quote
    });
  } catch (err) {
    next(err);
  }
};

