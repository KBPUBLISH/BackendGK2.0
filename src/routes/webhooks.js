const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const AppUser = require('../models/AppUser');

// Store pending purchases (external_id -> status)
// In production, this should be in Redis or database
const pendingPurchases = new Map();

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
const buildUserQuery = (externalId) => {
    const conditions = [
        { email: externalId },
        { deviceId: externalId }
    ];
    if (isValidObjectId(externalId)) {
        conditions.unshift({ _id: externalId });
    }
    return { $or: conditions };
};

// Helper to find user in both User and AppUser collections
const findUserInAllCollections = async (externalId) => {
    const query = buildUserQuery(externalId);
    
    // Check User collection first
    let user = await User.findOne(query);
    if (user) {
        return { user, collection: 'User' };
    }
    
    // Check AppUser collection
    let appUser = await AppUser.findOne(query);
    if (appUser) {
        return { user: appUser, collection: 'AppUser' };
    }
    
    return { user: null, collection: null };
};

/**
 * RevenueCat Webhook Handler
 * Configure this URL in RevenueCat Dashboard: https://your-backend.com/api/webhooks/revenuecat
 * 
 * RevenueCat sends events like:
 * - INITIAL_PURCHASE
 * - RENEWAL
 * - CANCELLATION
 * - EXPIRATION
 * - etc.
 */
router.post('/revenuecat', async (req, res) => {
    try {
        const event = req.body;
        
        console.log('📦 RevenueCat Webhook received:', JSON.stringify(event, null, 2));
        
        // RevenueCat webhook structure
        const eventType = event.event?.type || event.type;
        const appUserId = event.event?.app_user_id || event.app_user_id;
        const externalId = event.event?.aliases?.[0] || appUserId;
        const productId = event.event?.product_id || event.product_id;
        const expirationDate = event.event?.expiration_at_ms || event.expiration_at_ms;
        
        console.log(`🎯 Event: ${eventType}, User: ${externalId}, Product: ${productId}`);
        
        // Handle different event types
        switch (eventType) {
            case 'INITIAL_PURCHASE':
            case 'RENEWAL':
            case 'PRODUCT_CHANGE':
            case 'RESTORE':
                // User has active subscription
                console.log(`✅ User ${externalId} has active subscription`);
                
                // Mark purchase as complete for polling
                pendingPurchases.set(externalId, {
                    status: 'active',
                    productId,
                    expirationDate,
                    updatedAt: Date.now()
                });
                
                // Try to update user in BOTH database collections
                let userUpdated = false;
                
                // Update User collection
                try {
                    const user = await User.findOne(buildUserQuery(externalId));
                    if (user) {
                        user.isPremium = true;
                        user.subscriptionProductId = productId;
                        user.subscriptionExpiresAt = expirationDate ? new Date(expirationDate) : null;
                        await user.save();
                        console.log(`✅ Updated User ${user._id} (${user.email}) to premium`);
                        userUpdated = true;
                    }
                } catch (dbError) {
                    console.error('User DB update error:', dbError);
                }
                
                // Update AppUser collection
                try {
                    const appUser = await AppUser.findOne(buildUserQuery(externalId));
                    if (appUser) {
                        appUser.subscriptionStatus = 'active';
                        appUser.subscriptionPlan = productId?.includes('yearly') || productId?.includes('annual') ? 'annual' : 'monthly';
                        appUser.subscriptionStartDate = new Date();
                        appUser.subscriptionEndDate = expirationDate ? new Date(expirationDate) : null;
                        await appUser.save();
                        console.log(`✅ Updated AppUser ${appUser._id} (${appUser.email || appUser.deviceId}) to active subscription`);
                        userUpdated = true;
                    }
                } catch (dbError) {
                    console.error('AppUser DB update error:', dbError);
                }
                
                if (!userUpdated) {
                    console.log(`⚠️ No user found in either collection for: ${externalId}, but marked in pending`);
                }
                break;
                
            case 'CANCELLATION':
            case 'EXPIRATION':
                // User no longer has active subscription
                console.log(`❌ User ${externalId} subscription ended`);
                
                pendingPurchases.set(externalId, {
                    status: 'expired',
                    updatedAt: Date.now()
                });
                
                // Update User collection
                try {
                    const user = await User.findOne(buildUserQuery(externalId));
                    if (user) {
                        user.isPremium = false;
                        await user.save();
                        console.log(`✅ Updated User ${user._id} (${user.email}) to non-premium`);
                    }
                } catch (dbError) {
                    console.error('User DB update error:', dbError);
                }
                
                // Update AppUser collection
                try {
                    const appUser = await AppUser.findOne(buildUserQuery(externalId));
                    if (appUser) {
                        appUser.subscriptionStatus = 'expired';
                        await appUser.save();
                        console.log(`✅ Updated AppUser ${appUser._id} (${appUser.email || appUser.deviceId}) to expired`);
                    }
                } catch (dbError) {
                    console.error('AppUser DB update error:', dbError);
                }
                break;
                
            default:
                console.log(`ℹ️ Unhandled event type: ${eventType}`);
        }
        
        // Always return 200 to acknowledge receipt
        res.status(200).json({ received: true });
        
    } catch (error) {
        console.error('Webhook processing error:', error);
        // Still return 200 to prevent RevenueCat from retrying
        res.status(200).json({ received: true, error: error.message });
    }
});

