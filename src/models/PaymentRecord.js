const mongoose = require('mongoose');

const paymentRecordSchema = new mongoose.Schema({
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paymentMethod: {
    type: String,
    enum: ['baridimob', 'ccp', 'cash', 'bank', 'other'],
    default: 'baridimob',
    index: true
  },
  referenceNumber: {
    type: String,
    trim: true,
    default: ''
  },
  durationMonths: {
    type: Number,
    default: 1
  },
  periodType: {
    type: String,
    enum: ['month', 'quarter', 'half_year', 'year', 'custom', 'trial'],
    default: 'month'
  },
  startDate: {
    type: Date,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true
  },
  notes: {
    type: String,
    trim: true,
    default: ''
  },
  receiptImageUrl: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

paymentRecordSchema.index({ createdAt: -1 });
paymentRecordSchema.index({ provider: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentRecord', paymentRecordSchema);
