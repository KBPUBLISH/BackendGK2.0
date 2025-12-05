const express = require('express');
const router = express.Router();
const axios = require('axios');
const User = require('../models/User');

// Configuration for old backend
// IMPORTANT: API key must be set via environment variable - never hardcode secrets
// Note: The old backend URL should NOT have /api suffix - that's added in the endpoint paths
const OLD_BACKEND_URL = process.env.OLD_BACKEND_URL || 'https://api.devgodlykids.kbpublish.org';
const MIGRATION_API_KEY = process.env.MIGRATION_API_KEY; // Required env variable - this is the OLD backend's API key, not RevenueCat

/**
 * POST /api/migration/restore-subscription
 * Called when user presses "Restore Purchase" in the new app
 * Checks the old backend for subscription status and updates the user in the new backend
 */
router.post('/restore-subscription', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required' 
            });
        }

        if (!MIGRATION_API_KEY) {
            console.error('MIGRATION_API_KEY not configured');
            return res.status(500).json({ 
                success: false, 
                message: 'Migration service not configured' 
            });
        }

        console.log(`🔄 Migration: Checking subscription for ${email}`);

        // Call old backend to restore/check subscription status
        // Endpoint: POST /payments/restore/subscription
        // Old backend uses Bearer token authentication
        let oldBackendResponse;
        try {
            console.log(`📡 Calling old backend: ${OLD_BACKEND_URL}/payments/restore/subscription`);
            console.log(`📧 Email: ${email.toLowerCase().trim()}`);
            
            oldBackendResponse = await axios.post(
                `${OLD_BACKEND_URL}/payments/restore/subscription`,
                { email: email.toLowerCase().trim() },
                { 
                    headers: { 
                        'Authorization': `Bearer ${MIGRATION_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000 // 15 second timeout
                }
            );
            
            console.log(`✅ Old backend response status: ${oldBackendResponse.status}`);
        } catch (axiosError) {
            console.error('Error calling old backend:', axiosError.message);
            if (axiosError.response) {
                console.error('Response status:', axiosError.response.status);
                console.error('Response data:', axiosError.response.data);
                
                // 401 means unauthorized - invalid API key
                if (axiosError.response.status === 401) {
                    return res.status(401).json({ 
                        success: false, 
                        message: 'Migration API key is invalid or expired'
                    });
                }
            }
            return res.status(502).json({ 
                success: false, 
                message: 'Unable to connect to old backend',
                error: axiosError.message
            });
        }

        const subscriptionData = oldBackendResponse.data;
        console.log('📦 Old backend response:', subscriptionData);

        // Check if we got valid subscription data
        // Response format: { subscriptionExpiryDate, subscriptionStartDate, membership, email, isTrialUsed, _id }
        if (!subscriptionData || !subscriptionData.email) {
            return res.json({ 
                success: true, 
                found: false,
                message: 'No account found with this email in the old app'
            });
        }

        // Check if user has an active subscription
        const isPaid = subscriptionData.membership === 'paid';
        const expiryDate = subscriptionData.subscriptionExpiryDate;
        const isActive = isPaid && (
            !expiryDate || 
            new Date(expiryDate).getTime() > Date.now()
        );

        // Find or inform about the user in the new backend
        const userInNewBackend = await User.findOne({ email: email.toLowerCase().trim() });

        // Convert dates to proper format
        const expiryDateParsed = subscriptionData.subscriptionExpiryDate 
            ? new Date(subscriptionData.subscriptionExpiryDate) 
            : null;
        const startDateParsed = subscriptionData.subscriptionStartDate 
            ? new Date(subscriptionData.subscriptionStartDate) 
            : null;

        if (!userInNewBackend) {
            return res.json({
                success: true,
                found: true,
                subscriptionFound: isPaid,
                isActive,
                message: 'Subscription found but please create an account in the new app first with the same email',
                subscriptionData: {
                    membership: subscriptionData.membership,
                    subscriptionExpiryDate: expiryDateParsed,
                    subscriptionStartDate: startDateParsed,
                    isTrialUsed: subscriptionData.isTrialUsed || false,
                }
            });
        }

        // Update user in new backend if they have an active subscription
        if (isActive) {
            const updateData = {
                isPremium: true,
                subscriptionStatus: 'active',
                subscriptionExpiryDate: expiryDateParsed,
                subscriptionStartDate: startDateParsed,
                migratedFromOldApp: true,
                oldAppUserId: subscriptionData._id,
                isTrialUsed: subscriptionData.isTrialUsed || false,
            };

            await User.findByIdAndUpdate(userInNewBackend._id, updateData);
            
            console.log(`✅ Migration: Updated user ${userInNewBackend._id} with subscription from old app`);

            return res.json({
                success: true,
                found: true,
                subscriptionRestored: true,
                isPremium: true,
                message: 'Your subscription has been restored successfully!',
                subscriptionData: {
                    membership: subscriptionData.membership,
                    subscriptionExpiryDate: expiryDateParsed,
                    subscriptionStartDate: startDateParsed,
                }
            });
        } else {
            // User had a subscription but it's expired or free
            const updateData = {
                migratedFromOldApp: true,
                oldAppUserId: subscriptionData._id,
                isTrialUsed: subscriptionData.isTrialUsed || false,
            };

            await User.findByIdAndUpdate(userInNewBackend._id, updateData);

            return res.json({
                success: true,
                found: true,
                subscriptionRestored: false,
                isPremium: false,
                message: isPaid 
                    ? 'Your subscription was found but has expired. Please renew to continue.' 
                    : 'Account found but no active subscription.',
                subscriptionData: {
                    membership: subscriptionData.membership,
                    subscriptionExpiryDate: expiryDateParsed,
                    subscriptionStartDate: startDateParsed,
                }
            });
        }

    } catch (error) {
        console.error('Migration restore-subscription error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to restore subscription',
            error: error.message 
        });
    }
});

/**
 * POST /api/migration/check-renewal
 * Called by cron job to check if expired migrated subscriptions have been renewed
 */
router.post('/check-renewal', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required' 
            });
        }

        const user = await User.findById(userId);
        
        if (!user || !user.migratedFromOldApp || !user.email) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found or not migrated from old app' 
            });
        }

        // Call old backend to check current subscription status
        const oldBackendResponse = await axios.post(
            `${OLD_BACKEND_URL}/payments/restore/subscription`,
            { email: user.email },
            { 
                headers: { 
                    'X-Migration-API-Key': MIGRATION_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        const subscriptionData = oldBackendResponse.data;

        if (!subscriptionData || !subscriptionData.email) {
            return res.json({ 
                success: true, 
                renewed: false,
                message: 'User no longer exists in old backend'
            });
        }

        const isPaid = subscriptionData.membership === 'paid';
        const expiryDate = subscriptionData.subscriptionExpiryDate;
        const isActive = isPaid && (
            !expiryDate || 
            new Date(expiryDate).getTime() > Date.now()
        );

        if (isActive) {
            // Subscription has been renewed
            await User.findByIdAndUpdate(userId, {
                isPremium: true,
                subscriptionStatus: subscriptionData.isTrialActive ? 'trial' : 'active',
                subscriptionExpiryDate: subscriptionData.subscriptionExpiryDate,
                subscriptionStartDate: subscriptionData.subscriptionStartDate,
            });

            return res.json({
                success: true,
                renewed: true,
                message: 'Subscription renewed',
                subscriptionData
            });
        }

        return res.json({
            success: true,
            renewed: false,
            message: 'Subscription still expired'
        });

    } catch (error) {
        console.error('Migration check-renewal error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to check renewal',
            error: error.message 
        });
    }
});

/**
 * GET /api/migration/status/:email
 * Check migration status for a user by email (for debugging)
 */
router.get('/status/:email', async (req, res) => {
    try {
        const { email } = req.params;
        
        const user = await User.findOne(
            { email: email.toLowerCase().trim() },
            { 
                email: 1, 
                isPremium: 1, 
                subscriptionStatus: 1,
                subscriptionExpiryDate: 1,
                subscriptionStartDate: 1,
                migratedFromOldApp: 1,
                oldAppUserId: 1,
                isTrialUsed: 1,
                isTrialActive: 1,
            }
        );

        if (!user) {
            return res.json({ found: false });
        }

        res.json({
            found: true,
            user: {
                email: user.email,
                isPremium: user.isPremium,
                subscriptionStatus: user.subscriptionStatus,
                subscriptionExpiryDate: user.subscriptionExpiryDate,
                subscriptionStartDate: user.subscriptionStartDate,
                migratedFromOldApp: user.migratedFromOldApp,
                oldAppUserId: user.oldAppUserId,
                isTrialUsed: user.isTrialUsed,
                isTrialActive: user.isTrialActive,
            }
        });

    } catch (error) {
        console.error('Migration status error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get migration status',
            error: error.message 
        });
    }
});

/**
 * POST /api/migration/test
 * Test endpoint to debug old backend connection
 */
router.post('/test', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required for testing' 
            });
        }

        console.log('🧪 Migration Test:');
        console.log('   OLD_BACKEND_URL:', OLD_BACKEND_URL);
        console.log('   MIGRATION_API_KEY set:', !!MIGRATION_API_KEY);
        console.log('   MIGRATION_API_KEY (first 20 chars):', MIGRATION_API_KEY ? MIGRATION_API_KEY.substring(0, 20) + '...' : 'NOT SET');
        console.log('   Test email:', email);

        if (!MIGRATION_API_KEY) {
            return res.json({ 
                success: false, 
                message: 'MIGRATION_API_KEY not set in environment',
                config: {
                    OLD_BACKEND_URL,
                    MIGRATION_API_KEY_SET: false
                }
            });
        }

        // Try calling old backend
        try {
            const testUrl = `${OLD_BACKEND_URL}/payments/restore/subscription`;
            console.log('   Calling:', testUrl);
            
            const response = await axios.post(
                testUrl,
                { email: email.toLowerCase().trim() },
                { 
                    headers: { 
                        'Authorization': `Bearer ${MIGRATION_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            console.log('   Response status:', response.status);
            console.log('   Response data:', JSON.stringify(response.data, null, 2));

            return res.json({
                success: true,
                message: 'Old backend responded successfully',
                config: {
                    OLD_BACKEND_URL,
                    MIGRATION_API_KEY_SET: true,
                    ENDPOINT: testUrl
                },
                oldBackendResponse: response.data
            });

        } catch (axiosError) {
            console.error('   Axios error:', axiosError.message);
            
            return res.json({
                success: false,
                message: 'Failed to connect to old backend',
                config: {
                    OLD_BACKEND_URL,
                    MIGRATION_API_KEY_SET: true,
                    ENDPOINT: `${OLD_BACKEND_URL}/payments/restore/subscription`
                },
                error: {
                    message: axiosError.message,
                    status: axiosError.response?.status,
                    statusText: axiosError.response?.statusText,
                    data: axiosError.response?.data
                }
            });
        }

    } catch (error) {
        console.error('Migration test error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Test failed',
            error: error.message 
        });
    }
});

module.exports = router;

