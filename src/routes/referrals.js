const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const AppUser = require('../models/AppUser');
const User = require('../models/User'); // Fallback for legacy users
const { notifyReferralRedeemed } = require('../services/notificationService');

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

// Helper to build safe query for finding users by various IDs
// This handles ObjectIds, emails, deviceIds, and custom user IDs
const buildUserQuery = (userId) => {
    const conditions = [
        { email: userId },
        { deviceId: userId }
    ];
    // Only add _id query if it's a valid ObjectId
    if (isValidObjectId(userId)) {
        conditions.unshift({ _id: userId });
    }
    return { $or: conditions };
};

/**
 * POST /api/referrals/sync
 * Sync user profile data including referral code, kids, coins, etc.
 * Called after signup/purchase and when profile changes
 */
router.post('/sync', async (req, res) => {
    try {
        const { userId, referralCode, referredBy, kidProfiles, parentName, coins, platform } = req.body;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        // Clean email to lowercase
        const cleanEmail = userId.includes('@') ? userId.toLowerCase().trim() : null;
        const cleanDeviceId = !userId.includes('@') ? userId : null;

        // Find user using safe query that handles various ID formats
        let user = await AppUser.findOne(buildUserQuery(userId));

        if (!user) {
            // User doesn't exist in AppUser - create them
            console.log(`📝 Creating new AppUser for sync: ${userId}`);
            
            const newUser = {
                referralCode: referralCode || undefined,
                referredBy: referredBy || undefined,
                referralCount: 0,
                coins: coins || 500,
                platform: platform || 'unknown',
            };
            
            if (cleanEmail) newUser.email = cleanEmail;
            if (cleanDeviceId) newUser.deviceId = cleanDeviceId;
            
            // Add kid profiles if provided
            if (kidProfiles && Array.isArray(kidProfiles)) {
                newUser.kidProfiles = kidProfiles.map(kid => ({
                    name: kid.name,
                    age: kid.age,
                    avatarSeed: kid.avatarSeed || kid.avatar,
                    createdAt: kid.createdAt || new Date()
                }));
            }
            
            user = await AppUser.create(newUser);
            console.log(`✅ Created AppUser: ${user._id} with ${kidProfiles?.length || 0} kids`);
            
            return res.json({ 
                success: true, 
                synced: true,
                referralCode: referralCode,
                userId: user._id.toString(),
                message: 'User created and profile synced'
            });
        }
        
        console.log(`📍 Found existing AppUser: ${user.email || user.deviceId || userId}`);

        // Update referral code if not set
        if (referralCode && !user.referralCode) {
            user.referralCode = referralCode;
        }
        
        if (referredBy && !user.referredBy) {
            user.referredBy = referredBy;
        }

        // Update kid profiles (always overwrite with latest from client)
        if (kidProfiles && Array.isArray(kidProfiles)) {
            user.kidProfiles = kidProfiles.map(kid => ({
                name: kid.name,
                age: kid.age,
                avatarSeed: kid.avatarSeed || kid.avatar,
                createdAt: kid.createdAt || new Date()
            }));
            console.log(`👶 Synced ${kidProfiles.length} kid profile(s) for ${user.email || userId}`);
        }

        // Update platform if provided
        if (platform && platform !== 'unknown') {
            user.platform = platform;
        }

        // Update last active
        user.lastActiveAt = new Date();

        await user.save();
        console.log(`✅ Profile synced for user ${user.email || userId}`);

        return res.json({ 
            success: true, 
            synced: true,
            referralCode: user.referralCode || referralCode,
            userId: user._id.toString(),
            kidCount: user.kidProfiles?.length || 0
        });

    } catch (error) {
        console.error('Profile sync error:', error);
        return res.status(200).json({ 
            success: false, 
            synced: false,
            message: 'Profile sync failed',
            error: error.message 
        });
    }
});

/**
 * POST /api/referrals/redeem
 * Redeem a referral code (award coins to both users)
 */
