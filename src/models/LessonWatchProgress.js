const mongoose = require('mongoose');

/**
 * Per-profile watch progress for a lesson video.
 * Used for "seen" filtering (>= 50%) in the planner.
 */
const lessonWatchProgressSchema = new mongoose.Schema({
    profileId: {
        type: String,
        required: true,
        index: true,
    },
    lessonId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lesson',
        required: true,
        index: true,
    },
    maxPercentWatched: {
        type: Number,
        default: 0,
    },
    // Device-local YYYY-MM-DD string provided by the app when the 50% threshold is crossed.
    seen50DateKey: {
        type: String,
        index: true,
    },
    firstSeenAt: {
        type: Date,
        default: Date.now,
    },
    lastSeenAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
});

lessonWatchProgressSchema.index({ profileId: 1, lessonId: 1 }, { unique: true });
lessonWatchProgressSchema.index({ profileId: 1, lastSeenAt: -1 });

module.exports = mongoose.model('LessonWatchProgress', lessonWatchProgressSchema);



