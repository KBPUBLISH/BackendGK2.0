const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const AppUser = require('../models/AppUser');
const User = require('../models/User'); // The actual user accounts
const Book = require('../models/Book');
const Playlist = require('../models/Playlist');
const Lesson = require('../models/Lesson');

// Helper to check if a string is a valid MongoDB ObjectId
const isValidObjectId = (id) => {
    if (!id || typeof id !== 'string') return false;
    // ObjectIds are exactly 24 hex characters
    if (!/^[0-9a-fA-F]{24}$/.test(id)) return false;
    try {
        return new mongoose.Types.ObjectId(id).toString() === id;
    } catch {
        return false;
    }
};

// Helper to get date range
const getDateRange = (range) => {
    const now = new Date();
    let startDate;
    
    switch (range) {
        case '24h':
            startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case '7d':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        case '30d':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        case '90d':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
        case 'all':
        default:
            startDate = new Date(0); // Beginning of time
    }
    
    return { startDate, endDate: now };
};

// ============================================
// TRACK EVENT - Main endpoint for logging events from the app
// ============================================
router.post('/track', async (req, res) => {
    try {
        const {
            userId,
            kidProfileId,
            sessionId,
            eventType,
            targetType,
            targetId,
            targetTitle,
            metadata,
            platform,
            deviceType,
            appVersion,
        } = req.body;

        if (!userId || !eventType) {
            return res.status(400).json({ error: 'userId and eventType are required' });
        }

        const event = new AnalyticsEvent({
            userId,
            kidProfileId,
            sessionId,
            eventType,
            targetType,
            targetId,
            targetTitle,
            metadata: metadata || {},
            platform: platform || 'unknown',
            deviceType: deviceType || 'unknown',
            appVersion,
        });

        await event.save();

        // Update aggregate counters on content models
        if (targetId) {
            await updateContentCounters(eventType, targetType, targetId);
        }

        // Update user stats if applicable
        if (userId) {
            await updateUserStats(userId, eventType, metadata);
        }

        res.status(201).json({ success: true, eventId: event._id });
    } catch (error) {
        console.error('Error tracking analytics event:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper to update content counters
async function updateContentCounters(eventType, targetType, targetId) {
    try {
        const updateOps = {};
        
        switch (eventType) {
            case 'book_view':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { viewCount: 1 } });
                }
                break;
            case 'book_read_complete':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { readCount: 1 } });
                }
                break;
            case 'book_read_progress':
                // Track reading progress for completion rate calculation
                // metadata should include: { currentPage, totalPages, pagesViewed }
                if (targetType === 'book' && metadata?.pagesViewed && metadata?.totalPages) {
                    const book = await Book.findById(targetId);
                    if (book) {
                        const newTotalPagesViewed = (book.totalPagesViewed || 0) + metadata.pagesViewed;
                        const newTotalReadSessions = (book.totalReadSessions || 0) + 1;
                        const totalPages = metadata.totalPages || 1;
                        // Calculate average completion rate
                        const avgCompletionRate = Math.min(100, Math.round((newTotalPagesViewed / (newTotalReadSessions * totalPages)) * 100));
                        
                        await Book.findByIdAndUpdate(targetId, {
                            $inc: { 
                                totalPagesViewed: metadata.pagesViewed,
                                totalReadSessions: 1 
                            },
                            $set: { averageCompletionRate: avgCompletionRate }
                        });
                    }
                }
                break;
            case 'book_like':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { likeCount: 1 } });
                }
                break;
            case 'book_unlike':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { likeCount: -1 } });
                }
                break;
            case 'book_favorite':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { favoriteCount: 1 } });
                }
                break;
            case 'book_unfavorite':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { favoriteCount: -1 } });
                }
                break;
            case 'quiz_start':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { quizStartCount: 1 } });
                }
                break;
            case 'quiz_complete':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { quizCompletionCount: 1 } });
                }
                break;
            case 'coloring_start':
            case 'coloring_complete':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { coloringSessionsCount: 1 } });
                }
                break;
            case 'game_unlock':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { gameUnlockCount: 1 } });
                }
                break;
            case 'game_open':
                if (targetType === 'book') {
                    await Book.findByIdAndUpdate(targetId, { $inc: { gameOpenCount: 1 } });
                }
                break;
            case 'playlist_view':
                if (targetType === 'playlist') {
                    await Playlist.findByIdAndUpdate(targetId, { $inc: { viewCount: 1 } });
                }
                break;
            case 'playlist_play':
                if (targetType === 'playlist') {
                    await Playlist.findByIdAndUpdate(targetId, { $inc: { playCount: 1 } });
                }
                break;
            case 'playlist_like':
                if (targetType === 'playlist') {
                    await Playlist.findByIdAndUpdate(targetId, { $inc: { likeCount: 1 } });
                }
                break;
            case 'playlist_unlike':
                if (targetType === 'playlist') {
                    await Playlist.findByIdAndUpdate(targetId, { $inc: { likeCount: -1 } });
                }
                break;
            case 'playlist_favorite':
                if (targetType === 'playlist') {
                    await Playlist.findByIdAndUpdate(targetId, { $inc: { favoriteCount: 1 } });
                }
                break;
            case 'playlist_unfavorite':
                if (targetType === 'playlist') {
                    await Playlist.findByIdAndUpdate(targetId, { $inc: { favoriteCount: -1 } });
                }
                break;
            case 'lesson_view':
                if (targetType === 'lesson') {
                    await Lesson.findByIdAndUpdate(targetId, { $inc: { viewCount: 1 } });
                }
                break;
            case 'lesson_complete':
                if (targetType === 'lesson') {
                    await Lesson.findByIdAndUpdate(targetId, { $inc: { completionCount: 1 } });
                }
                break;
        }
    } catch (error) {
        console.error('Error updating content counters:', error);
    }
}

