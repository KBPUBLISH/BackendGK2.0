const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  isPremium: {
    type: Boolean,
    default: false,
  },
  subscriptionStatus: {
    type: String,
    enum: ['free', 'trial', 'active', 'cancelled', 'expired'],
    default: 'free',
  },
  // Subscription dates (timestamps in ms)
  subscriptionExpiryDate: {
    type: Number,
    default: null,
  },
  subscriptionStartDate: {
    type: Number,
    default: null,
  },
  // Migration tracking
  migratedFromOldApp: {
    type: Boolean,
    default: false,
  },
  oldAppUserId: {
    type: String,
    default: null,
  },
  // Trial tracking
  isTrialUsed: {
    type: Boolean,
    default: false,
  },
  isTrialActive: {
    type: Boolean,
    default: false,
  },
  // Influencer referral tracking
  referredBy: {
    influencerCode: { type: String, default: null },
    influencerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Influencer', default: null },
    clickedAt: { type: Date, default: null },
    signedUpAt: { type: Date, default: null },
    convertedAt: { type: Date, default: null },
  },
  // User-to-user referral system
  referralCode: {
    type: String,
    unique: true,
    sparse: true, // Allows null values while still being unique
  },
  referralStats: {
    totalReferrals: { type: Number, default: 0 },
    coinsEarned: { type: Number, default: 0 },
  },
  // Push notification token (OneSignal player ID)
  pushToken: {
    type: String,
    default: null,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt automatically
});

UserSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', UserSchema);
