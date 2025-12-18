const express = require('express');
const router = express.Router();
const AppUser = require('../models/AppUser');
const User = require('../models/User');

/**
 * GET /api/analytics/users
 * Get comprehensive user analytics for the dashboard
 * Merges data from both User (auth) and AppUser (app data) collections
 */
router.get('/users', async (req, res) => {
    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const monthStart = new Date(todayStart);
        monthStart.setMonth(monthStart.getMonth() - 1);

        // Get users from AppUser collection (app-specific data)
        const appUsers = await AppUser.find({})
            .select('email deviceId coins kidProfiles stats createdAt lastActiveAt subscriptionStatus platform referralCode referralCount')
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
                createdAt: appUser.createdAt,
                lastActiveAt: appUser.lastActiveAt,
                source: 'app', // Anonymous or app-only user
            });
        });

        // Sort by createdAt descending
        mergedUsers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const allUsers = mergedUsers;

        // Count new accounts by time period
        const newToday = allUsers.filter(u => new Date(u.createdAt) >= todayStart).length;
        const newThisWeek = allUsers.filter(u => new Date(u.createdAt) >= weekStart).length;
        const newThisMonth = allUsers.filter(u => new Date(u.createdAt) >= monthStart).length;

        // Active users (by lastActiveAt)
        const activeToday = allUsers.filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= todayStart).length;
        const activeThisWeek = allUsers.filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= weekStart).length;
        const activeThisMonth = allUsers.filter(u => u.lastActiveAt && new Date(u.lastActiveAt) >= monthStart).length;

        // Subscription breakdown
        const subscriptionStats = {
            free: allUsers.filter(u => u.subscriptionStatus === 'free').length,
            trial: allUsers.filter(u => u.subscriptionStatus === 'trial').length,
            active: allUsers.filter(u => u.subscriptionStatus === 'active').length,
            cancelled: allUsers.filter(u => u.subscriptionStatus === 'cancelled').length,
            expired: allUsers.filter(u => u.subscriptionStatus === 'expired').length,
        };

        // Platform breakdown
        const platformStats = {
            ios: allUsers.filter(u => u.platform === 'ios').length,
            android: allUsers.filter(u => u.platform === 'android').length,
            web: allUsers.filter(u => u.platform === 'web').length,
            unknown: allUsers.filter(u => !u.platform || u.platform === 'unknown').length,
        };

        // Calculate totals
        const totalCoins = allUsers.reduce((sum, u) => sum + (u.coins || 0), 0);
        const totalKids = allUsers.reduce((sum, u) => sum + (u.kidProfiles?.length || 0), 0);
        const totalSessions = allUsers.reduce((sum, u) => sum + (u.stats?.totalSessions || 0), 0);
        const totalBooksRead = allUsers.reduce((sum, u) => sum + (u.stats?.booksRead || 0), 0);
        const totalGamesPlayed = allUsers.reduce((sum, u) => sum + (u.stats?.gamesPlayed || 0), 0);

        // Format users for display
        const formattedUsers = allUsers.map(user => ({
            id: user._id,
            email: user.email || 'Anonymous',
            username: user.username,
            deviceId: user.deviceId,
            coins: user.coins || 0,
            kidCount: user.kidProfiles?.length || 0,
            kids: user.kidProfiles?.map(k => ({ name: k.name, age: k.age })) || [],
            sessions: user.stats?.totalSessions || 0,
            booksRead: user.stats?.booksRead || 0,
            gamesPlayed: user.stats?.gamesPlayed || 0,
            subscriptionStatus: user.subscriptionStatus || 'free',
            platform: user.platform || 'unknown',
            referralCode: user.referralCode,
            referralCount: user.referralCount || 0,
            createdAt: user.createdAt,
            lastActiveAt: user.lastActiveAt,
            source: user.source, // 'auth' = has login account, 'app' = anonymous/app-only
        }));

        // Count by source
        const authUserCount = allUsers.filter(u => u.source === 'auth').length;
        const appOnlyUserCount = allUsers.filter(u => u.source === 'app').length;

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
            summary: {
                totalUsers: allUsers.length,
                authUsers: authUserCount,      // Users with login accounts
                anonymousUsers: appOnlyUserCount, // Anonymous/app-only users
                totalCoins,
                totalKids,
                totalSessions,
                totalBooksRead,
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
                playlistsPlayed: Math.max(user.stats?.playlistsPlayed || 0, stats.playlistsPlayed || 0),
                lessonsCompleted: Math.max(user.stats?.lessonsCompleted || 0, stats.lessonsCompleted || 0),
                gamesPlayed: Math.max(user.stats?.gamesPlayed || 0, stats.gamesPlayed || 0),
                coloringSessions: Math.max(user.stats?.coloringSessions || 0, stats.coloringSessions || 0),
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

module.exports = router;
