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
 * Sync referral code for a user
 * Called after signup/purchase to ensure referral code is stored in backend
 */
router.post('/sync', async (req, res) => {
    try {
        const { userId, referralCode, referredBy } = req.body;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        // Find user using safe query that handles various ID formats
        // First try AppUser (main app users with referral fields)
        let user = await AppUser.findOne(buildUserQuery(userId));
        let userModel = 'AppUser';

        // Fallback to User model (legacy/CMS users)
        if (!user) {
            try {
                // User model only has email field, not deviceId
                const userQuery = isValidObjectId(userId) 
                    ? { $or: [{ _id: userId }, { email: userId }] }
                    : { email: userId };
                user = await User.findOne(userQuery);
                if (user) userModel = 'User';
            } catch (e) {
                // Ignore - User model search failed
            }
        }

        if (!user) {
            // User doesn't exist - create them with their referral code
            console.log(`📝 Creating new AppUser for referral sync: ${userId}`);
            user = new AppUser({
                email: userId.includes('@') ? userId.toLowerCase() : undefined,
                deviceId: !userId.includes('@') ? userId : undefined,
                coins: 0,
                referralCode: referralCode || null,
                referredBy: referredBy || null,
                referralCount: 0
            });
            await user.save();
            console.log(`✅ Created AppUser with referral code: ${referralCode}`);
            return res.json({ 
                success: true, 
                synced: true,
                referralCode: referralCode,
                message: 'User created and referral code synced'
            });
        }
        
        console.log(`📍 Found user in ${userModel} model: ${user.email || userId}`);

        // Update referral data (only AppUser model has referral fields)
        if (userModel === 'AppUser') {
            const updateData = {};
            
            if (referralCode && !user.referralCode) {
                updateData.referralCode = referralCode;
            }
            
            if (referredBy && !user.referredBy) {
                updateData.referredBy = referredBy;
            }

            if (Object.keys(updateData).length > 0) {
                await AppUser.findByIdAndUpdate(user._id, updateData);
                console.log(`✅ Synced referral code ${referralCode || 'N/A'} for user ${user.email || userId}`);
            } else {
                console.log(`ℹ️ Referral already synced for user ${user.email || userId}`);
            }
        } else {
            // User model doesn't have referral fields - just acknowledge
            console.log(`ℹ️ User found in legacy User model (no referral fields): ${user.email || userId}`);
        }

        return res.json({ 
            success: true, 
            synced: true,
            referralCode: user.referralCode || referralCode
        });

    } catch (error) {
        console.error('Referral sync error:', error);
        // Return success with error flag - don't crash the app for referral sync failures
        return res.status(200).json({ 
            success: false, 
            synced: false,
            message: 'Referral sync failed',
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

        // Check if user already has a referredBy (can only use one code ever)
        if (user.referredBy) {
            return res.json({ 
                success: false, 
                message: "You've already used a referral code!" 
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

        // Award coins to both users
        const REFERRAL_BONUS = 500;

        // Update the user who redeemed
        await AppUser.findByIdAndUpdate(user._id, {
            referredBy: normalizedCode,
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
            await notifyReferralRedeemed(referrer._id.toString(), redeemerName, REFERRAL_BONUS);
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
 * Get referral statistics for a user
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
                totalCoinsFromReferrals: (user.referralCount || 0) * 500
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

