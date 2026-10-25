const express = require('express');
const router = express.Router();
const { addReview, getProviderReviews } = require('../controllers/reviewController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// Client / Authenticated User submits review
router.post('/', protect, addReview);

// Public gets reviews of a provider
router.get('/provider/:providerId', getProviderReviews);
router.get('/:providerId', getProviderReviews);

module.exports = router;
