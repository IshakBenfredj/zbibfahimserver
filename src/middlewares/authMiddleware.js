const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'غير مصرح لك بالوصول، يرجى تسجيل الدخول أولاً / Non autorisé, veuillez vous connecter'
    });
  }

  // Master Admin session token for admin mobile app secured with local PIN
  if (token === 'en_panne_admin_master_session_token_2026' || token === process.env.ADMIN_MASTER_TOKEN) {
    try {
      let adminUser = await User.findOne({ role: 'admin' });
      if (!adminUser) {
        adminUser = await User.create({
          fullName: 'مسؤول المنصة (Admin)',
          phone: '0555000000',
          password: 'secure_admin_system_pwd_2026',
          role: 'admin',
          isActive: true,
          isVerified: true
        });
      }
      req.user = adminUser;
      return next();
    } catch (e) {
      return res.status(500).json({
        success: false,
        message: 'خطأ في معالجة حساب المسؤول / Erreur de session admin'
      });
    }
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'en_panne_super_secret_jwt_key_2026_auto_mechanic');
    req.user = await User.findById(decoded.id);

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'المستخدم غير موجود / Utilisateur introuvable'
      });
    }

    if (!req.user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'الحساب معطل، يرجى مراجعة إدارة المنصة / Compte désactivé'
      });
    }

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'رمز المصادقة غير صالح أو منتهي الصلاحية / Jeton d\'authentification invalide ou expiré'
    });
  }
};

module.exports = { protect };
