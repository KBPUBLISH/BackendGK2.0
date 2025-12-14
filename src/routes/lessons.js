const express = require('express');
const router = express.Router();
const Lesson = require('../models/Lesson');
const LessonCompletion = require('../models/LessonCompletion');
const LessonDayPlan = require('../models/LessonDayPlan');
const LessonWatchProgress = require('../models/LessonWatchProgress');
const { generateActivityFromDevotional } = require('../services/aiService');
const { notifyNewLesson } = require('../services/notificationService');

// ==========================
// Daily Planner Helpers
// ==========================
const parseDateKeyUTC = (dateKey) => {
    // dateKey is a calendar date (YYYY-MM-DD). Day-of-week is invariant, so UTC parsing is safe.
    const d = new Date(`${dateKey}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    return d;
};

const formatDateKeyUTC = (d) => {
    return d.toISOString().slice(0, 10);
};

const addDaysUTC = (d, deltaDays) => {
    const out = new Date(d);
    out.setUTCDate(out.getUTCDate() + deltaDays);
    return out;
};

const getWeekKeyMondayUTC = (dateKey) => {
    const d = parseDateKeyUTC(dateKey);
    if (!d) return null;
    const dow = d.getUTCDay(); // 0=Sun..6=Sat
    const daysToMonday = dow === 0 ? -6 : 1 - dow; // shift to Monday
    const monday = addDaysUTC(d, daysToMonday);
    return formatDateKeyUTC(monday);
};

const isWeekendUTC = (dateKey) => {
    const d = parseDateKeyUTC(dateKey);
    if (!d) return false;
    const dow = d.getUTCDay();
    return dow === 0 || dow === 6;
};

const pickRandom = (arr, n) => {
    if (!Array.isArray(arr) || arr.length === 0) return [];
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, Math.min(n, copy.length));
};

// ==========================
// GET /api/lessons/planner/day
// Locked per profileId + dateKey
// ==========================
router.get('/planner/day', async (req, res) => {
    try {
        const { profileId, dateKey, ageGroup } = req.query;
        if (!profileId || !dateKey) {
            return res.status(400).json({ message: 'profileId and dateKey are required (YYYY-MM-DD)' });
        }
        const parsed = parseDateKeyUTC(String(dateKey));
        if (!parsed) {
            return res.status(400).json({ message: 'Invalid dateKey; expected YYYY-MM-DD' });
        }

        // Return existing locked plan if present
        const existing = await LessonDayPlan.findOne({ profileId: String(profileId), dateKey: String(dateKey) })
            .populate('slots.lessonId')
            .lean();
        if (existing) {
            return res.json({
                profileId: existing.profileId,
                dateKey: existing.dateKey,
                weekKey: existing.weekKey,
                slots: existing.slots.map(s => ({
                    slotIndex: s.slotIndex,
                    isDailyVerse: !!s.isDailyVerse,
                    lesson: s.lessonId,
                })),
            });
        }

        const weekKey = getWeekKeyMondayUTC(String(dateKey));
        if (!weekKey) {
            return res.status(400).json({ message: 'Invalid dateKey; could not compute weekKey' });
        }

        // Gather already assigned lessons for this profile in this week window (Mon-Fri rules)
        const existingWeekPlans = await LessonDayPlan.find({ profileId: String(profileId), weekKey })
            .select('slots.lessonId')
            .lean();
        const alreadyAssigned = new Set();
        existingWeekPlans.forEach(p => {
            (p.slots || []).forEach(s => {
                if (s.lessonId) alreadyAssigned.add(String(s.lessonId));
            });
        });

        const kidAgeGroup = String(ageGroup || 'all');
        const ageQuery = {
            $or: [{ ageGroup: kidAgeGroup }, { ageGroup: 'all' }],
        };

        const playableQuery = {
            $or: [
                { 'video.url': { $exists: true, $ne: '' } },
                { 'episodes.0.url': { $exists: true, $ne: '' } },
            ],
        };

        const statusQuery = { $or: [{ status: 'published' }, { status: 'scheduled' }] };

        // Load watch progress once
        const watched = await LessonWatchProgress.find({
            profileId: String(profileId),
            maxPercentWatched: { $gte: 0.5 },
        }).select('lessonId').lean();
        const seenSet = new Set(watched.map(w => String(w.lessonId)));

        // Candidate pools
        const dailyVerseCandidates = await Lesson.find({
            ...statusQuery,
            ...ageQuery,
            ...playableQuery,
            type: 'Daily Verse',
        }).lean();

        const generalCandidates = await Lesson.find({
            ...statusQuery,
            ...ageQuery,
            ...playableQuery,
            type: { $ne: 'Daily Verse' },
        }).lean();

        const weekend = isWeekendUTC(String(dateKey));
        const needCount = weekend ? 1 : 3;

        const excludedWeek = (lesson) => alreadyAssigned.has(String(lesson._id));
        const excludedSeen = (lesson) => seenSet.has(String(lesson._id));

        // Select Daily Verse
        const dailyVerseUnseen = dailyVerseCandidates.filter(l => !excludedWeek(l) && !excludedSeen(l));
        const dailyVerseFallback = dailyVerseCandidates.filter(l => !excludedWeek(l));
        const dailyVersePick = pickRandom(dailyVerseUnseen.length ? dailyVerseUnseen : dailyVerseFallback, 1)[0] || null;

        const picked = [];
        if (dailyVersePick) picked.push({ lesson: dailyVersePick, isDailyVerse: true });

        if (!weekend) {
            const remainingNeed = needCount - picked.length;
            const generalUnseen = generalCandidates.filter(l => !excludedWeek(l) && !excludedSeen(l));
            const generalFallback = generalCandidates.filter(l => !excludedWeek(l));
            const generalPick = pickRandom(generalUnseen.length ? generalUnseen : generalFallback, remainingNeed);
            generalPick.forEach(l => picked.push({ lesson: l, isDailyVerse: false }));
        }

        // If we still don't have enough (extreme fallback), allow repeats from week but still unique within day.
        const pickedIds = new Set(picked.map(p => String(p.lesson._id)));
        if (picked.length < needCount) {
            const pool = weekend ? dailyVerseCandidates : [...dailyVerseCandidates, ...generalCandidates];
            const fill = pickRandom(pool.filter(l => !pickedIds.has(String(l._id))), needCount - picked.length);
            fill.forEach(l => picked.push({ lesson: l, isDailyVerse: l.type === 'Daily Verse' }));
        }

        // Build and save plan
        const slots = picked.slice(0, needCount).map((p, idx) => ({
            slotIndex: idx,
            lessonId: p.lesson._id,
            isDailyVerse: !!p.isDailyVerse,
        }));

        const created = await LessonDayPlan.create({
            profileId: String(profileId),
            dateKey: String(dateKey),
            weekKey,
            slots,
        });

        const populated = await LessonDayPlan.findById(created._id).populate('slots.lessonId').lean();
        return res.json({
            profileId: populated.profileId,
            dateKey: populated.dateKey,
            weekKey: populated.weekKey,
            slots: populated.slots.map(s => ({
                slotIndex: s.slotIndex,
                isDailyVerse: !!s.isDailyVerse,
                lesson: s.lessonId,
            })),
        });
    } catch (error) {
        console.error('Planner day error:', error);
        res.status(500).json({ message: 'Planner failed', error: error.message });
    }
});

// ==========================
// POST /api/lessons/planner/progress
// Body: { profileId, lessonId, percentWatched, dateKey }
// ==========================
router.post('/planner/progress', async (req, res) => {
    try {
        const { profileId, lessonId, percentWatched, dateKey } = req.body || {};
        if (!profileId || !lessonId || typeof percentWatched !== 'number') {
            return res.status(400).json({ message: 'profileId, lessonId, and percentWatched are required' });
        }
        const pct = Math.max(0, Math.min(1, percentWatched));
        const update = {
            $set: { lastSeenAt: new Date() },
            $max: { maxPercentWatched: pct },
            $setOnInsert: { firstSeenAt: new Date() },
        };

        // If crossing 50% for the first time, store the client dateKey for day analytics.
        // We do this with a second step after upsert to avoid race conditions.
        const doc = await LessonWatchProgress.findOneAndUpdate(
            { profileId: String(profileId), lessonId },
            update,
            { upsert: true, new: true }
        );

        if (dateKey && doc && doc.maxPercentWatched >= 0.5 && !doc.seen50DateKey) {
            await LessonWatchProgress.updateOne(
                { _id: doc._id, seen50DateKey: { $exists: false } },
                { $set: { seen50DateKey: String(dateKey) } }
            ).catch(() => { });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Planner progress error:', error);
        res.status(500).json({ message: 'Progress update failed', error: error.message });
    }
});

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
        
        console.log('📚 GET /api/lessons called with:', { status, published, scheduledDate });
        
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
            console.log('📚 No status filter (status=all)');
        } else if (status) {
            query.status = status;
            console.log('📚 Filtering by status:', status);
        } else if (published === 'true') {
            // If published=true, get published or scheduled lessons
            // Get all published lessons, or scheduled lessons (regardless of date)
            query.$or = [
                { status: 'published' },
                { status: 'scheduled' }
            ];
            console.log('📚 Filtering by published=true (status: published OR scheduled)');
        } else {
            // Default: only show published or scheduled lessons in the main app
            query.$or = [
                { status: 'published' },
                { status: 'scheduled' }
            ];
            console.log('📚 Default filter (status: published OR scheduled)');
        }
        
        console.log('📚 Final query:', JSON.stringify(query));
        
        // Get total count for pagination metadata
        const total = await Lesson.countDocuments(query);
        console.log('📚 Total lessons matching query:', total);
        
        // Also log total in DB for debugging
        const allCount = await Lesson.countDocuments({});
        console.log('📚 Total lessons in database (no filter):', allCount);
        
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

