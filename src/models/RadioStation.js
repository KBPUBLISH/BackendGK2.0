const mongoose = require('mongoose');

const radioStationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        default: 'Praise Station Radio',
    },
    // Tagline/description
    tagline: {
        type: String,
        default: 'Uplifting music for the whole family',
    },
    // References to RadioHost documents
    hosts: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RadioHost',
    }],
    // References to Playlist documents to pull songs from
    playlists: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Playlist',
    }],
    // Duration of regular host breaks in seconds
    hostBreakDuration: {
        type: Number,
        default: 10, // Short, quick breaks
        min: 5,
        max: 30,
    },
    // How often regular host breaks occur (every N songs)
    hostBreakFrequency: {
        type: Number,
        default: 3, // After every 3 songs
        min: 1,
        max: 10,
    },
    // How often devotional segments occur (every N songs)
    devotionalFrequency: {
        type: Number,
        default: 10, // Every 10 songs
        min: 5,
        max: 20,
    },
    // Duration of devotional segments in seconds
    devotionalDuration: {
        type: Number,
        default: 60, // 1 minute devotional
        min: 30,
        max: 180,
    },
    // Whether to use both hosts for duo discussions
    enableDuoDiscussions: {
        type: Boolean,
        default: true,
    },
    // Station settings
    settings: {
        // Intro jingle that plays at station start
        introJingleUrl: {
            type: String,
        },
        // Outro jingle for sign-off
        outroJingleUrl: {
            type: String,
        },
        // Background music volume during host breaks (0-1)
        hostBreakMusicVolume: {
            type: Number,
            default: 0.1,
            min: 0,
            max: 1,
        },
        // Whether to shuffle songs or play in order
        shuffleSongs: {
            type: Boolean,
            default: true,
        },
        // Whether to rotate hosts or use single host
        rotateHosts: {
            type: Boolean,
            default: true,
        },
    },
    // Station cover image
    coverImageUrl: {
        type: String,
    },
    // Custom station intro script (user can write their own)
    customIntroScript: {
        type: String,
        default: '',
    },
    // Cached station intro (so it doesn't regenerate every time)
    cachedIntro: {
        audioUrl: String,
        script: String,
        hostId: mongoose.Schema.Types.ObjectId,
        hostName: String,
        generatedAt: Date,
    },
    // Whether the station is live/active
    isLive: {
        type: Boolean,
        default: false,
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
radioStationSchema.pre('save', function() {
    this.updatedAt = Date.now();
});

module.exports = mongoose.model('RadioStation', radioStationSchema);

