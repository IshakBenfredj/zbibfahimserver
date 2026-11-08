const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OtpVerification = require('../models/OtpVerification');
const { computeShopOpenStatus } = require('../utils/scheduleHelper');
const { sendWhatsAppOtp, formatPhoneToE164 } = require('../utils/twilioService');

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
      hasLocationSet: user.hasLocationSet || false,
      isPhoneVerified: user.isPhoneVerified === true,
      email: user.email || '',
      authProvider: user.authProvider || 'local',
      hasPassword: typeof user.password === 'string' && user.password.length > 0
        ? true
        : (user.hasPasswordSet === true || user.authProvider === 'local'),
      subscriptionType: user.subscriptionType || 'trial',
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
      isSubscriptionExpired: typeof user.isSubscriptionExpired === 'function' ? user.isSubscriptionExpired() : false,
      subscriptionRemainingSeconds: typeof user.getSubscriptionRemainingSeconds === 'function' ? user.getSubscriptionRemainingSeconds() : null
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

    // Calculate trial expiration for providers (default 10 minutes for testing)
    const trialMinutes = parseInt(process.env.PROVIDER_TRIAL_MINUTES || '10', 10);
    const subscriptionExpiresAt = isProviderRole
      ? new Date(Date.now() + trialMinutes * 60 * 1000)
      : null;

    // Check if phone was verified via WhatsApp OTP
    const cleanPhone = phone.trim();
    const verifiedOtp = await OtpVerification.findOne({
      phone: cleanPhone,
      isVerified: true
    });
    const isPhoneVerified = !!verifiedOtp || req.body.isPhoneVerified === true || req.body.isPhoneVerified === 'true';

    const user = await User.create({
      fullName,
      phone: cleanPhone,
      password,
      role: role || 'client',
      businessName: businessName || null,
      address: address || '',
      location: userLocation,
      hasLocationSet,
      isPhoneVerified,
      subscriptionType: 'trial',
      subscriptionExpiresAt,
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

// @desc    Login / register with Google or Facebook (Firebase ID token)
// @route   POST /api/auth/social
// @access  Public
//
// Flow:
//  1. Verify the Firebase ID token sent by the app.
//  2. If a user is linked to this Firebase identity -> log them in.
//  3. Otherwise, if no profile data (phone/role) was supplied -> answer with
//     `needsRegistration: true` so the app shows the "complete profile" screen.
//  4. Otherwise create the account from the supplied profile data.
exports.socialAuth = async (req, res, next) => {
  try {
    const {
      idToken,
      role,
      phone,
      fullName,
      businessName,
      address,
      latitude,
      longitude,
      fcmToken
    } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'رمز التحقق مفقود / Jeton d\'authentification manquant'
      });
    }

    const admin = require('../utils/notificationDispatcher').getFirebaseAdmin();
    if (!admin) {
      return res.status(503).json({
        success: false,
        message: 'خدمة تسجيل الدخول الاجتماعي غير متاحة حالياً / Service de connexion sociale indisponible'
      });
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({
        success: false,
        message: 'فشل التحقق من الحساب، يرجى المحاولة مجدداً / Échec de la vérification du compte'
      });
    }

    const signInProvider = decoded.firebase && decoded.firebase.sign_in_provider;
    const authProvider = signInProvider === 'google.com' ? 'google' : null;

    if (!authProvider) {
      return res.status(400).json({
        success: false,
        message: 'مزود تسجيل الدخول غير مدعوم، يرجى استخدام Google / Fournisseur non pris en charge'
      });
    }

    const providerId = decoded.uid;
    const email = decoded.email ? decoded.email.toLowerCase() : undefined;
    const socialName = (decoded.name || '').trim();
    const socialAvatar = decoded.picture || null;

    // Existing linked account -> login
    const existing = await User.findOne({ providerId });
    if (existing) {
      if (!existing.isActive) {
        return res.status(403).json({
          success: false,
          message: 'تم تعطيل هذا الحساب / Compte désactivé'
        });
      }
      if (fcmToken && typeof fcmToken === 'string' && fcmToken.trim().length > 10) {
        existing.fcmToken = fcmToken.trim();
        await existing.save();
      }
      return sendTokenResponse(existing, 200, res, 'مرحباً بك مجدداً / Connexion réussie');
    }

    // New identity without profile data yet -> ask the app to collect it
    if (!phone || !role) {
      return res.status(200).json({
        success: true,
        needsRegistration: true,
        message: 'يرجى إكمال بيانات الحساب / Veuillez compléter votre profil',
        profile: {
          fullName: socialName,
          email: email || '',
          avatar: socialAvatar,
          provider: authProvider
        }
      });
    }

    // Create the account
    const allowedRoles = ['client', 'seller', 'mechanic', 'electrician'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'نوع الحساب غير صالح / Rôle d\'utilisateur invalide'
      });
    }

    const cleanPhone = String(phone).trim();
    if (cleanPhone.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف غير صالح / Numéro de téléphone invalide'
      });
    }

    const finalName = (fullName && String(fullName).trim()) || socialName;
    if (!finalName) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال الاسم الكامل / Veuillez entrer le nom complet'
      });
    }

    const phoneTaken = await User.findOne({ phone: cleanPhone });
    if (phoneTaken) {
      return res.status(400).json({
        success: false,
        message: 'رقم الهاتف مسجل مسبقاً، يرجى تسجيل الدخول / Ce numéro est déjà enregistré'
      });
    }

    const isProviderRole = ['seller', 'mechanic', 'electrician'].includes(role);
    if (isProviderRole && (!businessName || !String(businessName).trim())) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال اسم المحل أو الورشة / Veuillez entrer le nom du commerce'
      });
    }

    const hasCoordinates = !!(longitude && latitude);
    const userLocation = hasCoordinates
      ? { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] }
      : { type: 'Point', coordinates: [3.0588, 36.7538] }; // Default Algiers

    // Calculate trial expiration for providers (default 10 minutes for testing)
    const trialMinutes = parseInt(process.env.PROVIDER_TRIAL_MINUTES || '10', 10);
    const subscriptionExpiresAt = isProviderRole
      ? new Date(Date.now() + trialMinutes * 60 * 1000)
      : null;

    const user = await User.create({
      fullName: finalName,
      phone: cleanPhone,
      role,
      authProvider,
      providerId,
      email,
      avatar: socialAvatar,
      businessName: isProviderRole ? String(businessName).trim() : null,
      address: address || '',
      location: userLocation,
      hasLocationSet: isProviderRole ? hasCoordinates : false,
      subscriptionType: 'trial',
      subscriptionExpiresAt,
      fcmToken: fcmToken && typeof fcmToken === 'string' ? fcmToken.trim() : null
    });

    sendTokenResponse(user, 201, res, 'تم إنشاء الحساب بنجاح / Compte créé avec succès');
  } catch (err) {
    next(err);
  }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'المستخدم غير موجود' });
    }
    const userObj = user.toObject();
    const openStatus = computeShopOpenStatus(user);
    userObj.isOpen = openStatus.isOpen;
    userObj.openReason = openStatus.reason;
    userObj.openStatusTextAr = openStatus.statusTextAr;
    userObj.openStatusTextFr = openStatus.statusTextFr;
    userObj.hasPassword = typeof user.password === 'string' && user.password.length > 0
      ? true
      : (user.hasPasswordSet === true || user.authProvider === 'local');
    delete userObj.password;

    userObj.isSubscriptionExpired = typeof user.isSubscriptionExpired === 'function'
      ? user.isSubscriptionExpired()
      : false;
    userObj.subscriptionRemainingSeconds = typeof user.getSubscriptionRemainingSeconds === 'function'
      ? user.getSubscriptionRemainingSeconds()
      : null;

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

