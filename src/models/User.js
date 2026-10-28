const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const serviceItemSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  estimatedPrice: { type: Number, default: null }
}, { _id: true });

const userSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'يرجى إدخال الاسم الكامل / Veuillez entrer le nom complet'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'يرجى إدخال رقم الهاتف / Numéro de téléphone requis'],
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'يرجى إدخال كلمة المرور / Mot de passe requis'],
    minlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: {
      values: ['client', 'seller', 'mechanic', 'electrician', 'admin'],
      message: 'نوع الحساب غير صالح / Rôle d\'utilisateur invalide'
    },
    default: 'client',
    required: true
  },
  // Specific fields for Providers & Sellers
  businessName: {
    type: String,
    trim: true,
    default: null
  },
  description: {
    type: String,
    default: ''
  },
  address: {
    type: String,
    default: ''
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [3.0588, 36.7538] // Default: Algiers center
    }
  },
  avatar: {
    type: String,
    default: null
  },
  workshopImages: {
    type: [String],
    default: []
  },
  services: [serviceItemSchema],
  brandsSupported: {
    type: [String],
    default: []
  },
  deliveryAvailable: {
    type: Boolean,
    default: false
  },
  workingHours: {
    type: String,
    default: '08:00 - 18:00'
  },
  is24_7: {
    type: Boolean,
    default: false
  },
  isTemporarilyClosed: {
    type: Boolean,
    default: false
  },
  temporaryClosureReason: {
    type: String,
    default: ''
  },
  workingDays: {
    type: [Number],
    default: [6, 0, 1, 2, 3, 4] // Saturday to Thursday (0=Sun, 1=Mon, ..., 6=Sat)
  },
  openTime: {
    type: String,
    default: '08:00'
  },
  closeTime: {
    type: String,
    default: '18:00'
  },
  rating: {
    type: Number,
    default: 5.0,
    min: 1,
    max: 5
  },
  reviewsCount: {
    type: Number,
    default: 0
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  hasLocationSet: {
    type: Boolean,
    default: false
  },
  fcmToken: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Create 2dsphere index for location-based geospatial queries
userSchema.index({ location: '2dsphere' });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to verify password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
