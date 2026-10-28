const PartQuote = require('../models/PartQuote');
const SparePartRequest = require('../models/SparePartRequest');
const { notifyClientNewQuote } = require('../utils/socket');
const { getOsrmRoute, getOsrmDistanceBatch, calculateHaversineDistance, calculateDrivingDistance } = require('../utils/distance');
const { notifyNewQuote, notifyQuoteAccepted } = require('../utils/notificationDispatcher');

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

    // Calculate real-time road distance and duration between seller and client request via OpenStreetMap OSRM
    let liveDistanceKm = null;
    let liveDurationMin = null;
    if (
      req.user.location &&
      req.user.location.coordinates &&
      request.location &&
      request.location.coordinates
    ) {
      const [sellerLng, sellerLat] = req.user.location.coordinates;
      const [clientLng, clientLat] = request.location.coordinates;
      const route = await getOsrmRoute(sellerLng, sellerLat, clientLng, clientLat);
      if (route) {
        liveDistanceKm = route.distanceKm;
        liveDurationMin = route.durationMin;
      }
    }

    // REALTIME & PUSH: Dispatch instant notification to the client
    const updatedRequest = await SparePartRequest.findById(partRequestId);
    notifyNewQuote({
      recipientId: request.client.toString(),
      senderId: req.user.id,
      sellerName: req.user.businessName || req.user.fullName,
      partName: request.partName,
      price: quote.price,
      partRequestId: request._id,
      quoteId: quote._id
    });

    res.status(isNewQuote ? 201 : 200).json({
      success: true,
      message: 'تم إرسال عرضك بنجاح، يظهر سعرك للزبون صاحب الطلب حصراً وبسرية تامة / Offre envoyée avec succès',
      data: {
        ...quote.toObject(),
        distanceKm: liveDistanceKm,
        durationMin: liveDurationMin
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
    const request = await SparePartRequest.findById(req.params.requestId)
      .populate('client', 'fullName phone avatar address');
    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'طلب قطعة الغيار غير موجود / Demande introuvable'
      });
    }

    const clientId = request.client ? (request.client._id ? request.client._id.toString() : request.client.toString()) : '';
    const isRequestOwner = clientId === req.user.id;
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

    let sanitizedQuotes = [];

    if (isRequestOwner || isAdmin) {
      // Client sees all received quotes with real road distances & durations
      const destinations = allQuotes.map(q =>
        (q.seller && q.seller.location && q.seller.location.coordinates)
          ? q.seller.location.coordinates
          : null
      );
      const routes = (clientLng != null && clientLat != null)
        ? await getOsrmDistanceBatch(clientLng, clientLat, destinations)
        : allQuotes.map(() => null);

      sanitizedQuotes = allQuotes.map((q, idx) => {
        const quoteObj = q.toObject();
        quoteObj.isPriceHidden = false;
        quoteObj.isMyQuote = false;
        quoteObj.distanceKm = routes[idx] ? routes[idx].distanceKm : null;
        quoteObj.durationMin = routes[idx] ? routes[idx].durationMin : null;
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
        if (
          myQuote.seller &&
          myQuote.seller.location &&
          myQuote.seller.location.coordinates &&
          clientLng != null &&
          clientLat != null
        ) {
          const [sellerLng, sellerLat] = myQuote.seller.location.coordinates;
          const route = await getOsrmRoute(sellerLng, sellerLat, clientLng, clientLat);
          quoteObj.distanceKm = route ? route.distanceKm : null;
          quoteObj.durationMin = route ? route.durationMin : null;
        } else {
          quoteObj.distanceKm = null;
          quoteObj.durationMin = null;
        }

        // If this quote is accepted, attach client contact info so seller can call client!
        if (myQuote.status === 'accepted' && request.client) {
          quoteObj.clientName = request.client.fullName || '';
          quoteObj.clientPhone = request.client.phone || '';
          quoteObj.clientAvatar = request.client.avatar || '';
          quoteObj.clientAddress = request.client.address || '';
        }

        sanitizedQuotes = [quoteObj];
      } else {
        sanitizedQuotes = [];
      }
    }

    // Expose client info if client/admin OR if the seller's quote has been accepted
    const sellerQuote = sanitizedQuotes.find(q => q.isMyQuote);
    const sellerQuoteAccepted = sellerQuote && sellerQuote.status === 'accepted';
    const canSeeClientInfo = isRequestOwner || isAdmin || sellerQuoteAccepted;

    res.status(200).json({
      success: true,
      count: totalQuotesCount,
      isRequestOwner,
      requestStatus: request.status,
      request: {
        _id: request._id,
        partName: request.partName,
        carBrand: request.carBrand,
        carModel: request.carModel,
        carYear: request.carYear,
        description: request.description,
        referenceNumber: request.referenceNumber,
        photos: request.photos,
        status: request.status,
        quotesCount: totalQuotesCount,
        deliveryRequired: request.deliveryRequired,
        deliveryWilaya: request.deliveryWilaya,
        deliveryCommune: request.deliveryCommune,
        deliveryAddressDetails: request.deliveryAddressDetails,
        createdAt: request.createdAt,
        clientName: (canSeeClientInfo && request.client) ? request.client.fullName : '',
        clientPhone: (canSeeClientInfo && request.client) ? request.client.phone : '',
        clientAddress: (canSeeClientInfo && request.client) ? request.client.address : ''
      },
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
      .populate({
        path: 'partRequest',
        populate: {
          path: 'client',
          select: 'fullName phone avatar address wilaya commune'
        }
      })
      .sort({ createdAt: -1 });

    const formatted = quotes.map(q => {
      const obj = q.toObject();
      if (q.partRequest) {
        obj.requestPartName = q.partRequest.partName;
        obj.requestCarInfo = `${q.partRequest.carBrand || ''} ${q.partRequest.carModel || ''}${q.partRequest.carYear ? ` (${q.partRequest.carYear})` : ''}`.trim();
        obj.requestStatus = q.partRequest.status;
        obj.deliveryWilaya = q.partRequest.deliveryWilaya;
        obj.deliveryCommune = q.partRequest.deliveryCommune;
        obj.deliveryAddressDetails = q.partRequest.deliveryAddressDetails;
        
        // If accepted by the client, attach client name and phone so seller can contact client
        if (q.status === 'accepted' && q.partRequest.client) {
          obj.clientName = q.partRequest.client.fullName || '';
          obj.clientPhone = q.partRequest.client.phone || '';
          obj.clientAvatar = q.partRequest.client.avatar || '';
          obj.clientAddress = q.partRequest.client.address || '';
        }
      }
      return obj;
    });

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted
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

    // Mark all other competing quotes on this request as rejected
    await PartQuote.updateMany(
      {
        partRequest: quote.partRequest._id,
        _id: { $ne: quote._id },
        status: 'pending'
      },
      {
        status: 'rejected'
      }
    );

    // Mark the request as fulfilled
    await SparePartRequest.findByIdAndUpdate(quote.partRequest._id, {
      status: 'fulfilled'
    });

    // REALTIME & PUSH: Notify the seller that their quote was accepted
    notifyQuoteAccepted({
      sellerId: quote.seller.toString(),
      clientId: req.user.id,
      clientName: req.user.fullName,
      clientPhone: req.user.phone,
      partName: quote.partRequest.partName,
      price: quote.price,
      partRequestId: quote.partRequest._id,
      quoteId: quote._id
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

// @desc    Reject a quote by the client
// @route   PUT /api/quotes/:id/reject
// @access  Private (Client author)
exports.rejectQuote = async (req, res, next) => {
  try {
    const quote = await PartQuote.findById(req.params.id).populate('partRequest');
    if (!quote) {
      return res.status(404).json({
        success: false,
        message: 'العرض غير موجود / Offre introuvable'
      });
    }

    if (quote.partRequest.client.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك برفض هذا العرض / Non autorisé'
      });
    }

    quote.status = 'rejected';
    await quote.save();

    res.status(200).json({
      success: true,
      message: 'تم رفض العرض / Offre refusée',
      data: quote
    });
  } catch (err) {
    next(err);
  }
};

