const mongoose = require('mongoose');

const ttsCacheSchema = new mongoose.Schema({
    textHash: {
        type: String,
        required: true,
        index: true
    },
    voiceId: {
        type: String,
        required: true,
        index: true
    },
    text: {
        type: String,
        required: true
    },
    audioUrl: {
        type: String,
        required: true
    },
    alignmentData: {
        type: mongoose.Schema.Types.Mixed, // JSON object with character start/end times
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
        // Permanent cache - no expiration
    }
});

// Compound index for fast lookups
ttsCacheSchema.index({ textHash: 1, voiceId: 1 }, { unique: true });

module.exports = mongoose.model('TTSCache', ttsCacheSchema);
