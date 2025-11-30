const mongoose = require('mongoose');

const audioItemSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    author: {
        type: String,
        default: 'Kingdom Builders Publishing',
    },
    coverImage: {
        type: String, // URL to GCS
        required: false, // Made optional for backward compatibility with existing playlists
    },
    audioUrl: {
        type: String, // URL to GCS
        required: true,
    },
    duration: {
        type: Number, // Duration in seconds
    },
    order: {
        type: Number,
        default: 0,
    },
}, { _id: true });

const playlistSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    author: {
        type: String,
        default: 'Kingdom Builders Publishing',
    },
    description: {
        type: String,
    },
    coverImage: {
        type: String, // URL to GCS
        required: false, // Made optional for backward compatibility with existing playlists
    },
    category: {
        type: String,
        default: 'Music',
        // No enum restriction - allows any category name from the Categories collection
    },
    type: {
        type: String,
        enum: ['Song', 'Audiobook'],
        required: true,
        default: 'Song',
    },
    items: [audioItemSchema], // Embedded audio items (songs or episodes)
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft',
    },
    playCount: {
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

// Update updatedAt on save
playlistSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
        next();
    }
});

module.exports = mongoose.model('Playlist', playlistSchema);
