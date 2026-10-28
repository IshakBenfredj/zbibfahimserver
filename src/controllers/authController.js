const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { computeShopOpenStatus } = require('../utils/scheduleHelper');

// Helper to generate JWT token
const sendTokenResponse = (user, statusCode, res, message = 'تمت العملية بنجاح') => {
  const token = jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET || 'en_panne_super_secret_jwt_key_2026_auto_mechanic',
    { expiresIn: process.env.JWT_EXPIRE || '30d' }
  );

  res.status(statusCode).json({
    success: true,
    message,
    token,
    user: {
      id: user._id,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      businessName: user.businessName,
      address: user.address,
      location: user.location,
      avatar: user.avatar,
      deliveryAvailable: user.deliveryAvailable,
      workingHours: user.workingHours || '08:00 - 18:00',
      is24_7: user.is24_7 || false,
      isTemporarilyClosed: user.isTemporarilyClosed || false,
      temporaryClosureReason: user.temporaryClosureReason || '',
      workingDays: user.workingDays || [6, 0, 1, 2, 3, 4],
      openTime: user.openTime || '08:00',
      closeTime: user.closeTime || '18:00',
      isOpen: computeShopOpenStatus(user).isOpen,
      rating: user.rating,
      reviewsCount: user.reviewsCount,
      isVerified: user.isVerified,
      hasLocationSet: user.hasLocationSet || false
    }
  });
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
exports.register = async (req, res, next) => {
  try {
    const {
      fullName,
      phone,
      password,
      role,
      businessName,
      address,
      latitude,
      longitude,
      brandsSupported,
      deliveryAvailable
    } = req.body;

    // Check if phone already registered
    const existingUser = await User.findOne({ phone: phone.trim() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف مسجل مسبقاً، يرجى تسجيل الدخول / Ce numéro est déjà enregistré'
      });
    }

    // Set coordinates and location status if supplied
    const hasCoordinates = !!(longitude && latitude);
    let userLocation = { type: 'Point', coordinates: [3.0588, 36.7538] }; // Default Algiers
    if (hasCoordinates) {
      userLocation = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)]
      };
    }

    const isProviderRole = ['seller', 'mechanic', 'electrician'].includes(role);
    // Providers only have location set if they actually submitted coordinates
    const hasLocationSet = isProviderRole ? hasCoordinates : false;

    const user = await User.create({
      fullName,
      phone: phone.trim(),
      password,
      role: role || 'client',
      businessName: businessName || null,
      address: address || '',
      location: userLocation,
      hasLocationSet,
      brandsSupported: brandsSupported ? (Array.isArray(brandsSupported) ? brandsSupported : JSON.parse(brandsSupported)) : [],
      deliveryAvailable: deliveryAvailable === true || deliveryAvailable === 'true',
      fcmToken: req.body.fcmToken || null
    });

    sendTokenResponse(user, 201, res, 'تم إنشاء الحساب بنجاح / Compte créé avec succès');
  } catch (err) {
    next(err);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { phone, password, fcmToken } = req.body;

    if (!phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال رقم الهاتف وكلمة المرور / Veuillez entrer le téléphone et mot de passe'
      });
    }

    // Find user with password selected
    const user = await User.findOne({ phone: phone.trim() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'بيانات الدخول غير صحيحة، يرجى التأكد من رقم الهاتف / Identifiants invalides'
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'كلمة المرور غير صحيحة / Mot de passe incorrect'
      });
    }

    // Save active device FCM token if passed
    if (fcmToken && typeof fcmToken === 'string' && fcmToken.trim().length > 10) {
      user.fcmToken = fcmToken.trim();
      await user.save();
    }

    sendTokenResponse(user, 200, res, 'مرحباً بك مجدداً / Connexion réussie');
  } catch (err) {
    next(err);
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    const userObj = user.toObject();
    const openStatus = computeShopOpenStatus(user);
    userObj.isOpen = openStatus.isOpen;
    userObj.openReason = openStatus.reason;
    userObj.openStatusTextAr = openStatus.statusTextAr;
    userObj.openStatusTextFr = openStatus.statusTextFr;
    res.status(200).json({
      success: true,
      user: userObj
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Update current user profile
// @route   PUT /api/auth/profile
// @access  Private
exports.updateProfile = async (req, res, next) => {
  try {
    const allowedFields = [
      'fullName',
      'phone',
      'businessName',
      'description',
      'address',
      'avatar',
      'brandsSupported',
      'deliveryAvailable',
      'workingHours',
      'services',
      'is24_7',
      'isTemporarilyClosed',
      'temporaryClosureReason',
      'workingDays',
      'openTime',
      'closeTime'
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // Update location coordinates if passed
    if (req.body.longitude !== undefined && req.body.latitude !== undefined) {
      updates.location = {
        type: 'Point',
        coordinates: [parseFloat(req.body.longitude), parseFloat(req.body.latitude)]
      };
      updates.hasLocationSet = true;
    } else if (req.body.hasLocationSet !== undefined) {
      updates.hasLocationSet = req.body.hasLocationSet === true || req.body.hasLocationSet === 'true';
    }

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      runValidators: true
    });

    const userObj = user.toObject();
    const openStatus = computeShopOpenStatus(user);
    userObj.isOpen = openStatus.isOpen;
    userObj.openReason = openStatus.reason;
    userObj.openStatusTextAr = openStatus.statusTextAr;
    userObj.openStatusTextFr = openStatus.statusTextFr;

    res.status(200).json({
      success: true,
      message: 'تم تحديث الملف الشخصي بنجاح / Profil mis à jour',
      user: userObj
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Toggle shop manual temporary closure (زر الإغلاق السريع لظروف خاصة)
// @route   PUT /api/auth/shop-status
// @access  Private (Providers/Sellers)
exports.toggleShopStatus = async (req, res, next) => {
  try {
    const { isTemporarilyClosed, temporaryClosureReason } = req.body;
    const updates = {
      isTemporarilyClosed: isTemporarilyClosed === true || isTemporarilyClosed === 'true'
    };
    if (temporaryClosureReason !== undefined) {
      updates.temporaryClosureReason = temporaryClosureReason;
    }

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      runValidators: true
    });

    const userObj = user.toObject();
    const openStatus = computeShopOpenStatus(user);
    userObj.isOpen = openStatus.isOpen;
    userObj.openReason = openStatus.reason;
    userObj.openStatusTextAr = openStatus.statusTextAr;
    userObj.openStatusTextFr = openStatus.statusTextFr;

    res.status(200).json({
      success: true,
      message: updates.isTemporarilyClosed
        ? 'تم إغلاق المحل مؤقتاً لظروف خاصة / Magasin fermé temporairement'
        : 'تم فتح المحل لاستقبال الزبائن بنجاح / Magasin ouvert',
      user: userObj
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Upload or set profile avatar (Supports direct Cloudflare R2 CDN URL to save server bandwidth)
// @route   POST /api/auth/avatar
// @access  Private
exports.uploadAvatar = async (req, res, next) => {
  try {
    let avatarUrl = '';

    // Direct Cloudflare R2 URL passed in body (Zero server bandwidth & zero Base64)
    if (req.body && (req.body.avatarUrl || req.body.avatar)) {
      avatarUrl = req.body.avatarUrl || req.body.avatar;
    } else if (req.file) {
      avatarUrl = `/uploads/${req.file.filename}`;
    } else {
      return res.status(400).json({
        success: false,
        message: 'يرجى اختيار ملف الصورة أو تقديم رابط Cloudflare R2 / Aucune image sélectionnée'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { avatar: avatarUrl },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'تم تحديث الصورة الشخصية بنجاح / Photo de profil mise à jour',
      avatar: avatarUrl,
      user
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Change user password
// @route   PUT /api/auth/password
// @access  Private
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال كلمة المرور الحالية وكلمة المرور الجديدة / Mot de passe actuel et nouveau requis'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف / Le mot de passe doit comporter au moins 6 caractères'
      });
    }

    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'المستخدم غير موجود / Utilisateur non trouvé'
      });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'كلمة المرور الحالية غير صحيحة / Mot de passe actuel incorrect'
      });
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'تم تغيير كلمة المرور بنجاح / Mot de passe modifié avec succès'
    });
  } catch (err) {
    next(err);
  }
};