/**
 * Check purchase status (for frontend polling)
 * Frontend calls this after triggering purchase to check if webhook was received
 */
router.get('/purchase-status/:externalId', async (req, res) => {
    try {
        const { externalId } = req.params;
        
        console.log(`🔍 Checking purchase status for: ${externalId}`);
        
        // Check pending purchases map first (fastest)
        const pending = pendingPurchases.get(externalId);
        if (pending && pending.status === 'active') {
            console.log(`✅ Found active purchase in pending map for: ${externalId}`);
            return res.json({
                isPremium: true,
                status: 'active',
                source: 'webhook'
            });
        }
        
        // Check User collection (authentication users)
        try {
            const user = await User.findOne(buildUserQuery(externalId));
            
            if (user) {
                console.log(`📋 Found user in User collection: ${user.email}`);
                if (user.isPremium) {
                    console.log(`✅ User ${user.email} is premium in User collection`);
                    return res.json({
                        isPremium: true,
                        status: 'active',
                        source: 'database-user'
                    });
                }
            }
        } catch (dbError) {
            console.error('User DB lookup error:', dbError);
        }
        
        // Check AppUser collection (app tracking users)
        try {
            const appUser = await AppUser.findOne(buildUserQuery(externalId));
            
            if (appUser) {
                console.log(`📋 Found user in AppUser collection: ${appUser.email || appUser.deviceId}`);
                if (appUser.subscriptionStatus === 'active') {
                    console.log(`✅ AppUser ${appUser.email || appUser.deviceId} has active subscription`);
                    return res.json({
                        isPremium: true,
                        status: 'active',
                        source: 'database-appuser'
                    });
                }
            }
        } catch (dbError) {
            console.error('AppUser DB lookup error:', dbError);
        }
        
        // Not found or not premium
        console.log(`❌ No premium subscription found for: ${externalId}`);
        res.json({
            isPremium: false,
            status: pending?.status || 'not_found'
        });
        
    } catch (error) {
        console.error('Purchase status check error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Manual trigger for testing - marks a user as premium
 * DELETE THIS IN PRODUCTION or add authentication
 */
router.post('/test-purchase/:externalId', async (req, res) => {
    const { externalId } = req.params;
    
    console.log(`🧪 TEST: Marking ${externalId} as premium`);
    
    pendingPurchases.set(externalId, {
        status: 'active',
        productId: 'test',
        updatedAt: Date.now()
    });
    
    res.json({ success: true, message: `Marked ${externalId} as premium` });
});

// Clean up old pending purchases (older than 1 hour)
setInterval(() => {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [key, value] of pendingPurchases.entries()) {
        if (value.updatedAt < oneHourAgo) {
            pendingPurchases.delete(key);
        }
    }
}, 60 * 60 * 1000); // Run every hour

module.exports = router;


