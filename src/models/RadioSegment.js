const mongoose = require('mongoose');

const radioSegmentSchema = new mongoose.Schema({
    // Reference to the station this segment belongs to
    stationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RadioStation',
        required: true,
    },
    // Type of segment
    type: {
        type: String,
        enum: ['host_break', 'song', 'jingle'],
        required: true,
    },
    // Order in the radio queue
    order: {
        type: Number,
        required: true,
    },
    // For host_break segments
    hostId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RadioHost',
    },
    // The generated script text for host breaks
    scriptText: {
        type: String,
    },
    // Generated TTS audio URL for host breaks
    audioUrl: {
        type: String,
    },
    // Duration in seconds
    duration: {
        type: Number,
    },
    // For song segments - reference to playlist item
    playlistId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Playlist',
    },
    // Index of the item in the playlist
    playlistItemIndex: {
        type: Number,
    },
    // Cached song info for display
    songInfo: {
        title: String,
        artist: String,
        coverImage: String,
        audioUrl: String,
        duration: Number,
    },
    // The song that comes AFTER this host break (for intro context)
    nextTrack: {
        title: String,
        artist: String,
    },
    // The song that came BEFORE this host break (for outro context)
    previousTrack: {
        title: String,
        artist: String,
    },
    // Generation status
    status: {
        type: String,
        enum: ['pending', 'generating', 'ready', 'error'],
        default: 'pending',
    },
    // Error message if generation failed
    errorMessage: {
        type: String,
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
radioSegmentSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Index for efficient querying by station and order
radioSegmentSchema.index({ stationId: 1, order: 1 });

module.exports = mongoose.model('RadioSegment', radioSegmentSchema);

