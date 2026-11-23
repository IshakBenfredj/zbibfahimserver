const User = require('../models/User');
const SparePartRequest = require('../models/SparePartRequest');
const PartQuote = require('../models/PartQuote');
const Review = require('../models/Review');
const PaymentRecord = require('../models/PaymentRecord');
const Report = require('../models/Report');
const { broadcastPushNotification } = require('../utils/notificationDispatcher');

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
      totalReviews,
      totalPayments,
      pendingReports
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
      PaymentRecord.countDocuments(),
      Report.countDocuments({ status: 'pending' })
    ]);

    const revenueResult = await PaymentRecord.aggregate([
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

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
        payments: {
          totalCount: totalPayments,
          totalRevenue: totalRevenue,
        },
        reports: {
          pendingCount: pendingReports,
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
    } else if (status === 'expired') {
      query.role = { $in: ['seller', 'mechanic', 'electrician'] };
      query.subscriptionExpiresAt = { $lt: new Date() };
    } else if (status === 'subscribed') {
      query.role = { $in: ['seller', 'mechanic', 'electrician'] };
      query.subscriptionExpiresAt = { $gt: new Date() };
    }

    if (isVerified !== undefined) {
      query.isVerified = isVerified === 'true' || isVerified === true;
    }

    if (search && search.trim()) {
      const regex = new RegExp(search.trim(), 'i');
      query.$or = [
        { fullName: regex },
        { phone: regex },
        { email: regex },
        { businessName: regex },
        { address: regex }
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('fullName phone email role businessName address location rating reviewsCount isActive isVerified subscriptionType subscriptionExpiresAt createdAt')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const userList = users.map(u => {
      const obj = u.toObject();
      obj.isSubscriptionExpired = typeof u.isSubscriptionExpired === 'function' ? u.isSubscriptionExpired() : false;
      obj.subscriptionRemainingSeconds = typeof u.getSubscriptionRemainingSeconds === 'function' ? u.getSubscriptionRemainingSeconds() : null;
      return obj;
    });

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      data: userList
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

// @desc    Update / Renew User Subscription (Admin)
// @route   PATCH /api/admin/users/:id/subscription
// @access  Private (Admin)
exports.updateUserSubscription = async (req, res, next) => {
  try {
    const { durationMinutes, durationDays, subscriptionType = 'paid' } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'المستخدم غير موجود / Utilisateur non trouvé'
      });
    }

    let additionalMs = 0;
    if (durationMinutes) {
      additionalMs = parseInt(durationMinutes, 10) * 60 * 1000;
    } else if (durationDays) {
      additionalMs = parseInt(durationDays, 10) * 24 * 60 * 60 * 1000;
    } else {
      // Default 30 days
      additionalMs = 30 * 24 * 60 * 60 * 1000;
    }

    // If currently active and not expired, extend from existing expiration; otherwise start from now
    const baseDate = (user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) > new Date())
      ? new Date(user.subscriptionExpiresAt)
      : new Date();

    user.subscriptionExpiresAt = new Date(baseDate.getTime() + additionalMs);
    user.subscriptionType = subscriptionType; // 'paid' or 'trial'
    user.isActive = true; // Automatically unfreeze/activate if frozen
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تفعيل وتجديد الاشتراك بنجاح / Abonnement activé avec succès',
      data: {
        id: user._id,
        subscriptionType: user.subscriptionType,
        subscriptionExpiresAt: user.subscriptionExpiresAt,
        isSubscriptionExpired: user.isSubscriptionExpired(),
        subscriptionRemainingSeconds: user.getSubscriptionRemainingSeconds()
      }
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

// @desc    Reset all users verification status to false (Only admin can verify users individually)
// @route   POST /api/admin/users/reset-verifications
// @access  Private (Admin)
exports.resetAllVerifications = async (req, res, next) => {
  try {
    const result = await User.updateMany(
      { isVerified: true },
      { $set: { isVerified: false } }
    );

    res.status(200).json({
      success: true,
      message: `تم إلغاء توثيق جميع الحسابات بنجاح (${result.modifiedCount} حساب). الآن لا يظهر أي حساب كموثق إلا إذا قمت بتوثيقه يدوياً.`,
      modifiedCount: result.modifiedCount
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete a user account permanently (Admin)
// @route   DELETE /api/admin/users/:id
// @access  Private (Admin)
exports.deleteUserByAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'المستخدم غير موجود / Utilisateur non trouvé'
      });
    }

    if (user.role === 'admin' && user.phone === '0555000000') {
      return res.status(400).json({
        success: false,
        message: 'لا يمكن حذف حساب المسؤول الرئيسي للنظام / Impossible de supprimer le compte super admin'
      });
    }

    const SparePartRequest = require('../models/SparePartRequest');
    const PartQuote = require('../models/PartQuote');
    const Review = require('../models/Review');
    const Notification = require('../models/Notification');
    const OtpVerification = require('../models/OtpVerification');

    // Cascade deletion of user data
    await SparePartRequest.deleteMany({ client: user._id });
    await PartQuote.deleteMany({ seller: user._id });
    await Review.deleteMany({ $or: [{ client: user._id }, { provider: user._id }] });
    await Notification.deleteMany({ recipient: user._id });
    await OtpVerification.deleteMany({ phone: user.phone });
    await User.findByIdAndDelete(user._id);

    res.status(200).json({
      success: true,
      message: 'تم حذف المستخدم وجميع بياناته بنجاح / Utilisateur supprimé avec succès'
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 5. Broadcast Push Notifications
// -------------------------------------------------------------
// @desc    Broadcast general notification to all users or specific roles
// @route   POST /api/admin/broadcast-notification
// @access  Private (Admin)
exports.broadcastNotification = async (req, res, next) => {
  try {
    const { title, message, targetRole } = req.body;
    if (!title || !title.trim() || !message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'عنوان الإشعار ونص الرسالة مطلوبان'
      });
    }

    const result = await broadcastPushNotification({
      title: title.trim(),
      message: message.trim(),
      targetRole: targetRole || 'all',
      adminId: req.user._id
    });

    res.status(200).json({
      success: true,
      message: `تم إرسال الإشعار بنجاح إلى ${result.totalTargeted} مستخدم (${result.pushCount} إشعار فوري تم تسليمه بنجاح)`,
      data: result
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 6. Payment Ledger & Subscriptions
// -------------------------------------------------------------
// @desc    Create a payment record and automatically extend subscription
// @route   POST /api/admin/payments
// @access  Private (Admin)
exports.createPaymentRecord = async (req, res, next) => {
  try {
    const {
      providerId,
      amount,
      paymentMethod,
      referenceNumber,
      durationMonths,
      periodType,
      notes,
      receiptImageUrl
    } = req.body;

    if (!providerId) {
      return res.status(400).json({
        success: false,
        message: 'معرف مقدم الخدمة مطلوب'
      });
    }

    const provider = await User.findById(providerId);
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'مقدم الخدمة غير موجود'
      });
    }

    const months = Number(durationMonths) || 1;
    let start = new Date();
    if (provider.subscriptionExpiresAt && new Date(provider.subscriptionExpiresAt) > new Date()) {
      start = new Date(provider.subscriptionExpiresAt);
    }
    const end = new Date(start);
    end.setMonth(end.getMonth() + months);

    provider.subscriptionExpiresAt = end;
    if (periodType) {
      provider.subscriptionType = periodType;
    }
    await provider.save();

    const record = await PaymentRecord.create({
      provider: provider._id,
      admin: req.user._id,
      amount: Number(amount) || 0,
      paymentMethod: paymentMethod || 'baridimob',
      referenceNumber: referenceNumber ? referenceNumber.trim() : '',
      durationMonths: months,
      periodType: periodType || 'month',
      startDate: start,
      endDate: end,
      notes: notes ? notes.trim() : '',
      receiptImageUrl: receiptImageUrl || null
    });

    const populated = await PaymentRecord.findById(record._id)
      .populate('provider', 'fullName phone businessName role address')
      .populate('admin', 'fullName phone');

    res.status(201).json({
      success: true,
      message: 'تم تسجيل الوصل وتمديد الاشتراك بنجاح',
      data: populated
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Get all payment records with filters & total revenue
// @route   GET /api/admin/payments
// @access  Private (Admin)
exports.getAllPaymentRecords = async (req, res, next) => {
  try {
    const { paymentMethod, providerId, page = 1, limit = 50 } = req.query;
    const query = {};
    if (paymentMethod && paymentMethod !== 'all') {
      query.paymentMethod = paymentMethod;
    }
    if (providerId) {
      query.provider = providerId;
    }

    const total = await PaymentRecord.countDocuments(query);
    const records = await PaymentRecord.find(query)
      .populate('provider', 'fullName phone businessName role address')
      .populate('admin', 'fullName phone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    // Stats
    const stats = await PaymentRecord.aggregate([
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    const totalRevenue = stats.length > 0 ? stats[0].totalRevenue : 0;

    res.status(200).json({
      success: true,
      total,
      totalRevenue,
      page: Number(page),
      data: records
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete a payment record
// @route   DELETE /api/admin/payments/:id
// @access  Private (Admin)
exports.deletePaymentRecord = async (req, res, next) => {
  try {
    const record = await PaymentRecord.findByIdAndDelete(req.params.id);
    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'سجل الدفع غير موجود'
      });
    }

    res.status(200).json({
      success: true,
      message: 'تم حذف سجل الدفع بنجاح'
    });
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 7. CSV Data Exports (Excel UTF-8 Compatible)
// -------------------------------------------------------------
function escapeCsv(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

// @desc    Export users to CSV
// @route   GET /api/admin/export/users
// @access  Private (Admin)
exports.exportUsersCsv = async (req, res, next) => {
  try {
    const { role } = req.query;
    const query = {};
    if (role && role !== 'all') query.role = role;

    const users = await User.find(query).sort({ createdAt: -1 });

    const headers = ['المعرف', 'الاسم الكامل', 'رقم الهاتف', 'نوع الحساب', 'اسم المحل والورشة', 'العنوان', 'موثق', 'الحالة', 'انتهاء الاشتراك', 'تاريخ التسجيل'];
    const rows = [headers.join(',')];

    for (const u of users) {
      const row = [
        escapeCsv(u._id),
        escapeCsv(u.fullName),
        escapeCsv(u.phone),
        escapeCsv(u.role),
        escapeCsv(u.businessName || ''),
        escapeCsv(u.address || ''),
        escapeCsv(u.isVerified ? 'نعم' : 'لا'),
        escapeCsv(u.isActive ? 'نشط' : 'مجمد'),
        escapeCsv(u.subscriptionExpiresAt ? new Date(u.subscriptionExpiresAt).toLocaleDateString('fr-CA') : 'غير محدد'),
        escapeCsv(new Date(u.createdAt).toLocaleDateString('fr-CA'))
      ];
      rows.push(row.join(','));
    }

    const csvContent = '\uFEFF' + rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=en_panne_users.csv');
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};

// @desc    Export requests to CSV
// @route   GET /api/admin/export/requests
// @access  Private (Admin)
exports.exportRequestsCsv = async (req, res, next) => {
  try {
    const requests = await SparePartRequest.find()
      .populate('client', 'fullName phone')
      .sort({ createdAt: -1 });

    const headers = ['المعرف', 'اسم القطعة', 'السيارة', 'الموديل', 'سنة الصنع', 'رقم الشاسي', 'الزبون', 'رقم الهاتف', 'الولاية والبلدية', 'الحالة', 'تاريخ الطلب'];
    const rows = [headers.join(',')];

    for (const r of requests) {
      const row = [
        escapeCsv(r._id),
        escapeCsv(r.partName),
        escapeCsv(r.carBrand),
        escapeCsv(r.carModel),
        escapeCsv(r.carYear || ''),
        escapeCsv(r.vinNumber || ''),
        escapeCsv(r.client ? r.client.fullName : 'غير متوفر'),
        escapeCsv(r.client ? r.client.phone : 'غير متوفر'),
        escapeCsv(r.address || ''),
        escapeCsv(r.status),
        escapeCsv(new Date(r.createdAt).toLocaleDateString('fr-CA'))
      ];
      rows.push(row.join(','));
    }

    const csvContent = '\uFEFF' + rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=en_panne_requests.csv');
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};

// @desc    Export payment records to CSV
// @route   GET /api/admin/export/payments
// @access  Private (Admin)
exports.exportPaymentsCsv = async (req, res, next) => {
  try {
    const payments = await PaymentRecord.find()
      .populate('provider', 'fullName phone businessName role')
      .populate('admin', 'fullName')
      .sort({ createdAt: -1 });

    const headers = ['المعرف', 'مقدم الخدمة', 'رقم الهاتف', 'المهنة', 'المبلغ (دج)', 'طريقة الدفع', 'رقم الحوالة', 'المدة (أشهر)', 'تاريخ البدء', 'تاريخ الانتهاء', 'الملاحظات', 'تاريخ التسجيل'];
    const rows = [headers.join(',')];

    for (const p of payments) {
      const row = [
        escapeCsv(p._id),
        escapeCsv(p.provider ? (p.provider.businessName || p.provider.fullName) : 'محذوف'),
        escapeCsv(p.provider ? p.provider.phone : ''),
        escapeCsv(p.provider ? p.provider.role : ''),
        escapeCsv(p.amount),
        escapeCsv(p.paymentMethod),
        escapeCsv(p.referenceNumber || ''),
        escapeCsv(p.durationMonths),
        escapeCsv(new Date(p.startDate).toLocaleDateString('fr-CA')),
        escapeCsv(new Date(p.endDate).toLocaleDateString('fr-CA')),
        escapeCsv(p.notes || ''),
        escapeCsv(new Date(p.createdAt).toLocaleDateString('fr-CA'))
      ];
      rows.push(row.join(','));
    }

    const csvContent = '\uFEFF' + rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=en_panne_payments.csv');
    res.status(200).send(csvContent);
  } catch (err) {
    next(err);
  }
};

// -------------------------------------------------------------
// 8. Disputes & Reports Center
// -------------------------------------------------------------
// @desc    Get all disputes & reports
// @route   GET /api/admin/reports
// @access  Private (Admin)
exports.getAllReports = async (req, res, next) => {
  try {
    const { status, type, page = 1, limit = 50 } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;
    if (type && type !== 'all') query.type = type;

    const total = await Report.countDocuments(query);
    const reports = await Report.find(query)
      .populate('reporter', 'fullName phone role')
      .populate('reportedUser', 'fullName phone role businessName address isActive isVerified')
      .populate('reportedRequest', 'partName carBrand carModel')
      .populate('resolvedBy', 'fullName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.status(200).json({
      success: true,
      total,
      page: Number(page),
      data: reports
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update dispute / report status
// @route   PATCH /api/admin/reports/:id
// @access  Private (Admin)
exports.updateReportStatus = async (req, res, next) => {
  try {
    const { status, adminNotes } = req.body;
    const update = {};
    if (status) update.status = status;
    if (adminNotes !== undefined) update.adminNotes = adminNotes;
    if (status === 'resolved' || status === 'dismissed') {
      update.resolvedBy = req.user._id;
      update.resolvedAt = new Date();
    }

    const report = await Report.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('reporter', 'fullName phone role')
      .populate('reportedUser', 'fullName phone role businessName address isActive isVerified')
      .populate('resolvedBy', 'fullName');

    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'البلاغ غير موجود'
      });
    }

    res.status(200).json({
      success: true,
      message: 'تم تحديث حالة البلاغ بنجاح',
      data: report
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Delete a report
// @route   DELETE /api/admin/reports/:id
// @access  Private (Admin)
exports.deleteReport = async (req, res, next) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) {
      return res.status(404).json({
        success: false,
        message: 'البلاغ غير موجود'
      });
    }

    res.status(200).json({
      success: true,
      message: 'تم حذف البلاغ بنجاح'
    });
  } catch (err) {
    next(err);
  }
};


