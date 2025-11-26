const mongoose = require('mongoose');
const pageSchema = new mongoose.Schema({
    bookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
        required: true,
    },
    pageNumber: {
        type: Number,
        required: true,
    },
    content: {
        type: String, // Text content
    },
    // New fields for page editor
    backgroundUrl: { type: String }, // URL to GCS image or video
    backgroundType: { type: String, enum: ['image', 'video'] },
    scrollUrl: { type: String }, // URL to scroll overlay image
    scrollHeight: { type: Number }, // Height in px for scroll overlay
    textBoxes: [{
        text: String,
        x: Number,
        y: Number,
        alignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    }],
    imageUrl: { type: String }, // legacy field (keep for backward compatibility)
    audioUrl: { type: String }, // URL to GCS (narration)
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Compound index to ensure unique page numbers per book
pageSchema.index({ bookId: 1, pageNumber: 1 }, { unique: true });

module.exports = mongoose.model('Page', pageSchema);
