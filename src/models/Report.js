const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  reportedUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  reportedRequest: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SparePartRequest',
    default: null
  },
  type: {
    type: String,
    enum: ['fraud', 'bad_service', 'offensive_content', 'counterfeit_part', 'unreachable', 'pricing_dispute', 'other'],
    default: 'other',
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  details: {
    type: String,
    required: true,
    trim: true
  },
  images: [{
    type: String
  }],
  status: {
    type: String,
    enum: ['pending', 'under_review', 'resolved', 'dismissed'],
    default: 'pending',
    index: true
  },
  adminNotes: {
    type: String,
    trim: true,
    default: ''
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

reportSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