// @desc    Change or set user password
// @route   PUT /api/auth/password
// @access  Private
exports.changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
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

    const hasExistingPassword = typeof user.password === 'string' && user.password.length > 0;

    // If user already has a password set, require and verify the current password
    if (hasExistingPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'يرجى إدخال كلمة المرور الحالية / Mot de passe actuel requis'
        });
      }

      const isMatch = await user.matchPassword(currentPassword);
      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: 'كلمة المرور الحالية غير صحيحة / Mot de passe actuel incorrect'
        });
      }
    }

    user.password = newPassword;
    user.hasPasswordSet = true;
    await user.save();

    res.status(200).json({
      success: true,
      hasPassword: true,
      message: hasExistingPassword
        ? 'تم تغيير كلمة المرور بنجاح / Mot de passe modifié avec succès'
        : 'تم تعيين كلمة المرور بنجاح، يمكنك الآن تسجيل الدخول بها / Mot de passe défini avec succès'
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Send WhatsApp OTP verification code via Twilio
// @route   POST /api/auth/send-whatsapp-otp
// @access  Public
exports.sendWhatsAppOtp = async (req, res, next) => {
  try {
    const { phone } = req.body;

    if (!phone || String(phone).trim().length < 8) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال رقم هاتف صالح / Veuillez entrer un numéro de téléphone valide'
      });
    }

    const cleanPhone = String(phone).trim();
    const formattedPhone = formatPhoneToE164(cleanPhone);

    // Rate-limiting check: 45 seconds between consecutive OTP requests
    const lastOtp = await OtpVerification.findOne({ phone: cleanPhone }).sort({ createdAt: -1 });
    if (lastOtp && lastOtp.createdAt) {
      const elapsedSeconds = Math.floor((Date.now() - lastOtp.createdAt.getTime()) / 1000);
      if (elapsedSeconds < 45) {
        return res.status(429).json({
          success: false,
          message: `يرجى الانتظار ${45 - elapsedSeconds} ثانية قبل طلب رمز جديد / Veuillez patienter`,
          retryAfter: 45 - elapsedSeconds
        });
      }
    }

    // Generate random 6-digit OTP code
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Invalidate previous unverified OTP records for this phone
    await OtpVerification.deleteMany({ phone: cleanPhone, isVerified: false });

    // Store in DB with automatic 5-minute TTL expiry
    await OtpVerification.create({
      phone: cleanPhone,
      formattedPhone,
      otp,
      channel: 'whatsapp'
    });

    // Send through Twilio WhatsApp API
    const twilioResult = await sendWhatsAppOtp(cleanPhone, otp);

    if (!twilioResult.success && !twilioResult.simulated) {
      return res.status(502).json({
        success: false,
        message: 'تعذر إرسال رمز التحقق عبر واتساب حالياً، يرجى المحاولة لاحقاً / Échec d\'envoi WhatsApp',
        error: twilioResult.error
      });
    }

    res.status(200).json({
      success: true,
      message: 'تم إرسال رمز التحقق عبر واتساب بنجاح / Code de vérification envoyé sur WhatsApp',
      formattedPhone: twilioResult.formattedPhone,
      devOtp: process.env.NODE_ENV !== 'production' || twilioResult.simulated ? otp : undefined
    });
  } catch (err) {
    next(err);
  }
};

