const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
    gameId: {
        type: String,
        required: true,
        unique: true,
        // Remove enum restriction to allow custom games
    },
    name: {
        type: String,
        required: true,
    },
    enabled: {
        type: Boolean,
        default: true,
    },
    description: {
        type: String,
    },
    // URL for webview-based games
    url: {
        type: String,
    },
    // Cover image for the game
    coverImage: {
        type: String,
    },
    // Show in "Daily Tasks & IQ Games" category
    showInDailyTasks: {
        type: Boolean,
        default: true,
    },
    // Game type: 'modal' (built-in) or 'webview' (external URL)
    gameType: {
        type: String,
        enum: ['modal', 'webview'],
        default: 'modal',
    },
    // Game-specific settings
    settings: {
        // Prayer Game
        prayerTopics: [{
            id: String,
            label: String,
            color: String,
            texts: [String],
        }],
        
        // Challenge/Memory Game
        challengeDuration: { type: Number, default: 60 }, // seconds
        challengePairsCount: { type: Number, default: 6 },
        challengeCooldownHours: { type: Number, default: 12 },
        challengeSymbols: [{
            id: String,
            label: String,
            color: String,
        }],
        
        // Strength Game
        strengthDuration: { type: Number, default: 30 }, // seconds per round
        strengthTotalRounds: { type: Number, default: 3 },
        strengthActivities: [{
            id: String,
            name: String,
            color: String,
            description: String,
        }],
    },
    
    // Coin rewards
    rewards: {
        threeStars: { type: Number, default: 50 },
        twoStars: { type: Number, default: 25 },
        oneStar: { type: Number, default: 10 },
    },
    
    // Purchase with gold coins
    isPurchasable: {
        type: Boolean,
        default: false,
    },
    goldCoinPrice: {
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

gameSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
        next();
    }
});

module.exports = mongoose.model('Game', gameSchema);

