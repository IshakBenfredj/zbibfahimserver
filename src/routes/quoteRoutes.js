const express = require('express');
const router = express.Router();
const {
  createOrUpdateQuote,
  getQuotesForRequest,
  getMyQuotes,
  acceptQuote
} = require('../controllers/quoteController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// Seller submits or edits quote (also allows client/admin for testing)
router.post('/', protect, authorize('seller', 'admin', 'client'), createOrUpdateQuote);

// Get all quotes for a request (confidential prices handled inside controller)
router.get('/request/:requestId', protect, getQuotesForRequest);

// Client accepts quote
router.put('/:id/accept', protect, acceptQuote);
router.patch('/:id/accept', protect, acceptQuote);

// Seller lists all their submitted quotes
router.get('/my-offers', protect, authorize('seller', 'admin'), getMyQuotes);
router.get('/my', protect, authorize('seller', 'admin'), getMyQuotes);

module.exports = router;
