const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  getAllUsers,
  toggleUserStatus,
  updateUserSubscription,
  resetAllVerifications,
  deleteUserByAdmin,
  getAllRequests,
  updateRequestStatus,
  deleteRequest,
  getAllReviews,
  deleteReview,
  broadcastNotification,
  createPaymentRecord,
  getAllPaymentRecords,
  deletePaymentRecord,
  exportUsersCsv,
  exportRequestsCsv,
  exportPaymentsCsv,
  getAllReports,
  updateReportStatus,
  deleteReport
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
router.patch('/users/:id/subscription', updateUserSubscription);
router.delete('/users/:id', deleteUserByAdmin);
router.post('/users/reset-verifications', resetAllVerifications);

// 3. Requests Moderation
router.get('/requests', getAllRequests);
router.patch('/requests/:id/status', updateRequestStatus);
router.delete('/requests/:id', deleteRequest);

// 4. Reviews Moderation
router.get('/reviews', getAllReviews);
router.delete('/reviews/:id', deleteReview);

// 5. Broadcast Push Notifications
router.post('/broadcast-notification', broadcastNotification);

// 6. Payment Ledger & Subscriptions
router.get('/payments', getAllPaymentRecords);
router.post('/payments', createPaymentRecord);
router.delete('/payments/:id', deletePaymentRecord);

// 7. CSV Exports (Excel UTF-8)
router.get('/export/users', exportUsersCsv);
router.get('/export/requests', exportRequestsCsv);
router.get('/export/payments', exportPaymentsCsv);

// 8. Disputes & Reports Moderation
router.get('/reports', getAllReports);
router.patch('/reports/:id', updateReportStatus);
router.delete('/reports/:id', deleteReport);

module.exports = router;