// Helper to update user stats
async function updateUserStats(userId, eventType, metadata) {
    try {
        const update = { lastActiveAt: new Date() };
        
        switch (eventType) {
            case 'session_end':
                if (metadata?.duration) {
                    update.$inc = { 
                        'stats.totalSessions': 1,
                        'stats.totalTimeSpent': metadata.duration 
                    };
                }
                break;
            case 'book_read_complete':
                update.$inc = { 'stats.booksRead': 1 };
                break;
            case 'playlist_play':
                update.$inc = { 'stats.playlistsPlayed': 1 };
                break;
            case 'lesson_complete':
                update.$inc = { 'stats.lessonsCompleted': 1 };
                break;
            case 'quiz_complete':
                update.$inc = { 'stats.quizzesCompleted': 1 };
                break;
            case 'coloring_complete':
                update.$inc = { 'stats.coloringSessions': 1 };
                break;
            case 'game_open':
                update.$inc = { 'stats.gamesPlayed': 1 };
                break;
        }

        if (Object.keys(update).length > 1 || update.$inc) {
            // Build query - only use _id if it's a valid ObjectId
            const query = isValidObjectId(userId) 
                ? { $or: [{ _id: userId }, { deviceId: userId }] }
                : { deviceId: userId };
            
            await AppUser.findOneAndUpdate(
                query,
                update,
                { upsert: false }
            );
        }
    } catch (error) {
        console.error('Error updating user stats:', error);
    }
}

