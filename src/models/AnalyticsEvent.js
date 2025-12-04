const mongoose = require('mongoose');

const analyticsEventSchema = new mongoose.Schema({
    // User identification
    userId: {
        type: String, // Can be anonymous session ID or registered user ID
        required: true,
        index: true,
    },
    kidProfileId: {
        type: String, // Optional - which kid profile triggered the event
        index: true,
    },
    sessionId: {
        type: String, // Unique session identifier
        index: true,
    },
    
    // Event classification
    eventType: {
        type: String,
        required: true,
        enum: [
            // Session events
            'session_start',
            'session_end',
            
            // Content views
            'book_view',
            'book_read_complete',
            'playlist_view',
            'playlist_play',
            'audio_play',
            'lesson_view',
            'lesson_complete',
            
            // Engagement
            'book_like',
            'book_unlike',
            'book_favorite',
            'book_unfavorite',
            'playlist_like',
            'playlist_unlike',
            'playlist_favorite',
            'playlist_unfavorite',
            
            // Features
            'quiz_start',
            'quiz_complete',
            'quiz_answer',
            'coloring_start',
            'coloring_complete',
            'game_unlock',
            'game_open',
            'devotional_view',
            'devotional_complete',
            
            // Onboarding & conversion
            'onboarding_start',
            'onboarding_step',
            'onboarding_complete',
            'onboarding_skip',
            'paywall_view',
            'subscription_start',
            'subscription_cancel',
            
            // Account
            'signup',
            'login',
            'kid_profile_create',
            'voice_unlock',
            'shop_purchase',
        ],
        index: true,
    },
    
    // Target content (what the event is about)
    targetType: {
        type: String,
        enum: ['book', 'playlist', 'audio', 'lesson', 'quiz', 'game', 'coloring', 'devotional', 'voice', 'shop_item', 'feature', null],
    },
    targetId: {
        type: String, // ObjectId of the target content
        index: true,
    },
    targetTitle: {
        type: String, // For easier reporting without joins
    },
    
    // Event metadata
    metadata: {
        type: mongoose.Schema.Types.Mixed, // Flexible object for event-specific data
        default: {},
        // Examples:
        // - session_end: { duration: 300 } (seconds)
        // - onboarding_step: { step: 2, stepName: 'avatar_selection' }
        // - quiz_answer: { questionIndex: 0, correct: true }
        // - quiz_complete: { score: 5, totalQuestions: 6, coinsEarned: 50 }
    },
    
    // Device & platform info
    platform: {
        type: String,
        enum: ['web', 'ios', 'android', 'unknown'],
        default: 'unknown',
    },
    deviceType: {
        type: String,
        enum: ['mobile', 'tablet', 'desktop', 'unknown'],
        default: 'unknown',
    },
    appVersion: {
        type: String,
    },
    
    // Timestamps
    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
});

// Compound indexes for efficient aggregation queries
analyticsEventSchema.index({ eventType: 1, createdAt: -1 });
analyticsEventSchema.index({ userId: 1, createdAt: -1 });
analyticsEventSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
analyticsEventSchema.index({ eventType: 1, targetType: 1, createdAt: -1 });
analyticsEventSchema.index({ sessionId: 1, createdAt: 1 });

// TTL index to auto-delete old events after 1 year (optional - comment out to keep forever)
// analyticsEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);