// @desc    Verify WhatsApp OTP code
// @route   POST /api/auth/verify-whatsapp-otp
// @access  Public
exports.verifyWhatsAppOtp = async (req, res, next) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال رقم الهاتف ورمز التحقق / Numéro et code requis'
      });
    }

    const cleanPhone = String(phone).trim();
    const cleanOtp = String(otp).trim();

    const record = await OtpVerification.findOne({
      phone: cleanPhone,
      isVerified: false
    }).sort({ createdAt: -1 });

    if (!record) {
      return res.status(400).json({
        success: false,
        message: 'رمز التحقق منتهي الصلاحية أو غير موجود، يرجى طلب رمز جديد / Code expiré ou introuvable'
      });
    }

    if (record.attempts >= 5) {
      await OtpVerification.deleteMany({ phone: cleanPhone });
      return res.status(429).json({
        success: false,
        message: 'تم تجاوز الحد الأقصى للمحاولات الخاطئة، يرجى طلب رمز جديد / Trop de tentatives incorrectes'
      });
    }

    if (record.otp !== cleanOtp) {
      record.attempts += 1;
      await record.save();
      return res.status(400).json({
        success: false,
        message: 'رمز التحقق غير صحيح، يرجى التحقق وإعادة المحاولة / Code incorrect'
      });
    }

    // Mark OTP as verified
    record.isVerified = true;
    await record.save();

    // If an account already exists with this phone, update its isPhoneVerified flag
    await User.findOneAndUpdate(
      { phone: cleanPhone },
      { isPhoneVerified: true }
    );

    res.status(200).json({
      success: true,
      isVerified: true,
      message: 'تم تأكيد رقم الهاتف بنجاح عبر واتساب / Numéro vérifié avec succès'
    });
  } catch (err) {
    next(err);
  }
};

