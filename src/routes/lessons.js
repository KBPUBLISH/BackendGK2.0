const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');
const LessonCompletion = require('../models/LessonCompletion');
const { generateActivityFromDevotional } = require('../services/aiService');
const { notifyNewLesson } = require('../services/notificationService');

// GET /api/lessons/calendar - Get lessons for calendar view (by date range)
// Query params: startDate, endDate (ISO date strings), status (optional, defaults to published/scheduled)
router.get('/calendar', async (req, res) => {
    try {
        const { startDate, endDate, status } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'startDate and endDate are required' });
        }
        
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        // Build query - default to published/scheduled lessons only
        const query = {
            scheduledDate: {
                $gte: start,
                $lte: end
            }
        };
        
        // Portal can pass status=all to see all statuses
        if (status !== 'all') {
            query.$or = [
                { status: 'published' },
                { status: 'scheduled' }
            ];
        }
        
        // Get all lessons with scheduledDate in the range
        const lessons = await Lesson.find(query).sort({ scheduledDate: 1 });
        
        // Group by date for calendar display
        const calendarData = {};
        lessons.forEach(lesson => {
            if (lesson.scheduledDate) {
                const dateKey = lesson.scheduledDate.toISOString().split('T')[0];
                if (!calendarData[dateKey]) {
                    calendarData[dateKey] = [];
                }
                calendarData[dateKey].push(lesson);
            }
        });
        
        res.json({ lessons, calendarData });
    } catch (error) {
        console.error('Error fetching calendar lessons:', error);
        res.status(500).json({ message: error.message });
    }
});

// PUT /api/lessons/schedule - Assign a lesson to a specific date
router.put('/schedule', async (req, res) => {
    try {
        const { lessonId, date } = req.body;
        
        if (!lessonId) {
            return res.status(400).json({ message: 'lessonId is required' });
        }
        
        const lesson = await Lesson.findById(lessonId);
        if (!lesson) {
            return res.status(404).json({ message: 'Lesson not found' });
        }
        
        // If date is null/undefined, unschedule the lesson
        if (!date) {
            lesson.scheduledDate = null;
            lesson.status = 'draft';
        } else {
            lesson.scheduledDate = new Date(date);
            // Set status to scheduled if it was draft
            if (lesson.status === 'draft') {
                lesson.status = 'scheduled';
            }
        }
        
        await lesson.save();
        res.json(lesson);
    } catch (error) {
        console.error('Error scheduling lesson:', error);
        res.status(400).json({ message: error.message });
    }
});

// GET /api/lessons - Get all lessons (with optional filtering and pagination)
// Query params: status, scheduledDate, published, page, limit
router.get('/', async (req, res) => {
    try {
        const { status, published, scheduledDate } = req.query;
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
        const skip = (page - 1) * limit;
        
        // Build query
        const query = {};
        
        // Handle status filtering
        // Portal can pass status=all to get everything, or status=draft for drafts only
        if (status === 'all') {
            // Don't filter by status - show all (for portal)
        } else if (status) {
            query.status = status;
        } else if (published === 'true') {
            // If published=true, get published or scheduled lessons
            // Get all published lessons, or scheduled lessons (regardless of date)
            query.$or = [
                { status: 'published' },
                { status: 'scheduled' }
            ];
        } else {
            // Default: only show published or scheduled lessons in the main app
            query.$or = [
                { status: 'published' },
                { status: 'scheduled' }
            ];
        }
        
        // Get total count for pagination metadata
        const total = await Lesson.countDocuments(query);
        
        const lessons = await Lesson.find(query)
            .sort({ order: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(); // Use lean() for better performance
        
        // Return with pagination metadata
        res.json({
            data: lessons,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                hasMore: page * limit < total
            }
        });
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
            type: req.body.type || 'Bible Study',
            ageGroup: req.body.ageGroup || 'all',
            video: req.body.video || {},
            episodes: req.body.episodes || [],
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
        
        // Require either a video URL or at least one episode with a URL
        const hasVideoUrl = lessonData.video && lessonData.video.url;
        const hasEpisodes = lessonData.episodes && lessonData.episodes.length > 0 && lessonData.episodes.every(ep => ep.url);
        
        if (!hasVideoUrl && !hasEpisodes) {
            return res.status(400).json({ message: 'Either a video URL or at least one episode is required' });
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
        if (req.body.type !== undefined) lesson.type = req.body.type;
        if (req.body.ageGroup !== undefined) lesson.ageGroup = req.body.ageGroup;
        if (req.body.video !== undefined) lesson.video = req.body.video;
        if (req.body.episodes !== undefined) lesson.episodes = req.body.episodes;
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

