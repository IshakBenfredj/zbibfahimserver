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
