const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  provider: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  rating: {
    type: Number,
    required: [true, 'يرجى تحديد التقييم بالنجوم / Veuillez donner une note'],
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    default: '',
    trim: true
  }
}, {
  timestamps: true
});

// A client can review a provider once (can update it)
reviewSchema.index({ client: 1, provider: 1 }, { unique: true });

// Static method to calculate average rating of a provider and update the User record
reviewSchema.statics.calculateAverageRating = async function(providerId) {
  const targetId = mongoose.Types.ObjectId.isValid(providerId)
    ? new mongoose.Types.ObjectId(providerId.toString())
    : providerId;

  const stats = await this.aggregate([
    { $match: { provider: targetId } },
    {
      $group: {
        _id: '$provider',
        nRating: { $sum: 1 },
        avgRating: { $avg: '$rating' }
      }
    }
  ]);

  try {
    if (stats.length > 0) {
      await mongoose.model('User').findByIdAndUpdate(providerId, {
        rating: Math.round(stats[0].avgRating * 10) / 10,
        reviewsCount: stats[0].nRating
      });
    } else {
      await mongoose.model('User').findByIdAndUpdate(providerId, {
        rating: 5.0,
        reviewsCount: 0
      });
    }
  } catch (err) {
    console.error('Error calculating average rating:', err);
  }
};

reviewSchema.post('save', async function() {
  await this.constructor.calculateAverageRating(this.provider);
});

reviewSchema.post('findOneAndDelete', async function(doc) {
  if (doc) {
    await doc.constructor.calculateAverageRating(doc.provider);
  }
});

module.exports = mongoose.model('Review', reviewSchema);
