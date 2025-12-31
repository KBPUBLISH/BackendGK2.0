const mongoose = require('mongoose');

const radioTrackSchema = new mongoose.Schema({
    // Source reference (where the song came from)
    sourcePlaylistId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Playlist'
    },
    sourceItemIndex: Number, // Index in the source playlist
    
    // Track details (copied from source for independence)
    title: {
        type: String,
        required: true
    },
    artist: String,
    audioUrl: {
        type: String,
        required: true
    },
    coverImage: String,
    duration: Number, // in seconds
    description: String, // Content description for context-aware hosting
    
    // Radio-specific settings
    category: {
        type: String,
        enum: ['worship', 'story', 'devotional', 'kids', 'general'],
        default: 'general'
    },
    rotation: {
        type: String,
        enum: ['high', 'medium', 'low'],
        default: 'medium'
    },
    enabled: {
        type: Boolean,
        default: true
    },
    
    // Stats
    playCount: {
        type: Number,
        default: 0
    },
    lastPlayedAt: Date,
    
    // Metadata
    addedBy: String,
    notes: String,
    
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update timestamp on save
radioTrackSchema.pre('save', function() {
    this.updatedAt = Date.now();
});

// Index for efficient queries
radioTrackSchema.index({ enabled: 1, category: 1, rotation: 1 });
radioTrackSchema.index({ sourcePlaylistId: 1, sourceItemIndex: 1 });

const RadioLibrary = mongoose.model('RadioLibrary', radioTrackSchema);

module.exports = RadioLibrary;

