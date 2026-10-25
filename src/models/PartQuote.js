const mongoose = require('mongoose');

const partQuoteSchema = new mongoose.Schema({
  partRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SparePartRequest',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Price in DZD - CONFIDENTIAL: Only visible to the request author and this seller
  price: {
    type: Number,
    default: null
  },
  notes: {
    type: String,
    default: '',
    trim: true
  },
  deliveryAvailable: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending'
  }
}, {
  timestamps: true
});

// Compound unique index: a seller can offer one active quote per request (can update it)
partQuoteSchema.index({ partRequest: 1, seller: 1 }, { unique: true });

module.exports = mongoose.model('PartQuote', partQuoteSchema);
