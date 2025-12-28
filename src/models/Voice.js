const mongoose = require('mongoose');

const voiceSchema = new mongoose.Schema({
    voiceId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true
    },
    customName: {
        type: String, // User-defined display name for the voice (e.g., "Friendly Bear")
    },
    category: {
        type: String,
        default: 'premade'
    },
    previewUrl: {
        type: String
    },
    characterImage: {
        type: String, // URL to character/avatar image for this voice
    },
    enabled: {
        type: Boolean,
        default: true
    },
    // Additional metadata
    description: {
        type: String
    },
    ageGroup: {
        type: String,
        enum: ['child', 'teen', 'adult', 'all'],
        default: 'all'
    },
    language: {
        type: String,
        default: 'en'
    },
    displayOrder: {
        type: Number,
        default: 0 // For sorting in the app
    },
    isPremium: {
        type: Boolean,
        default: false // Whether this voice requires premium subscription
    },
    // Whether this voice needs to be unlocked (e.g., by completing a book)
    isLockable: {
        type: Boolean,
        default: false
    },
    // Which book unlocks this voice (if lockable)
    unlockedByBookId: {
        type: String,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update updatedAt before saving
voiceSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
        next();
    }
});

module.exports = mongoose.model('Voice', voiceSchema);

