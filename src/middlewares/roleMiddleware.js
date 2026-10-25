// Authorize specific user roles (client, seller, mechanic, electrician, admin)
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `دور الحساب (${req.user ? req.user.role : 'غير محدد'}) غير مصرح له بتنفيذ هذه العملية / Accès refusé pour ce rôle`
      });
    }
    next();
  };
};

module.exports = { authorize };
