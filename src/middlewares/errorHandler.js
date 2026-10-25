const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  console.error('[Error Details]:', err);

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'المعرف غير موجود أو غير صالح / Identifiant introuvable ou invalide';
    return res.status(404).json({ success: false, message });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = field === 'phone'
      ? 'رقم الهاتف مسجل مسبقاً في النظام / Ce numéro de téléphone est déjà enregistré'
      : `القيمة المدخلة في حقل (${field}) مستخدمة مسبقاً / Champ dupliqué`;
    return res.status(400).json({ success: false, message });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(' | ');
    return res.status(400).json({ success: false, message });
  }

  // Multer file size / type error
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'حجم الصورة يتجاوز الحد المسموح به (5 ميغابايت) / Taille de l\'image trop grande (Max 5Mo)'
    });
  }

  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || 'حدث خطأ غير متوقع في الخادم / Erreur interne du serveur'
  });
};

module.exports = errorHandler;
