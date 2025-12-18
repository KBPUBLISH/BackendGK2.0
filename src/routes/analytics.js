const express = require('express');
const router = express.Router();
const AppUser = require('../models/AppUser');

/**
 * GET /api/analytics/users
 * Get comprehensive user analytics for the dashboard
 */
router.get('/users', async (req, res) => {
    try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(todayStart);
        weekStart.setDate(weekStart.getDate() - 7);
        const monthStart = new Date(todayStart);
        monthStart.setMonth(monthStart.getMonth() - 1);

        // Get all users with their details
        const allUsers = await AppUser.find({})
            .select('email deviceId coins kidProfiles stats createdAt lastActiveAt subscriptionStatus platform referralCode referralCount')
            .sort({ createdAt: -1 })
            .lean();

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
        }));

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
