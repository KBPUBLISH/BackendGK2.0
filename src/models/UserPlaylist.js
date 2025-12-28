const mongoose = require('mongoose');

// Schema for items in a user's playlist (references to songs/episodes)
const playlistItemSchema = new mongoose.Schema({
    // Reference to the original playlist containing the item
    playlistId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Playlist',
        required: true,
    },
    // Reference to the specific item within that playlist
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    // Cached data for quick display (denormalized)
    title: { type: String, required: true },
    author: { type: String },
    coverImage: { type: String },
    audioUrl: { type: String, required: true },
    duration: { type: Number },
    type: { type: String, enum: ['Song', 'Audiobook'], required: true },
    // Order within this user's playlist
    order: { type: Number, default: 0 },
    addedAt: { type: Date, default: Date.now },
}, { _id: true });

const userPlaylistSchema = new mongoose.Schema({
    // Owner of this playlist
    userId: {
        type: String, // Can be email or ObjectId string
        required: true,
        index: true,
    },
    
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50,
    },
    
    description: {
        type: String,
        trim: true,
        maxlength: 200,
    },
    
    // Cover image URL (can be AI-generated or uploaded)
    coverImage: {
        type: String,
        default: null,
    },
    
    // AI generation metadata
    aiGenerated: {
        isAiGenerated: { type: Boolean, default: false },
        prompt: { type: String }, // User's prompt for generation
        style: { type: String }, // Style used (e.g., 'cartoon', 'watercolor', 'pixel')
        generatedAt: { type: Date },
    },
    
    // Items in this playlist
    items: [playlistItemSchema],
    
    // Stats
    playCount: { type: Number, default: 0 },
    lastPlayedAt: { type: Date },
    
    // Visibility (for future sharing feature)
    isPublic: { type: Boolean, default: false },
    
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
});

// Update timestamp on save
userPlaylistSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Index for efficient queries
userPlaylistSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('UserPlaylist', userPlaylistSchema);

