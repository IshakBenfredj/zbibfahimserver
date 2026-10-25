const Notification = require('../models/Notification');
const User = require('../models/User');

// @desc    Get current user's notifications
// @route   GET /api/notifications
// @access  Private
exports.getMyNotifications = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip = (page - 1) * limit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find({ recipient: req.user.id })
        .populate('sender', 'fullName businessName avatar role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments({ recipient: req.user.id }),
      Notification.countDocuments({ recipient: req.user.id, isRead: false })
    ]);

    res.status(200).json({
      success: true,
      count: notifications.length,
      total,
      unreadCount,
      data: notifications
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Mark single notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
exports.markNotificationAsRead = async (req, res, next) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipient: req.user.id },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'الإشعار غير موجود / Notification introuvable'
      });
    }

    res.status(200).json({
      success: true,
      data: notification
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Mark all user's notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
exports.markAllNotificationsAsRead = async (req, res, next) => {
  try {
    await Notification.updateMany(
      { recipient: req.user.id, isRead: false },
      { isRead: true }
    );

    res.status(200).json({
      success: true,
      message: 'تم تحديد جميع الإشعارات كمقروءة / Toutes les notifications sont marquées comme lues'
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get unread notifications count
// @route   GET /api/notifications/unread-count
// @access  Private
exports.getUnreadCount = async (req, res, next) => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user.id,
      isRead: false
    });

    res.status(200).json({
      success: true,
      unreadCount: count
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Save/update device FCM push token for logged-in user
// @route   PUT /api/notifications/fcm-token
// @access  Private
exports.saveFcmToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'رمز الجهاز مطلوب / Token requis'
      });
    }

    await User.findByIdAndUpdate(req.user.id, {
      fcmToken: token
    });

    res.status(200).json({
      success: true,
      message: 'تم حفظ رمز الإشعارات للهاتف بنجاح / Token FCM enregistré'
    });
  } catch (err) {
    next(err);
  }
};
