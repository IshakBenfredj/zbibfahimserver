const express = require('express');
const router = express.Router();
const {
  createRequest,
  getMyRequests,
  getNearbyRequestsForSellers,
  getRequestById,
  updateRequestStatus
} = require('../controllers/partRequestController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');
const upload = require('../middlewares/uploadMiddleware');

const { getQuotesForRequest } = require('../controllers/quoteController');

// Client publishes request (max 5 photos, also open to seller/admin for testing)
router.post('/', protect, authorize('client', 'seller', 'admin'), upload.array('photos', 5), createRequest);

// Client views their own published requests
router.get('/my', protect, getMyRequests);

// Sellers view nearby requests to offer quotes
router.get('/nearby', protect, authorize('seller', 'admin', 'client'), getNearbyRequestsForSellers);

// Quotes for a request
router.get('/:requestId/quotes', protect, getQuotesForRequest);

// View single request
router.get('/:id', protect, getRequestById);

// Update status (e.g. mark fulfilled)
router.patch('/:id/status', protect, updateRequestStatus);

module.exports = router;
