const mongoose = require('mongoose');

const lessonSchema = new mongoose.Schema({
    // Basic lesson information
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },

    // Lesson Type / Subject
    type: {
        type: String,
        enum: [
            'Bible Study',
            'Daily Verse',
            'Science', 
            'Math', 
            'History', 
            'English', 
            'Reading',
            'Arts & Crafts', 
            'Music',
            'Physical Education',
            'Life Skills',
            'Technology',
            'Social Studies',
            'Nature'
        ],
        default: 'Bible Study',
    },

    // Target Age Group
    ageGroup: {
        type: String,
        enum: ['4-6', '6-8', '8-10', '10-12', 'all'],
        default: 'all',
    },

    // Video content - supports multiple episodes
    // Legacy single video (for backward compatibility)
    video: {
        url: {
            type: String, // URL to GCS: lessons/{lessonId}/video/filename
        },
        thumbnail: {
            type: String, // URL to GCS: lessons/{lessonId}/thumbnail/filename
        },
        duration: {
            type: Number, // Duration in seconds
        },
    },
    
    // New: Multiple episodes support
    episodes: [{
        episodeNumber: {
            type: Number,
            required: true,
        },
        title: {
            type: String, // Optional: "Episode 1" or custom title
        },
        url: {
            type: String, // URL to GCS: lessons/{lessonId}/episodes/episode-{n}.mp4
            required: true,
        },
        thumbnail: {
            type: String, // Optional thumbnail for this episode
        },
        duration: {
            type: Number, // Duration in seconds
        },
    }],

    // Captions with timestamps
    captions: [{
        text: {
            type: String,
            required: true,
        },
        startTime: {
            type: Number, // Start time in seconds
            required: true,
        },
        endTime: {
            type: Number, // End time in seconds
            required: true,
        },
    }],

    // Devotional content (screen 2)
    devotional: {
        title: {
            type: String,
        },
        content: {
            type: String,
        },
        verse: {
            type: String, // Bible verse reference
        },
        verseText: {
            type: String, // Full verse text
        },
    },

    // Activity content (screen 3)
    activity: {
        type: {
            type: String,
            enum: ['quiz', 'reflection'],
            required: true,
        },
        title: {
            type: String,
        },
        // For quiz type - support both old format (single question) and new format (multiple questions)
        content: {
            type: String, // Legacy: single question text
        },
        options: [{ // Legacy: options for single question
            text: {
                type: String,
            },
            isCorrect: {
                type: Boolean,
                default: false,
            },
        }],
        // New format: array of questions for quiz
        questions: [{
            question: {
                type: String,
            },
            options: [{
                text: {
                    type: String,
                },
                isCorrect: {
                    type: Boolean,
                    default: false,
                },
            }],
        }],
        // For reflection type
        reflectionPrompt: {
            type: String,
        },
    },

    // Scheduling
    scheduledDate: {
        type: Date, // When the lesson should be available
    },
    publishedDate: {
        type: Date, // When the lesson was published
    },

    // Status
    status: {
        type: String,
        enum: ['draft', 'scheduled', 'published', 'archived'],
        default: 'draft',
    },

    // Reward
    coinReward: {
        type: Number,
        default: 50, // Default 50 gold coins
    },

    // Order/Position for drag-and-drop
    order: {
        type: Number,
        default: 0,
    },
    
    // Analytics counters
    viewCount: {
        type: Number,
        default: 0,
    },
    completionCount: {
        type: Number,
        default: 0,
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
});

// Update updatedAt on save
lessonSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
        next();
    }
});

// Index for efficient queries
lessonSchema.index({ status: 1, scheduledDate: 1 });
lessonSchema.index({ order: 1 });

module.exports = mongoose.model('Lesson', lessonSchema);

