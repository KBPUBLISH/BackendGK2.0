const express = require('express');
const router = express.Router();
const AppUser = require('../models/AppUser');
const User = require('../models/User');
const OnboardingEvent = require('../models/OnboardingEvent');

/**
 * GET /api/analytics/users
 * Get comprehensive user analytics for the dashboard
 * Merges data from both User (auth) and AppUser (app data) collections
 * 
 * Query params:
 *   sortBy: 'createdAt' (default) | 'lastActiveAt' | 'sessions' | 'coins'
 *   sortOrder: 'desc' (default) | 'asc'
 *   timeRange: '1d' | '1w' | '1m' | '3m' | 'all' (default: 'all')
 */
router.get('/users', async (req, res) => {
    try {
        const { sortBy = 'createdAt', sortOrder = 'desc', timeRange = 'all' } = req.query;
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const monthStart = new Date(todayStart);
        monthStart.setMonth(monthStart.getMonth() - 1);
        
        // Calculate time range filter date
        let timeRangeStart = null;
        switch (timeRange) {
            case '1d':
                timeRangeStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
                break;
            case '1w':
                timeRangeStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 days ago
                break;
            case '1m':
                timeRangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
                break;
            case '3m':
                timeRangeStart = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
                break;
            case 'all':
            default:
                timeRangeStart = null; // No filter
                break;
        }

        // Get users from AppUser collection (app-specific data)
        const appUsers = await AppUser.find({})
            .select('email deviceId coins kidProfiles stats createdAt lastActiveAt subscriptionStatus platform referralCode referralCount notificationEmail emailSignupAt parentName')
            .sort({ createdAt: -1 })
            .lean();

        // Get users from User collection (authentication accounts)
        const authUsers = await User.find({})
            .select('email username isPremium subscriptionProductId subscriptionExpiresAt deviceId createdAt updatedAt')
            .sort({ createdAt: -1 })
            .lean();

        // Create a map of AppUser data by email for quick lookup
        const appUserMap = new Map();
        appUsers.forEach(u => {
            if (u.email) appUserMap.set(u.email.toLowerCase(), u);
            if (u.deviceId) appUserMap.set(u.deviceId, u);
        });

        // Merge: Start with auth users, enrich with app data
        const mergedUsers = [];
        const processedEmails = new Set();

        // First, add all auth users (enriched with app data if available)
        authUsers.forEach(authUser => {
            const email = authUser.email?.toLowerCase();
            const appData = email ? appUserMap.get(email) : null;
            
            mergedUsers.push({
                _id: authUser._id,
                email: authUser.email,
                username: authUser.username,
                deviceId: authUser.deviceId || appData?.deviceId,
                coins: appData?.coins || 0,
                kidProfiles: appData?.kidProfiles || [],
                stats: appData?.stats || {},
                subscriptionStatus: authUser.isPremium ? 'active' : (appData?.subscriptionStatus || 'free'),
                platform: appData?.platform || 'unknown',
                referralCode: appData?.referralCode,
                referralCount: appData?.referralCount || 0,
                notificationEmail: appData?.notificationEmail,
                parentName: appData?.parentName,
                createdAt: authUser.createdAt,
                lastActiveAt: appData?.lastActiveAt || authUser.updatedAt,
                source: 'auth', // Track where this user came from
            });
            
            if (email) processedEmails.add(email);
        });

        // Then add AppUsers that don't have an auth account (anonymous users)
        appUsers.forEach(appUser => {
            const email = appUser.email?.toLowerCase();
            if (email && processedEmails.has(email)) return; // Already added via auth
            
            mergedUsers.push({
                _id: appUser._id,
                email: appUser.email,
                deviceId: appUser.deviceId,
                coins: appUser.coins || 0,
                kidProfiles: appUser.kidProfiles || [],
                stats: appUser.stats || {},
                subscriptionStatus: appUser.subscriptionStatus || 'free',
                platform: appUser.platform || 'unknown',
                referralCode: appUser.referralCode,
                referralCount: appUser.referralCount || 0,
                notificationEmail: appUser.notificationEmail,
                parentName: appUser.parentName,
                createdAt: appUser.createdAt,
                lastActiveAt: appUser.lastActiveAt,
                source: 'app', // Anonymous or app-only user
            });
        });

        // Helper to safely parse dates (returns 0 for invalid dates so they sort to the end)
        const safeDate = (dateVal) => {
            if (!dateVal) return 0;
            const d = new Date(dateVal);
            return isNaN(d.getTime()) ? 0 : d.getTime();
        };

        // Dynamic sorting based on query params
        const isAsc = sortOrder === 'asc';
        mergedUsers.sort((a, b) => {
            let valA, valB;
            
            switch (sortBy) {
                case 'lastActiveAt':
                    valA = safeDate(a.lastActiveAt);
                    valB = safeDate(b.lastActiveAt);
                    break;
                case 'sessions':
                    valA = a.stats?.totalSessions || 0;
                    valB = b.stats?.totalSessions || 0;
                    break;
                case 'coins':
                    valA = a.coins || 0;
                    valB = b.coins || 0;
                    break;
                case 'createdAt':
                default:
                    valA = safeDate(a.createdAt);
                    valB = safeDate(b.createdAt);
                    break;
            }
            
            // For date fields, push invalid/missing to the end
            if (sortBy === 'createdAt' || sortBy === 'lastActiveAt') {
                if (valA === 0 && valB === 0) return 0;
                if (valA === 0) return 1;  // Push A to end
                if (valB === 0) return -1; // Push B to end
            }
            
            // Sort ascending or descending
            return isAsc ? valA - valB : valB - valA;
        });

        // Apply time range filter if specified
        let allUsers = mergedUsers;
        let filteredUsers = mergedUsers;
        
        if (timeRangeStart) {
            // For time-filtered stats, use users active within the time range
            filteredUsers = mergedUsers.filter(u => {
                const lastActive = u.lastActiveAt ? new Date(u.lastActiveAt) : null;
                const created = u.createdAt ? new Date(u.createdAt) : null;
                // Include user if they were active OR created within the time range
                return (lastActive && lastActive >= timeRangeStart) || 
                       (created && created >= timeRangeStart);
            });
        }

        // Count new accounts by time period
        const newToday = allUsers.filter(u => new Date(u.createdAt) >= todayStart).length;
        const newThisWeek = allUsers.filter(u => new Date(u.createdAt) >= weekStart).length;
        const newThisMonth = allUsers.filter(u => new Date(u.createdAt) >= monthStart).length;

        // Active users (by lastActiveAt)
        const activeToday = allUsers.filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= todayStart).length;
        const activeThisWeek = allUsers.filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= weekStart).length;
        const activeThisMonth = allUsers.filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= monthStart).length;

        // Subscription breakdown (use filteredUsers for time-range stats)
        const subscriptionStats = {
            free: statsUsers.filter(u => u.subscriptionStatus === 'free').length,
            trial: statsUsers.filter(u => u.subscriptionStatus === 'trial').length,
            active: statsUsers.filter(u => u.subscriptionStatus === 'active').length,
            cancelled: statsUsers.filter(u => u.subscriptionStatus === 'cancelled').length,
            expired: statsUsers.filter(u => u.subscriptionStatus === 'expired').length,
        };

        // Platform breakdown (use filteredUsers for time-range stats)
        const platformStats = {
            ios: statsUsers.filter(u => u.platform === 'ios').length,
            android: statsUsers.filter(u => u.platform === 'android').length,
            web: statsUsers.filter(u => u.platform === 'web').length,
            unknown: statsUsers.filter(u => !u.platform || u.platform === 'unknown').length,
        };

        // Calculate totals (use filteredUsers for time-range stats)
        const statsUsers = timeRangeStart ? filteredUsers : allUsers;
        const totalCoins = statsUsers.reduce((sum, u) => sum + (u.coins || 0), 0);
        const totalKids = statsUsers.reduce((sum, u) => sum + (u.kidProfiles?.length || 0), 0);
        const totalSessions = statsUsers.reduce((sum, u) => sum + (u.stats?.totalSessions || 0), 0);
        const totalTimeSpentMinutes = Math.round(statsUsers.reduce((sum, u) => sum + (u.stats?.totalTimeSpent || 0), 0) / 60);
        const totalBooksRead = statsUsers.reduce((sum, u) => sum + (u.stats?.booksRead || 0), 0);
        const totalPagesRead = statsUsers.reduce((sum, u) => sum + (u.stats?.pagesRead || 0), 0);
        const totalPlaylistsPlayed = statsUsers.reduce((sum, u) => sum + (u.stats?.playlistsPlayed || 0), 0);
        const totalListeningTimeMinutes = Math.round(statsUsers.reduce((sum, u) => sum + (u.stats?.audioListeningTime || 0), 0) / 60);
        const totalLessonsCompleted = statsUsers.reduce((sum, u) => sum + (u.stats?.lessonsCompleted || 0), 0);
        const totalGamesPlayed = statsUsers.reduce((sum, u) => sum + (u.stats?.gamesPlayed || 0), 0);

        // Helper to format dates safely
        const formatDate = (dateVal) => {
            if (!dateVal) return null;
            const d = new Date(dateVal);
            if (isNaN(d.getTime())) return null;
            return d.toISOString();
        };

        // Format users for display
        const formattedUsers = allUsers.map(user => ({
            id: user._id,
            email: user.email || 'Anonymous',
            username: user.username,
            deviceId: user.deviceId,
            coins: user.coins || 0,
            kidCount: user.kidProfiles?.length || 0,
            kids: user.kidProfiles?.map(k => ({ name: k.name, age: k.age })) || [],
            // Activity stats
            sessions: user.stats?.totalSessions || 0,
            timeSpentMinutes: Math.round((user.stats?.totalTimeSpent || 0) / 60),
            booksRead: user.stats?.booksRead || 0,
            pagesRead: user.stats?.pagesRead || 0,
            playlistsPlayed: user.stats?.playlistsPlayed || 0,
            listeningTimeMinutes: Math.round((user.stats?.audioListeningTime || 0) / 60),
            lessonsCompleted: user.stats?.lessonsCompleted || 0,
            gamesPlayed: user.stats?.gamesPlayed || 0,
            // Progress tracking
            onboardingStep: user.stats?.onboardingStep || 0,
            farthestPage: user.stats?.farthestPageReached || '/',
            // Account info
            subscriptionStatus: user.subscriptionStatus || 'free',
            platform: user.platform || 'unknown',
            referralCode: user.referralCode,
            referralCount: user.referralCount || 0,
            notificationEmail: user.notificationEmail || null,
            parentName: user.parentName || null,
            // Dates - formatted as ISO strings for consistent sorting
            createdAt: formatDate(user.createdAt),
            lastActiveAt: formatDate(user.lastActiveAt),
            // Sortable timestamps (milliseconds) for frontend sorting
            createdAtMs: safeDate(user.createdAt),
            lastActiveAtMs: safeDate(user.lastActiveAt),
            source: user.source, // 'auth' = has login account, 'app' = anonymous/app-only
        }));

        // Count by source (use statsUsers for time-range stats)
        const authUserCount = statsUsers.filter(u => u.source === 'auth').length;
        const appOnlyUserCount = statsUsers.filter(u => u.source === 'app').length;

        // Get daily signups for the past 30 days
        const dailySignups = [];
        for (let i = 29; i >= 0; i--) {
            const dayStart = new Date(todayStart);
            dayStart.setDate(dayStart.getDate() - i);
            const dayEnd = new Date(dayStart);
            dayEnd.setDate(dayEnd.getDate() + 1);
            
            const count = allUsers.filter(u => {
                const created = new Date(u.createdAt);
                return created >= dayStart && created < dayEnd;
            }).length;
            
            dailySignups.push({
                date: dayStart.toISOString().split('T')[0],
                count
            });
        }

        // Get weekly signups for the past 12 weeks
        const weeklySignups = [];
        for (let i = 11; i >= 0; i--) {
            const weekStartDate = new Date(todayStart);
            weekStartDate.setDate(weekStartDate.getDate() - (i * 7));
            const weekEndDate = new Date(weekStartDate);
            weekEndDate.setDate(weekEndDate.getDate() + 7);
            
            const count = allUsers.filter(u => {
                const created = new Date(u.createdAt);
                return created >= weekStartDate && created < weekEndDate;
            }).length;
            
            weeklySignups.push({
                weekStart: weekStartDate.toISOString().split('T')[0],
                count
            });
        }

        res.json({
            success: true,
            timeRange: timeRange || 'all',
            timeRangeStart: timeRangeStart ? timeRangeStart.toISOString() : null,
            summary: {
                totalUsers: statsUsers.length,
                totalUsersAllTime: allUsers.length, // Always include all-time count
                authUsers: authUserCount,      // Users with login accounts
                anonymousUsers: appOnlyUserCount, // Anonymous/app-only users
                totalCoins,
                totalKids,
                totalSessions,
                totalTimeSpentMinutes,
                totalBooksRead,
                totalPagesRead,
                totalPlaylistsPlayed,
                totalListeningTimeMinutes,
                totalLessonsCompleted,
                totalGamesPlayed,
            },
            newAccounts: {
                today: newToday,
                thisWeek: newThisWeek,
                thisMonth: newThisMonth,
            },
            activeUsers: {
                today: activeToday,
                thisWeek: activeThisWeek,
                thisMonth: activeThisMonth,
            },
            subscriptionStats,
            platformStats,
            dailySignups,
            weeklySignups,
            users: formattedUsers,
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch analytics',
            error: error.message 
        });
    }
});

