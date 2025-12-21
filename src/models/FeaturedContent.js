const mongoose = require('mongoose');

/**
 * FeaturedContent Schema
 * Manages curated content shown to new users on their first app experience
 * Controlled via the portal admin panel
 */
const featuredContentSchema = new mongoose.Schema({
    // Type of featured content section
    section: {
        type: String,
        enum: ['new_user_welcome', 'home_featured', 'seasonal'],
        default: 'new_user_welcome',
        required: true,
        unique: true, // Only one config per section
    },

    // Welcome message shown at top of the screen
    welcomeTitle: {
        type: String,
        default: 'Welcome to Godly Kids!',
    },
    welcomeSubtitle: {
        type: String,
        default: 'Pick something fun to start your adventure:',
    },

    // Featured books (references to Book collection)
    featuredBooks: [{
        bookId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Book',
            required: true,
        },
        order: {
            type: Number,
            default: 0,
        },
        customTitle: String, // Optional override title
        customDescription: String, // Optional short description for new users
    }],

    // Featured playlists/audiobooks (references to Playlist collection)
    featuredPlaylists: [{
        playlistId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Playlist',
            required: true,
        },
        order: {
            type: Number,
            default: 0,
        },
        customTitle: String,
        customDescription: String,
    }],

    // Featured lessons
    featuredLessons: [{
        lessonId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Lesson',
            required: true,
        },
        order: {
            type: Number,
            default: 0,
        },
        customTitle: String,
        customDescription: String,
    }],

    // Settings
    isActive: {
        type: Boolean,
        default: true,
    },
    showSkipButton: {
        type: Boolean,
        default: true,
    },
    skipButtonText: {
        type: String,
        default: 'Explore the App',
    },
    maxItemsToShow: {
        type: Number,
        default: 6, // Show max 6 items on welcome screen
    },

    // Metadata
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
    lastEditedBy: {
        type: String, // Email of admin who last edited
    },
});

// Update timestamp on save
featuredContentSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('FeaturedContent', featuredContentSchema);

