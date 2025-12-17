const mongoose = require('mongoose');

/**
 * Per-profile, per-day locked lesson plan (device-local dateKey).
 * Used by the daily planner algorithm to avoid rerolling when the user taps other days.
 */
const lessonDayPlanSchema = new mongoose.Schema({
    profileId: {
        type: String,
        required: true,
        index: true,
    },
    // Device-local calendar date (YYYY-MM-DD) provided by the client.
    dateKey: {
        type: String,
        required: true,
        index: true,
    },
    // Monday (YYYY-MM-DD) of the week containing dateKey (used for "no repeats within week")
    weekKey: {
        type: String,
        required: true,
        index: true,
    },
    slots: [{
        slotIndex: { type: Number, required: true }, // 0..2
        lessonId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lesson', required: true },
        isDailyVerse: { type: Boolean, default: false },
    }],
    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
    },
});

lessonDayPlanSchema.index({ profileId: 1, dateKey: 1 }, { unique: true });
lessonDayPlanSchema.index({ profileId: 1, weekKey: 1, dateKey: 1 });

module.exports = mongoose.model('LessonDayPlan', lessonDayPlanSchema);