/**
 * POST /api/analytics/sync-stats
 * Sync activity stats from the frontend app
 */
router.post('/sync-stats', async (req, res) => {
    try {
        const { userId, stats } = req.body;

        if (!userId || !stats) {
            return res.status(400).json({ success: false, message: 'userId and stats are required' });
        }

        // Build query to find user by various identifiers
        const query = {};
        if (userId.includes('@')) {
            query.email = userId;
        } else if (userId.match(/^[0-9a-fA-F]{24}$/)) {
            query._id = userId;
        } else {
            query.deviceId = userId;
        }

        // Find or create AppUser
        let user = await AppUser.findOne(query);

        if (!user) {
            // Create new AppUser
            user = new AppUser({
                email: userId.includes('@') ? userId : undefined,
                deviceId: !userId.includes('@') ? userId : undefined,
                stats: stats,
                lastActiveAt: new Date(),
            });
        } else {
            // Update existing user's stats (merge, taking the higher value)
            user.stats = {
                totalSessions: Math.max(user.stats?.totalSessions || 0, stats.totalSessions || 0),
                totalTimeSpent: Math.max(user.stats?.totalTimeSpent || 0, stats.totalTimeSpent || 0),
                booksRead: Math.max(user.stats?.booksRead || 0, stats.booksRead || 0),
                pagesRead: Math.max(user.stats?.pagesRead || 0, stats.pagesRead || 0),
                playlistsPlayed: Math.max(user.stats?.playlistsPlayed || 0, stats.playlistsPlayed || 0),
                audioListeningTime: Math.max(user.stats?.audioListeningTime || 0, stats.audioListeningTime || 0),
                lessonsCompleted: Math.max(user.stats?.lessonsCompleted || 0, stats.lessonsCompleted || 0),
                gamesPlayed: Math.max(user.stats?.gamesPlayed || 0, stats.gamesPlayed || 0),
                coloringSessions: Math.max(user.stats?.coloringSessions || 0, stats.coloringSessions || 0),
                onboardingStep: Math.max(user.stats?.onboardingStep || 0, stats.onboardingStep || 0),
                farthestPageReached: stats.farthestPageReached || user.stats?.farthestPageReached || '/',
            };
            user.lastActiveAt = new Date();
        }

        await user.save();

        console.log(`📊 Stats synced for ${userId}:`, user.stats);

        res.json({ success: true, message: 'Stats synced', stats: user.stats });
    } catch (error) {
        console.error('Stats sync error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to sync stats',
            error: error.message 
        });
    }
});

