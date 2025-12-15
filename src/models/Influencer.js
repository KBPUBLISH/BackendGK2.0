const mongoose = require('mongoose');

const influencerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true,
        match: [/^[A-Z0-9_-]+$/, 'Code must be alphanumeric with optional underscores/hyphens']
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true
    },
    commissionPercent: {
        type: Number,
        default: 10,
        min: 0,
        max: 100
    },
    discountPercent: {
        type: Number,
        default: 25,
        min: 0,
        max: 100
    },
    trialDays: {
        type: Number,
        default: 7,
        min: 0
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // Stats - updated via tracking endpoints
    stats: {
        clicks: { type: Number, default: 0 },
        signups: { type: Number, default: 0 },
        conversions: { type: Number, default: 0 },
        totalRevenue: { type: Number, default: 0 }
    },
    // Optional: custom landing page settings
    customSettings: {
        headline: String,
        subheadline: String,
        imageUrl: String,
        videoUrl: String
    },
    notes: String
}, {
    timestamps: true
});

// Index for fast code lookups
influencerSchema.index({ code: 1 });
influencerSchema.index({ isActive: 1 });
influencerSchema.index({ email: 1 });

module.exports = mongoose.model('Influencer', influencerSchema);