router.post('/redeem', async (req, res) => {
    try {
        const { userId, codeToRedeem } = req.body;

        if (!userId || !codeToRedeem) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId and codeToRedeem are required' 
            });
        }

        const normalizedCode = codeToRedeem.trim().toUpperCase();

        // Find the user redeeming the code, or create a minimal record
        let user = await AppUser.findOne(buildUserQuery(userId));
        
        if (!user) {
            // Create a minimal user record for this device/email
            console.log(`📝 Creating new AppUser for referral: ${userId}`);
            user = new AppUser({
                email: userId.includes('@') ? userId : undefined,
                deviceId: !userId.includes('@') ? userId : undefined,
                coins: 0,
                referralCode: null, // Will be generated if they share
                referredBy: null,
                referralCount: 0
            });
            await user.save();
        }

        // Check if user is trying to use their own code
        if (user.referralCode === normalizedCode) {
            return res.json({ 
                success: false, 
                message: "You can't use your own referral code!" 
            });
        }

        // Check if user has already used THIS specific code
        // (users CAN use multiple different codes - encourages sharing!)
        const usedCodes = user.usedReferralCodes || [];
        if (usedCodes.includes(normalizedCode)) {
            return res.json({ 
                success: false, 
                message: "You've already used this referral code!" 
            });
        }

        // Find the user who owns this referral code
        const referrer = await AppUser.findOne({ referralCode: normalizedCode });
        
        if (!referrer) {
            return res.json({ 
                success: false, 
                message: 'Invalid referral code' 
            });
        }

        // Check if referrer is in the same parent account (sibling/family member)
        // This prevents kids in the same family from referring each other
        const userParentId = user.parentId || user.parentEmail || user.email;
        const referrerParentId = referrer.parentId || referrer.parentEmail || referrer.email;
        
        if (userParentId && referrerParentId && userParentId === referrerParentId) {
            return res.json({ 
                success: false, 
                message: "You can't use a referral code from your family account!" 
            });
        }

        // Additional check: if they share the same deviceId, they're likely the same household
        if (user.deviceId && referrer.deviceId && user.deviceId === referrer.deviceId) {
            return res.json({ 
                success: false, 
                message: "You can't use a referral code from the same device!" 
            });
        }

        // Award coins to both users (250 each to encourage more sharing)
        const REFERRAL_BONUS = 250;

        // Update the user who redeemed - track this code as used
        await AppUser.findByIdAndUpdate(user._id, {
            $push: { usedReferralCodes: normalizedCode },
            $inc: { coins: REFERRAL_BONUS }
        });

        // Update the referrer
        await AppUser.findByIdAndUpdate(referrer._id, {
            $inc: { 
                referralCount: 1,
                coins: REFERRAL_BONUS 
            }
        });

        console.log(`🎉 Referral redeemed: ${user.email || userId} used code ${normalizedCode} from ${referrer.email}`);

        // Send push notification to the referrer
        const redeemerName = user.parentName || user.email?.split('@')[0] || 'A friend';
        try {
            await notifyReferralRedeemed(
                referrer._id.toString(),
                referrer.oneSignalPlayerId, // Pass player ID for targeted notification
                redeemerName, 
                REFERRAL_BONUS
            );
            console.log(`📱 Notification sent to referrer ${referrer.email} about ${REFERRAL_BONUS} coins earned`);
        } catch (notifError) {
            console.warn('⚠️ Failed to send referral notification:', notifError.message);
            // Don't fail the request if notification fails
        }

        return res.json({ 
            success: true, 
            message: `🎉 You earned ${REFERRAL_BONUS} coins!`,
            coinsAwarded: REFERRAL_BONUS
        });

    } catch (error) {
        console.error('Referral redeem error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to redeem referral code',
            error: error.message 
        });
    }
});

/**
 * GET /api/referrals/code/:userId
 * Get a user's referral code
 */
