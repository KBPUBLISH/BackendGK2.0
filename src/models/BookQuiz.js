const mongoose = require('mongoose');

// Schema for individual quiz questions
const questionSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true,
    },
    options: [{
        text: {
            type: String,
            required: true,
        },
        isCorrect: {
            type: Boolean,
            default: false,
        },
    }],
});

// Schema for user quiz attempts
const attemptSchema = new mongoose.Schema({
    godlykids_user_id: {
        type: String,
        required: true,
    },
    attemptNumber: {
        type: Number,
        required: true,
        min: 1,
        max: 2,
    },
    score: {
        type: Number,
        required: true,
    },
    coinsEarned: {
        type: Number,
        required: true,
    },
    completedAt: {
        type: Date,
        default: Date.now,
    },
});

// Schema for age-grouped questions
const ageGroupQuestionsSchema = new mongoose.Schema({
    ageGroup: {
        type: String,
        required: true,
        enum: ['3-5', '6-8', '9-12'], // Age ranges
    },
    questions: [questionSchema],
});

// Main BookQuiz schema
const bookQuizSchema = new mongoose.Schema({
    bookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Book',
        required: true,
        index: true,
    },
    // Age-grouped quiz questions - each book can have different quizzes for different age groups
    ageGroupedQuestions: [ageGroupQuestionsSchema],
    // Track attempts per user (includes the age group they took)
    attempts: [attemptSchema],
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

// Compound index for efficient lookups
bookQuizSchema.index({ bookId: 1 });

// Helper to determine age group from age
bookQuizSchema.statics.getAgeGroup = function(age) {
    if (!age || age < 3) return '3-5'; // Default to youngest
    if (age <= 5) return '3-5';
    if (age <= 8) return '6-8';
    return '9-12';
};

// Helper method to get questions for a specific age group
bookQuizSchema.methods.getQuestionsForAge = function(age) {
    const ageGroup = this.constructor.getAgeGroup(age);
    const groupData = this.ageGroupedQuestions.find(g => g.ageGroup === ageGroup);
    return groupData ? groupData.questions : null;
};

// Helper method to check if questions exist for an age group
bookQuizSchema.methods.hasQuestionsForAge = function(age) {
    const ageGroup = this.constructor.getAgeGroup(age);
    const groupData = this.ageGroupedQuestions.find(g => g.ageGroup === ageGroup);
    return groupData && groupData.questions && groupData.questions.length > 0;
};

// Helper method to add questions for an age group
bookQuizSchema.methods.setQuestionsForAge = function(age, questions) {
    const ageGroup = this.constructor.getAgeGroup(age);
    const existingIndex = this.ageGroupedQuestions.findIndex(g => g.ageGroup === ageGroup);
    
    if (existingIndex >= 0) {
        this.ageGroupedQuestions[existingIndex].questions = questions;
    } else {
        this.ageGroupedQuestions.push({ ageGroup, questions });
    }
};

// Helper method to get user's attempt count
bookQuizSchema.methods.getUserAttemptCount = function(userId) {
    return this.attempts.filter(a => a.godlykids_user_id === userId).length;
};

// Helper method to check if user can take quiz
bookQuizSchema.methods.canUserTakeQuiz = function(userId) {
    return this.getUserAttemptCount(userId) < 2;
};

// Helper method to add an attempt
bookQuizSchema.methods.addAttempt = function(userId, score, coinsEarned) {
    const attemptCount = this.getUserAttemptCount(userId);
    if (attemptCount >= 2) {
        throw new Error('Maximum attempts reached');
    }
    
    this.attempts.push({
        godlykids_user_id: userId,
        attemptNumber: attemptCount + 1,
        score,
        coinsEarned,
    });
    
    return attemptCount + 1;
};

// Update updatedAt on save
bookQuizSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('BookQuiz', bookQuizSchema);
