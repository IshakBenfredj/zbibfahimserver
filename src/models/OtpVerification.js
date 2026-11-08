const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  formattedPhone: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  otp: {
    type: String,
    required: true,
    trim: true
  },
  channel: {
    type: String,
    enum: ['whatsapp', 'sms'],
    default: 'whatsapp'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // Automatically deleted after 5 minutes (300 seconds)
  }
});

module.exports = mongoose.model('OtpVerification', otpVerificationSchema);

