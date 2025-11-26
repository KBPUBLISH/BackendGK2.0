const mongoose = require('mongoose');

const playlistSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    coverImage: {
        type: String, // URL to GCS
    },
    items: [{
        title: String,
        audioUrl: String, // URL to GCS
        duration: Number, // in seconds
    }],
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Playlist', playlistSchema);
