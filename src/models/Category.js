const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    type: {
        type: String,
        enum: ['book', 'audio'],
        required: true,
        default: 'book',
    },
    description: {
        type: String,
    },
    color: {
        type: String,
        default: '#6366f1', // Default indigo color
    },
    icon: {
        type: String, // Icon name or emoji
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

// Compound unique index: name must be unique per type
categorySchema.index({ name: 1, type: 1 }, { unique: true });

categorySchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
    next();
    }
});

module.exports = mongoose.model('Category', categorySchema);