/**
 * GET /api/analytics/users/:userId
 * Get detailed analytics for a specific user
 */
router.get('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await AppUser.findById(userId).lean();
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                deviceId: user.deviceId,
                coins: user.coins,
                kidProfiles: user.kidProfiles,
                stats: user.stats,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionPlan: user.subscriptionPlan,
                subscriptionStartDate: user.subscriptionStartDate,
                subscriptionEndDate: user.subscriptionEndDate,
                platform: user.platform,
                referralCode: user.referralCode,
                referralCount: user.referralCount,
                usedReferralCodes: user.usedReferralCodes,
                onboardingStatus: user.onboardingStatus,
                createdAt: user.createdAt,
                lastActiveAt: user.lastActiveAt,
            }
        });
    } catch (error) {
        console.error('User detail error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch user details',
            error: error.message 
        });
    }
});

/**
 * POST /api/analytics/onboarding/event
 * Track an onboarding event from the app
 */
router.post('/onboarding/event', async (req, res) => {
    try {
        const { userId, sessionId, event, metadata } = req.body;
        
        if (!userId || !event) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId and event are required' 
            });
        }
        
        const onboardingEvent = new OnboardingEvent({
            userId,
            sessionId: sessionId || `session_${Date.now()}`,
            event,
            metadata: metadata || {},
        });
        
        await onboardingEvent.save();
        
        console.log(`📊 Onboarding event: ${event} for user ${userId}`);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Onboarding event tracking error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to track event',
            error: error.message 
        });
    }
});

