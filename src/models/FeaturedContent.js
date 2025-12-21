const mongoose = require('mongoose');

/**
 * FeaturedContent Schema
 * Manages curated content shown to new users on their first app experience
 * Controlled via the portal admin panel
 */

const featuredItemSchema = new mongoose.Schema({
    contentId: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true 
    },
    contentType: { 
        type: String, 
        enum: ['book', 'playlist', 'lesson'], 
        required: true 
    },
    order: { 
        type: Number, 
        default: 0 
    },
    // Optional overrides
    title: String,
    subtitle: String,
    imageUrl: String,
}, { _id: false });

const featuredContentSchema = new mongoose.Schema({
    // Section identifier (e.g., 'new-user-welcome')
    section: {
        type: String,
        required: true,
        unique: true,
    },

    // Display text
    title: {
        type: String,
        default: 'Welcome to Godly Kids!',
    },
    subtitle: {
        type: String,
        default: 'Pick something to start your adventure.',
    },

    // Featured items (unified array)
    items: [featuredItemSchema],

    // Settings
    maxItems: {
        type: Number,
        default: 6,
    },
    skipButtonText: {
        type: String,
        default: 'Skip for now',
    },
    showSkipButton: {
        type: Boolean,
        default: true,
    },
}, {
    timestamps: true, // Automatically manages createdAt and updatedAt
});

module.exports = mongoose.model('FeaturedContent', featuredContentSchema);
