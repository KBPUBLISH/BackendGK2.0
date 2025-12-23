const mongoose = require('mongoose');

// Kid profile embedded in AppUser
const kidProfileSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    age: {
        type: Number,
        min: 1,
        max: 18,
    },
    avatarSeed: {
        type: String, // For generating consistent avatar
    },
    avatar: {
        type: mongoose.Schema.Types.Mixed, // Full avatar configuration
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

const appUserSchema = new mongoose.Schema({
    // Anonymous or authenticated identifier
    deviceId: {
        type: String,
        index: true,
    },
    
    // Authentication (if user creates an account)
    email: {
        type: String,
        sparse: true,
        index: true,
    },
    
    // Subscription status
    subscriptionStatus: {
        type: String,
        enum: ['free', 'trial', 'active', 'cancelled', 'expired'],
        default: 'free',
        index: true,
    },
    subscriptionStartDate: {
        type: Date,
    },
    subscriptionEndDate: {
        type: Date,
    },
    subscriptionPlan: {
        type: String,
        enum: ['monthly', 'annual', null],
    },
    
    // Onboarding tracking
    onboardingStatus: {
        type: String,
        enum: ['not_started', 'in_progress', 'completed', 'skipped'],
        default: 'not_started',
        index: true,
    },
    onboardingStep: {
        type: Number,
        default: 0,
    },
    onboardingStartedAt: {
        type: Date,
    },
    onboardingCompletedAt: {
        type: Date,
    },
    
    // Parent profile
    parentName: {
        type: String,
        default: '',
    },
    
    // Kid profiles
    kidProfiles: [kidProfileSchema],
    activeKidProfileId: {
        type: mongoose.Schema.Types.ObjectId,
    },
    
    // Equipped items (avatar customization)
    equippedAvatar: {
        type: mongoose.Schema.Types.Mixed, // Full avatar configuration
    },
    equippedShip: {
        type: String,
    },
    equippedWheel: {
        type: String,
    },
    equippedPet: {
        type: String,
    },
    
    // Unlocked items
    unlockedAvatarItems: {
        type: [String],
        default: [],
    },
    unlockedShips: {
        type: [String],
        default: [],
    },
    unlockedWheels: {
        type: [String],
        default: [],
    },
    unlockedPets: {
        type: [String],
        default: [],
    },
    
    // Voice unlocks (parent-level)
    unlockedVoices: {
        type: [String],
        default: [],
    },
    defaultVoiceId: {
        type: String,
    },
    
    // Economy
    coins: {
        type: Number,
        default: 500,
    },
    
    // Referral system
    referralCode: {
        type: String,
        unique: true,
        sparse: true,
    },
    referredBy: {
        type: String, // Legacy: first referralCode used (kept for backwards compatibility)
    },
    usedReferralCodes: {
        type: [String], // All referral codes this user has redeemed
        default: [],
    },
    referralCount: {
        type: Number,
        default: 0,
    },
    
    // Push notifications
    oneSignalPlayerId: {
        type: String,
        sparse: true,
        index: true,
    },
    
    // Email notification signup (for anonymous users interested in launch updates)
    notificationEmail: {
        type: String,
        sparse: true,
        index: true,
    },
    emailSignupSource: {
        type: String, // 'web_popup', 'landing_page', etc.
    },
    emailSignupAt: {
        type: Date,
    },
    
    // Usage statistics (aggregate counters for quick access)
    stats: {
        totalSessions: {
            type: Number,
            default: 0,
        },
        totalTimeSpent: {
            type: Number, // Total seconds in app
            default: 0,
        },
        booksRead: {
            type: Number,
            default: 0,
        },
        playlistsPlayed: {
            type: Number,
            default: 0,
        },
        lessonsCompleted: {
            type: Number,
            default: 0,
        },
        quizzesCompleted: {
            type: Number,
            default: 0,
        },
        coloringSessions: {
            type: Number,
            default: 0,
        },
        gamesPlayed: {
            type: Number,
            default: 0,
        },
    },
    
    // Last activity tracking
    lastActiveAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
    lastSessionId: {
        type: String,
    },
    
    // Platform info
    platform: {
        type: String,
        enum: ['web', 'ios', 'android', 'unknown'],
        default: 'unknown',
    },
    
}, {
    timestamps: true // Automatically manage createdAt and updatedAt
});

// Indexes for analytics queries
appUserSchema.index({ subscriptionStatus: 1, createdAt: -1 });
appUserSchema.index({ onboardingStatus: 1, createdAt: -1 });
appUserSchema.index({ lastActiveAt: -1 });
appUserSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AppUser', appUserSchema);


