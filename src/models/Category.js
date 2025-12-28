const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true,
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
    // Category type: determines where this category appears in the app
    // 'Book' = Read page, 'Audio' = Listen page
    contentType: {
        type: String,
        enum: ['Book', 'Audio'],
        default: 'Book',
        required: true,
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

categorySchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Category', categorySchema);

