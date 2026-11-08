const express = require('express');
const router = express.Router();
const {
  register,
  login,
  socialAuth,
  getMe,
  updateProfile,
  uploadAvatar,
  changePassword,
  toggleShopStatus,
  sendWhatsAppOtp,
  verifyWhatsAppOtp
} = require('../controllers/authController');
const { protect } = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

router.post('/register', register);
router.post('/login', login);
router.post('/social', socialAuth);
router.post('/send-whatsapp-otp', sendWhatsAppOtp);
router.post('/verify-whatsapp-otp', verifyWhatsAppOtp);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/shop-status', protect, toggleShopStatus);
router.put('/password', protect, changePassword);
router.post('/avatar', protect, upload.single('avatar'), uploadAvatar);

module.exports = router;

