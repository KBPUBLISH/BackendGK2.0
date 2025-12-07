const mongoose = require('mongoose');

// Page schema - organized as subfolder under each book
const pageSchema = new mongoose.Schema({
    bookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
        required: true,
        index: true, // Index for efficient queries by book
    },
    pageNumber: {
        type: Number,
        required: true,
    },

    // Feature flags
    isColoringPage: {
        type: Boolean,
        default: false
    },
    // If true, coloring page only shows in end modal (not during reading)
    // If false, coloring page shows inline within the book
    coloringEndModalOnly: {
        type: Boolean,
        default: true // Default to end modal only
    },

    // Page content - organized structure
    content: {
        // Text content on the page
        text: {
            type: String,
        },

        // Text boxes with styling
        textBoxes: [{
            text: String,
            x: Number, // percentage (0-100)
            y: Number, // percentage (0-100)
            width: { type: Number, default: 30 }, // percentage (0-100)
            alignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
            fontFamily: { type: String, default: 'Comic Sans MS' },
            fontSize: { type: Number, default: 24 },
            color: { type: String, default: '#4a3b2a' },
        }],
    },

    // Page files - organized per page
    files: {
        // Background (image or video)
        background: {
            url: { type: String }, // URL to GCS: books/{bookId}/pages/page-{pageNumber}.{ext}
            type: { type: String, enum: ['image', 'video'] },
        },

        // Scroll overlay image
        scroll: {
            url: { type: String }, // URL to GCS: books/{bookId}/scroll/filename
            height: { type: Number }, // Height in px for scroll overlay
        },

        // Page-specific images
        images: [{
            url: { type: String }, // URL to GCS: books/{bookId}/pages/images/filename
            filename: { type: String },
            uploadedAt: { type: Date, default: Date.now },
        }],

        // Page-specific videos
        videos: [{
            url: { type: String }, // URL to GCS: books/{bookId}/pages/videos/filename
            filename: { type: String },
            uploadedAt: { type: Date, default: Date.now },
        }],

        // Audio narration for this page
        audio: {
            url: { type: String }, // URL to GCS: books/{bookId}/audio/page-{pageNumber}.mp3
            filename: { type: String },
            uploadedAt: { type: Date, default: Date.now },
        },

        // Sound effect for this page (1-3 seconds, plays on bubble tap)
        soundEffect: {
            url: { type: String }, // URL to GCS: books/{bookId}/sound-effects/page-{pageNumber}.mp3
            filename: { type: String },
            uploadedAt: { type: Date, default: Date.now },
        },
    },

    // Legacy fields (for backward compatibility)
    imageUrl: { type: String },
    audioUrl: { type: String },
    backgroundUrl: { type: String },
    backgroundType: { type: String, enum: ['image', 'video'] },
    scrollUrl: { type: String },
    scrollHeight: { type: Number }, // Legacy single height
    
    // Scroll height settings (percentages for mid and max states)
    scrollMidHeight: { type: Number, default: 30 }, // Mid scroll height %
    scrollMaxHeight: { type: Number, default: 60 }, // Max scroll height %

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
pageSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
        next();
    }
});

// Compound index to ensure unique page numbers per book
pageSchema.index({ bookId: 1, pageNumber: 1 }, { unique: true });

module.exports = mongoose.model('Page', pageSchema);