router.get('/code/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await AppUser.findOne(buildUserQuery(userId));
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        return res.json({ 
            success: true, 
            referralCode: user.referralCode,
            referralCount: user.referralCount || 0
        });

    } catch (error) {
        console.error('Get referral code error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to get referral code',
            error: error.message 
        });
    }
});

/**
 * GET /api/referrals/stats/:userId
 * Get referral statistics for a user (including coins for syncing)
 */
router.get('/stats/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await AppUser.findOne(buildUserQuery(userId));
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        return res.json({ 
            success: true, 
            stats: {
                referralCode: user.referralCode,
                referralCount: user.referralCount || 0,
                referredBy: user.referredBy || null,
                totalCoinsFromReferrals: (user.referralCount || 0) * 250,
                coins: user.coins || 0, // Include current coin balance for syncing
                usedReferralCodes: user.usedReferralCodes || []
            }
        });

    } catch (error) {
        console.error('Get referral stats error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to get referral stats',
            error: error.message 
        });
    }
});

/**
 * POST /api/referrals/register-push
 * Register OneSignal player ID for push notifications
 */
router.post('/register-push', async (req, res) => {
    try {
        const { userId, oneSignalPlayerId } = req.body;

        if (!userId || !oneSignalPlayerId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId and oneSignalPlayerId are required' 
            });
        }

        // Find or create user
        let user = await AppUser.findOne(buildUserQuery(userId));
        
        if (!user) {
            // Create user with player ID
            const cleanEmail = userId.includes('@') ? userId.toLowerCase().trim() : null;
            const cleanDeviceId = !userId.includes('@') ? userId : null;
            
            const newUser = {
                oneSignalPlayerId,
                referralCount: 0
            };
            if (cleanEmail) newUser.email = cleanEmail;
            if (cleanDeviceId) newUser.deviceId = cleanDeviceId;
            
            user = await AppUser.create(newUser);
            console.log(`✅ Created AppUser with OneSignal player ID: ${oneSignalPlayerId.substring(0, 10)}...`);
        } else {
            // Update existing user with player ID
            user.oneSignalPlayerId = oneSignalPlayerId;
            await user.save();
            console.log(`✅ Updated OneSignal player ID for user: ${user.email || userId}`);
        }

        return res.json({ 
            success: true, 
            message: 'Push notification registered'
        });

    } catch (error) {
        console.error('Register push error:', error);
        return res.status(200).json({ 
            success: false, 
            message: 'Failed to register push',
            error: error.message 
        });
    }
});

/**
 * GET /api/referrals/admin/list
 * List all users with referral codes (admin only - for debugging)
 */
router.get('/admin/list', async (req, res) => {
    try {
        // Get ALL AppUsers
        const appUsers = await AppUser.find(
            {},
            { email: 1, deviceId: 1, referralCode: 1, referralCount: 1, coins: 1, referredBy: 1 }
        ).limit(50);
        
        // Also get auth Users for comparison
        const authUsers = await User.find(
            {},
            { email: 1, isPremium: 1, createdAt: 1 }
        ).limit(50);
        
        return res.json({ 
            success: true, 
            appUsers: {
                count: appUsers.length,
                users: appUsers.map(u => ({
                    email: u.email || 'N/A',
                    deviceId: u.deviceId ? u.deviceId.substring(0, 20) + '...' : 'N/A',
                    referralCode: u.referralCode,
                    referralCount: u.referralCount || 0,
                    coins: u.coins || 0,
                    referredBy: u.referredBy || null
                }))
            },
            authUsers: {
                count: authUsers.length,
                users: authUsers.map(u => ({
                    email: u.email || 'N/A',
                    isPremium: u.isPremium || false,
                    createdAt: u.createdAt
                }))
            }
        });
    } catch (error) {
        console.error('List referrals error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to list referrals',
            error: error.message 
        });
    }
});

module.exports = router;