// ============================================
// DASHBOARD OVERVIEW - Global metrics
// ============================================
router.get('/overview', async (req, res) => {
    try {
        const { range = '30d' } = req.query;
        const { startDate, endDate } = getDateRange(range);

        // Get date ranges for comparison
        const previousRange = range === '30d' ? '60d' : range === '7d' ? '14d' : range;
        const { startDate: prevStartDate } = getDateRange(previousRange);

        // Parallel aggregation queries
        const [
            totalUsers,
            totalAppUsers,
            newUsersInRange,
            activeUsersInRange,
            sessionsInRange,
            avgSessionDuration,
            subscriptionBreakdown,
            onboardingFunnel,
            dailyActiveUsers,
            topContent,
        ] = await Promise.all([
            // Total registered users (from actual User collection)
            User.countDocuments(),
            
            // Total tracked app users (for analytics)
            AppUser.countDocuments(),
            
            // New users in date range (from User collection with timestamps)
            User.countDocuments({ createdAt: { $gte: startDate, $lte: endDate } }),
            
            // Active users in date range (unique userIds with events)
            AnalyticsEvent.distinct('userId', { createdAt: { $gte: startDate, $lte: endDate } }).then(ids => ids.filter(id => id).length),
            
            // Total sessions in range
            AnalyticsEvent.countDocuments({ 
                eventType: 'session_start', 
                createdAt: { $gte: startDate, $lte: endDate } 
            }),
            
            // Average session duration
            AnalyticsEvent.aggregate([
                { 
                    $match: { 
                        eventType: 'session_end', 
                        'metadata.duration': { $exists: true },
                        createdAt: { $gte: startDate, $lte: endDate } 
                    } 
                },
                { 
                    $group: { 
                        _id: null, 
                        avgDuration: { $avg: '$metadata.duration' } 
                    } 
                }
            ]),
            
            // Subscription breakdown (from actual User accounts)
            User.aggregate([
                {
                    $group: {
                        _id: { $ifNull: ['$subscriptionStatus', 'free'] },
                        count: { $sum: 1 }
                    }
                }
            ]),
            
            // Onboarding funnel
            getOnboardingFunnel(startDate, endDate),
            
            // Daily active users trend
            AnalyticsEvent.aggregate([
                { 
                    $match: { 
                        createdAt: { $gte: startDate, $lte: endDate } 
                    } 
                },
                {
                    $group: {
                        _id: { 
                            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } 
                        },
                        uniqueUsers: { $addToSet: '$userId' }
                    }
                },
                {
                    $project: {
                        date: '$_id',
                        count: { $size: '$uniqueUsers' }
                    }
                },
                { $sort: { date: 1 } }
            ]),
            
            // Top content
            getTopContent(startDate, endDate),
        ]);

        // Format subscription breakdown
        const subscriptions = {
            free: 0,
            trial: 0,
            active: 0,
            cancelled: 0,
            expired: 0,
        };
        subscriptionBreakdown.forEach(item => {
            if (item._id && subscriptions.hasOwnProperty(item._id)) {
                subscriptions[item._id] = item.count;
            }
        });
        
        const totalPaid = subscriptions.active + subscriptions.trial;
        const totalFree = subscriptions.free + subscriptions.cancelled + subscriptions.expired;
        const conversionRate = totalUsers > 0 ? ((totalPaid / totalUsers) * 100).toFixed(2) : 0;

        res.json({
            dateRange: { startDate, endDate, range },
            users: {
                total: totalUsers, // From actual User accounts
                totalTracked: totalAppUsers, // App users being tracked for analytics
                newInRange: newUsersInRange,
                activeInRange: activeUsersInRange,
            },
            sessions: {
                total: sessionsInRange,
                avgDurationSeconds: avgSessionDuration[0]?.avgDuration || 0,
            },
            subscriptions: {
                breakdown: subscriptions,
                totalPaid,
                totalFree,
                conversionRate: parseFloat(conversionRate),
            },
            onboardingFunnel,
            dailyActiveUsers,
            topContent,
        });
    } catch (error) {
        console.error('Error fetching analytics overview:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper for onboarding funnel
async function getOnboardingFunnel(startDate, endDate) {
    const steps = await AnalyticsEvent.aggregate([
        {
            $match: {
                eventType: { $in: ['onboarding_start', 'onboarding_step', 'onboarding_complete', 'onboarding_skip'] },
                createdAt: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $group: {
                _id: {
                    eventType: '$eventType',
                    step: '$metadata.step'
                },
                count: { $sum: 1 },
                uniqueUsers: { $addToSet: '$userId' }
            }
        }
    ]);

    const funnel = {
        started: 0,
        steps: {},
        completed: 0,
        skipped: 0,
        dropOffRate: 0,
        completionRate: 0,
    };

    steps.forEach(item => {
        if (item._id.eventType === 'onboarding_start') {
            funnel.started = item.uniqueUsers.length;
        } else if (item._id.eventType === 'onboarding_step') {
            funnel.steps[`step_${item._id.step}`] = item.uniqueUsers.length;
        } else if (item._id.eventType === 'onboarding_complete') {
            funnel.completed = item.uniqueUsers.length;
        } else if (item._id.eventType === 'onboarding_skip') {
            funnel.skipped = item.uniqueUsers.length;
        }
    });

    if (funnel.started > 0) {
        funnel.completionRate = ((funnel.completed / funnel.started) * 100).toFixed(2);
        funnel.dropOffRate = (((funnel.started - funnel.completed - funnel.skipped) / funnel.started) * 100).toFixed(2);
    }

    return funnel;
}

// Helper for top content
async function getTopContent(startDate, endDate) {
    const [topBooks, topPlaylists, topLessons] = await Promise.all([
        Book.find({ status: 'published' })
            .sort({ viewCount: -1, readCount: -1 })
            .limit(5)
            .select('title viewCount readCount likeCount favoriteCount')
            .lean(),
        Playlist.find({ status: 'published' })
            .sort({ viewCount: -1, playCount: -1 })
            .limit(5)
            .select('title viewCount playCount likeCount favoriteCount')
            .lean(),
        Lesson.find({ status: 'published' })
            .sort({ viewCount: -1, completionCount: -1 })
            .limit(5)
            .select('title viewCount completionCount')
            .lean(),
    ]);

    return { topBooks, topPlaylists, topLessons };
}

// ============================================
// TOP USERS - Leaderboard of most active users
// ============================================
router.get('/top-users', async (req, res) => {
    try {
        const { range = '30d', limit = 20 } = req.query;
        const { startDate, endDate } = getDateRange(range);

        const topUsers = await AppUser.find({
            lastActiveAt: { $gte: startDate }
        })
            .sort({ 'stats.totalTimeSpent': -1, 'stats.totalSessions': -1 })
            .limit(parseInt(limit))
            .select('email stats kidProfiles createdAt lastActiveAt subscriptionStatus')
            .lean();

        // Add rank
        const rankedUsers = topUsers.map((user, index) => ({
            rank: index + 1,
            ...user,
            kidProfileCount: user.kidProfiles?.length || 0,
        }));

        res.json(rankedUsers);
    } catch (error) {
        console.error('Error fetching top users:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PER-BOOK ANALYTICS
// ============================================
router.get('/book/:bookId', async (req, res) => {
    try {
        const { bookId } = req.params;
        const { range = 'all' } = req.query;
        const { startDate, endDate } = getDateRange(range);

        const book = await Book.findById(bookId)
            .select('title viewCount readCount likeCount favoriteCount quizStartCount quizCompletionCount coloringSessionsCount gameUnlockCount gameOpenCount hasQuiz averageCompletionRate totalReadSessions')
            .lean();

        if (!book) {
            return res.status(404).json({ error: 'Book not found' });
        }

        // Get event-based analytics for the date range
        const eventStats = await AnalyticsEvent.aggregate([
            {
                $match: {
                    targetId: bookId,
                    targetType: 'book',
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$eventType',
                    count: { $sum: 1 },
                    uniqueUsers: { $addToSet: '$userId' }
                }
            }
        ]);

        // Get daily views trend
        const dailyViews = await AnalyticsEvent.aggregate([
            {
                $match: {
                    targetId: bookId,
                    targetType: 'book',
                    eventType: 'book_view',
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Format event stats
        const stats = {};
        eventStats.forEach(item => {
            stats[item._id] = {
                total: item.count,
                uniqueUsers: item.uniqueUsers.length
            };
        });

        res.json({
            book: {
                _id: book._id,
                title: book.title,
            },
            counters: {
                views: book.viewCount || 0,
                reads: book.readCount || 0,
                likes: book.likeCount || 0,
                favorites: book.favoriteCount || 0,
                quizStarts: book.quizStartCount || 0,
                quizCompletions: book.quizCompletionCount || 0,
                coloringSessions: book.coloringSessionsCount || 0,
                gameUnlocks: book.gameUnlockCount || 0,
                gameOpens: book.gameOpenCount || 0,
            },
            dateRangeStats: stats,
            dailyViews,
            quizCompletionRate: book.quizStartCount > 0 
                ? ((book.quizCompletionCount / book.quizStartCount) * 100).toFixed(2) 
                : 0,
            // Average completion rate - what % of the book users read on average
            averageCompletionRate: book.averageCompletionRate || 0,
            totalReadSessions: book.totalReadSessions || 0,
        });
    } catch (error) {
        console.error('Error fetching book analytics:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// PER-PLAYLIST ANALYTICS
// ============================================
router.get('/playlist/:playlistId', async (req, res) => {
    try {
        const { playlistId } = req.params;
        const { range = 'all' } = req.query;
        const { startDate, endDate } = getDateRange(range);

        const playlist = await Playlist.findById(playlistId)
            .select('title viewCount playCount likeCount favoriteCount items')
            .lean();

        if (!playlist) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        // Get event-based analytics for the date range
        const eventStats = await AnalyticsEvent.aggregate([
            {
                $match: {
                    targetId: playlistId,
                    targetType: 'playlist',
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$eventType',
                    count: { $sum: 1 },
                    uniqueUsers: { $addToSet: '$userId' }
                }
            }
        ]);

        // Get daily plays trend
        const dailyPlays = await AnalyticsEvent.aggregate([
            {
                $match: {
                    targetId: playlistId,
                    targetType: 'playlist',
                    eventType: { $in: ['playlist_view', 'playlist_play'] },
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Format event stats
        const stats = {};
        eventStats.forEach(item => {
            stats[item._id] = {
                total: item.count,
                uniqueUsers: item.uniqueUsers.length
            };
        });

        // Calculate total plays from items
        const itemPlays = playlist.items?.reduce((sum, item) => sum + (item.playCount || 0), 0) || 0;

        res.json({
            playlist: {
                _id: playlist._id,
                title: playlist.title,
                itemCount: playlist.items?.length || 0,
            },
            counters: {
                views: playlist.viewCount || 0,
                plays: playlist.playCount || 0,
                itemPlays,
                likes: playlist.likeCount || 0,
                favorites: playlist.favoriteCount || 0,
            },
            dateRangeStats: stats,
            dailyPlays,
        });
    } catch (error) {
        console.error('Error fetching playlist analytics:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// LESSONS SUMMARY
// ============================================
router.get('/lessons/summary', async (req, res) => {
    try {
        const { range = '30d' } = req.query;
        const { startDate, endDate } = getDateRange(range);

        const lessons = await Lesson.find({ status: 'published' })
            .sort({ viewCount: -1 })
            .select('title viewCount completionCount coinReward scheduledDate')
            .lean();

        // Get completion rate for each lesson
        const lessonsWithRates = lessons.map(lesson => ({
            ...lesson,
            completionRate: lesson.viewCount > 0 
                ? ((lesson.completionCount / lesson.viewCount) * 100).toFixed(2) 
                : 0,
        }));

        // Overall stats
        const totalViews = lessons.reduce((sum, l) => sum + (l.viewCount || 0), 0);
        const totalCompletions = lessons.reduce((sum, l) => sum + (l.completionCount || 0), 0);

        res.json({
            summary: {
                totalLessons: lessons.length,
                totalViews,
                totalCompletions,
                overallCompletionRate: totalViews > 0 
                    ? ((totalCompletions / totalViews) * 100).toFixed(2) 
                    : 0,
            },
            lessons: lessonsWithRates,
        });
    } catch (error) {
        console.error('Error fetching lessons summary:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// FEATURE USAGE
// ============================================
router.get('/feature-usage', async (req, res) => {
    try {
        const { range = '30d' } = req.query;
        const { startDate, endDate } = getDateRange(range);

        const featureEvents = [
            'quiz_start', 'quiz_complete',
            'coloring_start', 'coloring_complete',
            'game_unlock', 'game_open',
            'devotional_view', 'devotional_complete',
            'voice_unlock', 'shop_purchase',
        ];

        const usage = await AnalyticsEvent.aggregate([
            {
                $match: {
                    eventType: { $in: featureEvents },
                    createdAt: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: '$eventType',
                    count: { $sum: 1 },
                    uniqueUsers: { $addToSet: '$userId' }
                }
            }
        ]);

        const features = {};
        usage.forEach(item => {
            features[item._id] = {
                totalEvents: item.count,
                uniqueUsers: item.uniqueUsers.length,
            };
        });

        res.json({
            dateRange: { startDate, endDate, range },
            features,
        });
    } catch (error) {
        console.error('Error fetching feature usage:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// REGISTER/CREATE APP USER (for tracking)
// ============================================
router.post('/user/register', async (req, res) => {
    try {
        const {
            deviceId,
            email,
            platform,
        } = req.body;

        if (!deviceId) {
            return res.status(400).json({ error: 'deviceId is required' });
        }

        // Check if user already exists
        let user = await AppUser.findOne({ deviceId });
        
        if (user) {
            // Update existing user
            if (email && !user.email) {
                user.email = email;
            }
            user.lastActiveAt = new Date();
            await user.save();
        } else {
            // Create new user
            const referralCode = generateReferralCode();
            user = new AppUser({
                deviceId,
                email,
                platform: platform || 'unknown',
                referralCode,
                onboardingStatus: 'not_started',
            });
            await user.save();
        }

        res.status(201).json({ 
            success: true, 
            userId: user._id,
            referralCode: user.referralCode,
        });
    } catch (error) {
        console.error('Error registering app user:', error);
        res.status(500).json({ error: error.message });
    }
});

// Helper to generate referral code
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = 'GK';
    for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ============================================
// UPDATE USER ONBOARDING STATUS
// ============================================
router.post('/user/onboarding', async (req, res) => {
    try {
        const { userId, step, status, metadata } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const update = {
            lastActiveAt: new Date(),
        };

        if (step !== undefined) {
            update.onboardingStep = step;
        }

        if (status) {
            update.onboardingStatus = status;
            if (status === 'in_progress' && !update.onboardingStartedAt) {
                update.onboardingStartedAt = new Date();
            }
            if (status === 'completed') {
                update.onboardingCompletedAt = new Date();
            }
        }

        // Handle both ObjectId and deviceId-based lookups
        let user;
        if (isValidObjectId(userId)) {
            user = await AppUser.findByIdAndUpdate(userId, update, { new: true });
        } else {
            // For anonymous users, try to find by deviceId
            user = await AppUser.findOneAndUpdate({ deviceId: userId }, update, { new: true });
        }

        if (!user) {
            // For anonymous users without an AppUser record, just return success
            // (they may not have registered yet)
            return res.json({ success: true, message: 'User not found, skipping update' });
        }

        res.json({ success: true, user });
    } catch (error) {
        console.error('Error updating onboarding status:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================
// UPDATE USER SUBSCRIPTION STATUS
// ============================================
router.post('/user/subscription', async (req, res) => {
    try {
        const { userId, status, plan, startDate, endDate } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        const update = {
            lastActiveAt: new Date(),
        };

        if (status) {
            update.subscriptionStatus = status;
        }
        if (plan) {
            update.subscriptionPlan = plan;
        }
        if (startDate) {
            update.subscriptionStartDate = new Date(startDate);
        }
        if (endDate) {
            update.subscriptionEndDate = new Date(endDate);
        }

        // Handle both ObjectId and deviceId-based lookups
        let user;
        if (isValidObjectId(userId)) {
            user = await AppUser.findByIdAndUpdate(userId, update, { new: true });
        } else {
            // For anonymous users, try to find by deviceId
            user = await AppUser.findOneAndUpdate({ deviceId: userId }, update, { new: true });
        }

        if (!user) {
            // For anonymous users without an AppUser record, just return success
            return res.json({ success: true, message: 'User not found, skipping update' });
        }

        res.json({ success: true, user });
    } catch (error) {
        console.error('Error updating subscription status:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