/**
 * GET /api/analytics/onboarding
 * Get onboarding funnel analytics for the portal
 * 
 * Query params:
 *   days: number of days to look back (default 30)
 */
router.get('/onboarding', async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        // Get all events in the time range
        const events = await OnboardingEvent.find({
            createdAt: { $gte: startDate }
        }).lean();
        
        // Calculate funnel metrics
        const uniqueUsers = new Set(events.map(e => e.userId));
        const uniqueSessions = new Set(events.map(e => e.sessionId));
        
        // Count events by type
        const eventCounts = {};
        const eventsByDay = {};
        
        events.forEach(e => {
            // Count by event type
            eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
            
            // Count by day
            const day = e.createdAt.toISOString().split('T')[0];
            if (!eventsByDay[day]) {
                eventsByDay[day] = {};
            }
            eventsByDay[day][e.event] = (eventsByDay[day][e.event] || 0) + 1;
        });
        
        // Calculate conversion rates
        const started = eventCounts['onboarding_started'] || 0;
        const step1 = eventCounts['step_1_complete'] || 0;
        const step2 = eventCounts['step_2_complete'] || 0;
        const step3 = eventCounts['step_3_complete'] || 0;
        const paywallViewed = eventCounts['step_4_viewed'] || 0;
        const subscribeClicked = eventCounts['subscribe_clicked'] || 0;
        const subscriptionStarted = eventCounts['subscription_started'] || 0;
        const trialStarted = eventCounts['trial_started'] || 0;
        const skipped = eventCounts['skip_clicked'] || 0;
        const completed = eventCounts['onboarding_complete'] || 0;
        
        // Build funnel data
        const funnel = [
            { step: 'Started', count: started, rate: 100 },
            { step: 'Step 1 (Welcome)', count: step1, rate: started > 0 ? Math.round((step1 / started) * 100) : 0 },
            { step: 'Step 2 (Kids)', count: step2, rate: started > 0 ? Math.round((step2 / started) * 100) : 0 },
            { step: 'Step 3 (Voice)', count: step3, rate: started > 0 ? Math.round((step3 / started) * 100) : 0 },
            { step: 'Paywall Viewed', count: paywallViewed, rate: started > 0 ? Math.round((paywallViewed / started) * 100) : 0 },
            { step: 'Subscribe Clicked', count: subscribeClicked, rate: started > 0 ? Math.round((subscribeClicked / started) * 100) : 0 },
            { step: 'Subscribed', count: subscriptionStarted + trialStarted, rate: started > 0 ? Math.round(((subscriptionStarted + trialStarted) / started) * 100) : 0 },
        ];
        
        // Daily trends (last 14 days)
        const dailyTrends = [];
        for (let i = 13; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dayStr = date.toISOString().split('T')[0];
            const dayData = eventsByDay[dayStr] || {};
            
            dailyTrends.push({
                date: dayStr,
                started: dayData['onboarding_started'] || 0,
                completed: dayData['onboarding_complete'] || 0,
                subscribed: (dayData['subscription_started'] || 0) + (dayData['trial_started'] || 0),
                skipped: dayData['skip_clicked'] || 0,
            });
        }
        
        // Plan preference
        const planEvents = events.filter(e => e.event === 'plan_selected');
        const planCounts = { annual: 0, monthly: 0 };
        planEvents.forEach(e => {
            if (e.metadata?.planType) {
                planCounts[e.metadata.planType] = (planCounts[e.metadata.planType] || 0) + 1;
            }
        });
        
        res.json({
            success: true,
            period: { days, startDate: startDate.toISOString() },
            summary: {
                totalUsers: uniqueUsers.size,
                totalSessions: uniqueSessions.size,
                totalEvents: events.length,
                conversionRate: started > 0 ? Math.round(((subscriptionStarted + trialStarted) / started) * 100) : 0,
                skipRate: started > 0 ? Math.round((skipped / started) * 100) : 0,
            },
            funnel,
            eventCounts,
            dailyTrends,
            planPreference: planCounts,
        });
    } catch (error) {
        console.error('Onboarding analytics error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch onboarding analytics',
            error: error.message 
        });
    }
});

/**
 * POST /api/analytics/admin/add-coins
 * Add coins to a user by email (admin only)
 */
router.post('/admin/add-coins', async (req, res) => {
    try {
        const { email, coins } = req.body;
        
        if (!email || !coins) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and coins are required' 
            });
        }

        // Find user in AppUser collection
        const appUser = await AppUser.findOne({ 
            email: { $regex: new RegExp(`^${email}$`, 'i') } 
        });

        if (!appUser) {
            return res.status(404).json({ 
                success: false, 
                message: `User with email ${email} not found` 
            });
        }

        const previousCoins = appUser.coins || 0;
        appUser.coins = previousCoins + coins;
        await appUser.save();

        console.log(`💰 Added ${coins} coins to ${email}. Previous: ${previousCoins}, New: ${appUser.coins}`);

        res.json({
            success: true,
            message: `Added ${coins} coins to ${email}`,
            previousCoins,
            newTotal: appUser.coins,
        });
    } catch (error) {
        console.error('Add coins error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to add coins',
            error: error.message 
        });
    }
});

module.exports = router;
