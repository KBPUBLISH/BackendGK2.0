const mongoose = require('mongoose');

const radioHostSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    // Personality description for AI script generation
    personality: {
        type: String,
        default: 'Warm, friendly, and encouraging Christian radio host who loves sharing God\'s love through music.',
    },
    // Google Cloud TTS voice configuration
    googleVoice: {
        name: {
            type: String,
            default: 'en-US-Studio-O', // Default to a warm, friendly voice
        },
        languageCode: {
            type: String,
            default: 'en-US',
        },
        // Pitch adjustment (-20.0 to 20.0)
        pitch: {
            type: Number,
            default: 0,
            min: -20,
            max: 20,
        },
        // Speaking rate (0.25 to 4.0, 1.0 is normal)
        speakingRate: {
            type: Number,
            default: 1.0,
            min: 0.25,
            max: 4.0,
        },
    },
    // Sample phrases for voice testing and consistency
    samplePhrases: [{
        type: String,
    }],
    // Avatar/profile image for the host
    avatarUrl: {
        type: String,
    },
    // Whether this host is active
    enabled: {
        type: Boolean,
        default: true,
    },
    // Order for display/rotation
    order: {
        type: Number,
        default: 0,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Update timestamp on save
radioHostSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('RadioHost', radioHostSchema);

