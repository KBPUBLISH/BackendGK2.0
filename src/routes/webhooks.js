const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Store pending purchases (external_id -> status)
// In production, this should be in Redis or database
const pendingPurchases = new Map();

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
                
                // Try to update user in database
                try {
                    const user = await User.findOne({ 
                        $or: [
                            { _id: externalId },
                            { email: externalId },
                            { deviceId: externalId }
                        ]
                    });
                    
                    if (user) {
                        user.isPremium = true;
                        user.subscriptionProductId = productId;
                        user.subscriptionExpiresAt = expirationDate ? new Date(expirationDate) : null;
                        await user.save();
                        console.log(`✅ Updated user ${user._id} to premium`);
                    } else {
                        console.log(`⚠️ User not found in DB, but marked in pending: ${externalId}`);
                    }
                } catch (dbError) {
                    console.error('DB update error:', dbError);
                    // Still mark as complete even if DB update fails
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
                
                try {
                    const user = await User.findOne({ 
                        $or: [
                            { _id: externalId },
                            { email: externalId },
                            { deviceId: externalId }
                        ]
                    });
                    
                    if (user) {
                        user.isPremium = false;
                        await user.save();
                        console.log(`✅ Updated user ${user._id} to non-premium`);
                    }
                } catch (dbError) {
                    console.error('DB update error:', dbError);
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
            console.log(`✅ Found active purchase in pending map`);
            return res.json({
                isPremium: true,
                status: 'active',
                source: 'webhook'
            });
        }
        
        // Also check database
        try {
            const mongoose = require('mongoose');
            
            // Build query - only use _id if it's a valid ObjectId
            const isValidObjectId = mongoose.Types.ObjectId.isValid(externalId) && 
                (new mongoose.Types.ObjectId(externalId)).toString() === externalId;
            
            const queryConditions = [
                { email: externalId },
                { deviceId: externalId }
            ];
            
            // Only add _id condition if it's a valid ObjectId
            if (isValidObjectId) {
                queryConditions.unshift({ _id: externalId });
            }
            
            const user = await User.findOne({ $or: queryConditions });
            
            if (user && user.isPremium) {
                console.log(`✅ Found premium user in database`);
                return res.json({
                    isPremium: true,
                    status: 'active',
                    source: 'database'
                });
            }
        } catch (dbError) {
            console.error('DB lookup error:', dbError);
        }
        
        // Not found or not premium
        res.json({
            isPremium: false,
            status: pending?.status || 'pending'
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


