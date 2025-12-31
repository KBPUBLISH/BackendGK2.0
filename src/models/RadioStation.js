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
    // Duration of host breaks in seconds
    hostBreakDuration: {
        type: Number,
        default: 30,
        min: 10,
        max: 120,
    },
    // How often host breaks occur (every N songs)
    hostBreakFrequency: {
        type: Number,
        default: 3, // After every 3 songs
        min: 1,
        max: 10,
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

