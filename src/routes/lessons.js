const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');
const LessonCompletion = require('../models/LessonCompletion');
const { generateActivityFromDevotional } = require('../services/aiService');
const { notifyNewLesson } = require('../services/notificationService');

// GET /api/lessons - Get all lessons (with optional filtering)
// Query params: status, scheduledDate, published
router.get('/', async (req, res) => {
    try {
        const { status, published, scheduledDate } = req.query;
        
        // Build query
        const query = {};
        
        if (status) {
            query.status = status;
        }
        
        // If published=true, get published or scheduled lessons
        if (published === 'true') {
            // Get all published lessons, or scheduled lessons (regardless of date)
            query.$or = [
                { status: 'published' },
                { status: 'scheduled' }
            ];
            // Don't filter by date - show all published/scheduled lessons
        }
        
        const lessons = await Lesson.find(query)
            .sort({ order: 1, createdAt: -1 });
        
        res.json(lessons);
    } catch (error) {
        console.error('Error fetching lessons:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET /api/lessons/:id - Get a single lesson
router.get('/:id', async (req, res) => {
    try {
        const lesson = await Lesson.findById(req.params.id);
        
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }
        
        res.json(lesson);
    } catch (error) {
        console.error('Error fetching lesson:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /api/lessons - Create a new lesson
router.post('/', async (req, res) => {
    try {
        const lessonData = {
            title: req.body.title,
            description: req.body.description,
            video: req.body.video,
            captions: req.body.captions || [],
            devotional: req.body.devotional || {},
            activity: req.body.activity,
            scheduledDate: req.body.scheduledDate,
            status: req.body.status || 'draft',
            coinReward: req.body.coinReward || 50,
            order: req.body.order || 0,
        };
        
        // Validate required fields
        if (!lessonData.title) {
            return res.status(400).json({ message: 'Title is required' });
        }
        
        if (!lessonData.video || !lessonData.video.url) {
            return res.status(400).json({ message: 'Video URL is required' });
        }
        
        if (!lessonData.activity || !lessonData.activity.type) {
            return res.status(400).json({ message: 'Activity type is required' });
        }
        
        // Validate activity based on type
        if (lessonData.activity.type === 'quiz') {
            if (!lessonData.activity.questions || !Array.isArray(lessonData.activity.questions) || lessonData.activity.questions.length === 0) {
                // Check legacy format
                if (!lessonData.activity.content) {
                    return res.status(400).json({ message: 'Quiz must have questions or content' });
                }
            }
        } else if (lessonData.activity.type === 'reflection') {
            if (!lessonData.activity.content) {
                return res.status(400).json({ message: 'Reflection prompt is required' });
            }
        }
        
        const lesson = new Lesson(lessonData);
        const newLesson = await lesson.save();
        
        // Send notification if lesson is published
        if (newLesson.status === 'published') {
            notifyNewLesson(newLesson).catch(err => console.error('Notification error:', err));
        }
        
        res.status(201).json(newLesson);
    } catch (error) {
        console.error('Error creating lesson:', error);
        res.status(400).json({ message: error.message });
    }
});

// PUT /api/lessons/:id - Update a lesson
router.put('/:id', async (req, res) => {
    try {
        const lesson = await Lesson.findById(req.params.id);
        
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }
        
        // Update fields
        if (req.body.title !== undefined) lesson.title = req.body.title;
        if (req.body.description !== undefined) lesson.description = req.body.description;
        if (req.body.video !== undefined) lesson.video = req.body.video;
        if (req.body.captions !== undefined) lesson.captions = req.body.captions;
        if (req.body.devotional !== undefined) lesson.devotional = req.body.devotional;
        if (req.body.activity !== undefined) lesson.activity = req.body.activity;
        if (req.body.scheduledDate !== undefined) lesson.scheduledDate = req.body.scheduledDate;
        if (req.body.status !== undefined) lesson.status = req.body.status;
        if (req.body.coinReward !== undefined) lesson.coinReward = req.body.coinReward;
        if (req.body.order !== undefined) lesson.order = req.body.order;
        
        // Track if status is changing to published
        const wasPublished = lesson.status === 'published';
        
        // Set publishedDate when status changes to published
        if (req.body.status === 'published' && !wasPublished) {
            lesson.publishedDate = new Date();
        }
        
        const updatedLesson = await lesson.save();
        
        // Send notification if lesson was just published
        if (!wasPublished && updatedLesson.status === 'published') {
            notifyNewLesson(updatedLesson).catch(err => console.error('Notification error:', err));
        }
        
        res.json(updatedLesson);
    } catch (error) {
        console.error('Error updating lesson:', error);
        res.status(400).json({ message: error.message });
    }
});

// DELETE /api/lessons/:id - Delete a lesson
router.delete('/:id', async (req, res) => {
    try {
        const lesson = await Lesson.findById(req.params.id);
        
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }
        
        // Also delete all completions for this lesson
        await LessonCompletion.deleteMany({ lessonId: req.params.id });
        
        await lesson.deleteOne();
        
        res.json({ message: 'Lesson deleted successfully' });
    } catch (error) {
        console.error('Error deleting lesson:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET /api/lessons/:id/completion - Get completion status for a user
router.get('/:id/completion', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }
        
        const completion = await LessonCompletion.findOne({
            lessonId: req.params.id,
            userId: userId,
        });
        
        if (!completion) {
            return res.json({
                completed: false,
                progress: {
                    videoWatched: false,
                    devotionalRead: false,
                    activityCompleted: false,
                },
            });
        }
        
        res.json(completion);
    } catch (error) {
        console.error('Error fetching completion:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /api/lessons/:id/complete - Mark lesson as complete
router.post('/:id/complete', async (req, res) => {
    try {
        const { userId, progress, activityResponse, coinsAwarded } = req.body;
        
        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }
        
        // Check if lesson exists
        const lesson = await Lesson.findById(req.params.id);
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }
        
        // Check if already completed
        let completion = await LessonCompletion.findOne({
            lessonId: req.params.id,
            userId: userId,
        });
        
        if (completion) {
            // Update existing completion
            if (progress) {
                completion.progress = { ...completion.progress, ...progress };
            }
            if (activityResponse) {
                completion.activityResponse = activityResponse;
            }
            // Mark as completed if all progress is done
            if (completion.progress.videoWatched && 
                completion.progress.devotionalRead && 
                completion.progress.activityCompleted) {
                completion.completed = true;
                if (coinsAwarded !== undefined) {
                    completion.coinsAwarded = coinsAwarded;
                } else if (!completion.coinsAwarded) {
                    completion.coinsAwarded = lesson.coinReward;
                }
            }
        } else {
            // Create new completion
            const isFullyCompleted = progress && 
                progress.videoWatched && 
                progress.devotionalRead && 
                progress.activityCompleted;
            
            completion = new LessonCompletion({
                lessonId: req.params.id,
                userId: userId,
                coinsAwarded: coinsAwarded || (isFullyCompleted ? lesson.coinReward : 0),
                completed: isFullyCompleted,
                progress: progress || {
                    videoWatched: false,
                    devotionalRead: false,
                    activityCompleted: false,
                },
                activityResponse: activityResponse,
                coinsAwarded: isFullyCompleted ? lesson.coinReward : 0,
            });
        }
        
        await completion.save();
        
        res.json({
            completion,
            coinsAwarded: completion.coinsAwarded,
        });
    } catch (error) {
        console.error('Error completing lesson:', error);
        res.status(400).json({ message: error.message });
    }
});

// GET /api/lessons/completions - Get all completions for a user
router.get('/completions/user', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }
        
        const completions = await LessonCompletion.find({ userId: userId })
            .populate('lessonId')
            .sort({ completedAt: -1 });
        
        res.json(completions);
    } catch (error) {
        console.error('Error fetching completions:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /api/lessons/generate-activity - Generate activity from devotional content using AI
router.post('/generate-activity', async (req, res) => {
    try {
        const { devotionalContent, activityType } = req.body;
        
        if (!devotionalContent || !devotionalContent.trim()) {
            return res.status(400).json({ message: 'Devotional content is required and must not be empty' });
        }
        
        if (!activityType || !['quiz', 'reflection'].includes(activityType)) {
            return res.status(400).json({ message: 'Activity type must be either "quiz" or "reflection"' });
        }
        
        // Generate activity using AI
        const generatedActivity = await generateActivityFromDevotional(
            devotionalContent,
            activityType
        );
        
        res.json(generatedActivity);
    } catch (error) {
        console.error('Error generating activity:', error);
        res.status(500).json({ 
            message: 'Failed to generate activity',
            error: error.message 
        });
    }
});

module.exports = router;

