const mongoose = require('mongoose');

// Track individual play events for real-time trending
const playEventSchema = new mongoose.Schema({
    // Type of content: 'book', 'episode', 'playlist'
    contentType: {
        type: String,
        enum: ['book', 'episode', 'playlist'],
        required: true,
        index: true,
    },
    // ID of the content being played
    contentId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    // For episodes, also store the parent playlist ID
    playlistId: {
        type: mongoose.Schema.Types.ObjectId,
        index: true,
    },
    // For episodes, store the item index
    itemIndex: {
        type: Number,
    },
    // User who played (optional - can be anonymous)
    userId: {
        type: String,
        index: true,
    },
    // When the play happened
    playedAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
});

// Compound index for efficient trending queries
playEventSchema.index({ contentType: 1, playedAt: -1 });
playEventSchema.index({ contentType: 1, contentId: 1, playedAt: -1 });

// TTL index to automatically delete old play events (keep 30 days)
playEventSchema.index({ playedAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('PlayEvent', playEventSchema);

