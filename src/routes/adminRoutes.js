const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getAllUsers,
  toggleUserStatus,
  resetAllVerifications,
  getAllRequests,
  updateRequestStatus,
  deleteRequest,
  getAllReviews,
  deleteReview
} = require('../controllers/adminController');
const { protect } = require('../middlewares/authMiddleware');
const { authorize } = require('../middlewares/roleMiddleware');

// All admin routes require authentication and admin role (or testing override)
router.use(protect);
router.use(authorize('admin'));

// 1. Analytics & Overview Stats
router.get('/stats', getDashboardStats);

// 2. Users Management
router.get('/users', getAllUsers);
router.patch('/users/:id/status', toggleUserStatus);
router.post('/users/reset-verifications', resetAllVerifications);

// 3. Requests Moderation
router.get('/requests', getAllRequests);
router.patch('/requests/:id/status', updateRequestStatus);
router.delete('/requests/:id', deleteRequest);

// 4. Reviews Moderation
router.get('/reviews', getAllReviews);
router.delete('/reviews/:id', deleteReview);

module.exports = router;
