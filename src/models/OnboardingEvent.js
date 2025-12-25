const mongoose = require('mongoose');

const onboardingEventSchema = new mongoose.Schema({
    // User identification
    userId: {
        type: String,
        required: true,
        index: true,
    },
    sessionId: {
        type: String,
        required: true,
    },
    
    // Event details
    event: {
        type: String,
        required: true,
        enum: [
            'onboarding_started',
            'step_1_complete',      // Welcome/intro
            'step_2_complete',      // Add kids
            'step_3_complete',      // Voice selection
            'step_4_viewed',        // Paywall viewed
            'plan_selected',        // User selected a plan
            'create_account_clicked',
            'account_created',
            'subscribe_clicked',
            'subscription_started',
            'trial_started',
            'restore_clicked',
            'restore_success',
            'skip_clicked',         // User skipped paywall
            'onboarding_complete',
        ],
    },
    
    // Additional data
    metadata: {
        step: Number,
        planType: String,           // 'annual' | 'monthly'
        kidsCount: Number,
        voiceSelected: String,
        platform: String,
        referrer: String,
    },
    
    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
});

// Compound index for efficient queries
onboardingEventSchema.index({ event: 1, createdAt: -1 });
onboardingEventSchema.index({ userId: 1, sessionId: 1 });

module.exports = mongoose.model('OnboardingEvent', onboardingEventSchema);

