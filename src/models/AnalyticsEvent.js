const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
    // User identification
    userId: {
        type: String,
        required: true,
        index: true,
    },
    kidProfileId: {
        type: String,
        index: true,
    },
    sessionId: {
        type: String,
        index: true,
    },

    // Event details
    eventType: {
        type: String,
        required: true,
        index: true,
        enum: [
            // Session events
            'session_start', 'session_end',
            // Onboarding
            'onboarding_start', 'onboarding_step', 'onboarding_complete', 'onboarding_skip',
            // Book events
            'book_view', 'book_read_complete', 'book_read_progress',
            'book_like', 'book_unlike', 'book_favorite', 'book_unfavorite',
            // Quiz events
            'quiz_start', 'quiz_complete',
            // Coloring events
            'coloring_start', 'coloring_complete',
            // Game events
            'game_unlock', 'game_open',
            // Playlist events
            'playlist_view', 'playlist_play',
            'playlist_like', 'playlist_unlike', 'playlist_favorite', 'playlist_unfavorite',
            // Lesson events
            'lesson_view', 'lesson_complete',
            // Devotional events
            'devotional_view', 'devotional_complete',
            // Voice events
            'voice_unlock',
            // Shop events
            'shop_purchase',
            // Generic
            'page_view', 'button_click', 'error',
        ],
    },

    // Target content
    targetType: {
        type: String,
        enum: ['book', 'playlist', 'lesson', 'quiz', 'game', 'devotional', 'voice', 'page', 'other'],
        index: true,
    },
    targetId: {
        type: String,
        index: true,
    },
    targetTitle: {
        type: String,
    },

    // Additional data
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },

    // Device info
    platform: {
        type: String,
        enum: ['ios', 'android', 'web', 'unknown'],
        default: 'unknown',
    },
    deviceType: {
        type: String,
        default: 'unknown',
    },
    appVersion: {
        type: String,
    },
}, {
    timestamps: true,
});

// Compound indexes for common queries
analyticsEventSchema.index({ eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
analyticsEventSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);

