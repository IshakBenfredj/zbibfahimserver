const mongoose = require('mongoose');

const sparePartRequestSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  partName: {
    type: String,
    required: [true, 'يرجى إدخال اسم قطعة الغيار / Nom de la pièce requis'],
    trim: true
  },
  carBrand: {
    type: String,
    required: [true, 'يرجى تحديد ماركة السيارة / Marque du véhicule requise'],
    trim: true
  },
  carModel: {
    type: String,
    required: [true, 'يرجى تحديد طراز السيارة / Modèle du véhicule requis'],
    trim: true
  },
  carYear: {
    type: Number,
    default: null
  },
  description: {
    type: String,
    default: '',
    trim: true
  },
  referenceNumber: {
    type: String,
    default: '',
    trim: true
  },
  photos: {
    type: [String],
    default: []
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  address: {
    type: String,
    default: ''
  },
  deliveryRequired: {
    type: Boolean,
    default: false
  },
  deliveryWilaya: {
    type: String,
    default: ''
  },
  deliveryCommune: {
    type: String,
    default: ''
  },
  deliveryAddressDetails: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['open', 'fulfilled', 'cancelled'],
    default: 'open'
  },
  quotesCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for geo-queries (sellers discovering nearby requests)
sparePartRequestSchema.index({ location: '2dsphere' });
sparePartRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SparePartRequest', sparePartRequestSchema);
