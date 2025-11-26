const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
    },
    author: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    minAge: {
        type: Number,
        min: 0,
        max: 18,
    },
    category: {
        type: String,
        enum: ['Bible Stories', 'Prayers', 'Songs', 'Devotionals', 'Activities', 'Other'],
        default: 'Other',
    },
    coverImage: {
        type: String, // URL to GCS
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft',
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('Book', bookSchema);
