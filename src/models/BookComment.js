const mongoose = require('mongoose');

const bookCommentSchema = new mongoose.Schema({
    bookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
        required: true,
        index: true,
    },
    userId: {
        type: String,
        required: true,
    },
    userName: {
        type: String,
        default: 'Anonymous',
    },
    commentText: {
        type: String,
        required: true,
        maxlength: 100,
    },
    emoji: {
        type: String,
        required: true,
    },
    colorTheme: {
        type: String,
        enum: ['pink', 'yellow', 'orange', 'gold', 'blue', 'purple', 'green', 'teal', 'indigo', 'amber', 'lime', 'rose', 'cyan', 'emerald'],
        default: 'blue',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

// Index for efficient queries
bookCommentSchema.index({ bookId: 1, createdAt: -1 });

module.exports = mongoose.model('BookComment', bookCommentSchema);

