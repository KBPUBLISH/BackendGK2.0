const express = require('express');
const router = express.Router();
const { runSubscriptionCheck } = require('../jobs/subscriptionChecker');

// Admin API key for protected job endpoints
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || process.env.MIGRATION_API_KEY;

/**
 * Middleware to verify admin API key
 */
const verifyAdminKey = (req, res, next) => {
    const apiKey = req.headers['x-admin-api-key'] || req.headers['x-migration-api-key'];
    
    if (!ADMIN_API_KEY) {
        return res.status(500).json({ error: 'Admin API key not configured' });
    }

    if (!apiKey || apiKey !== ADMIN_API_KEY) {
        return res.status(401).json({ error: 'Invalid or missing admin API key' });
    }

    next();
};

/**
 * POST /api/jobs/check-subscriptions
 * Manually trigger the subscription check job
 * Requires X-Admin-API-Key header
 */
router.post('/check-subscriptions', verifyAdminKey, async (req, res) => {
    console.log('📋 Subscription check job triggered manually');

    try {
        const result = await runSubscriptionCheck();
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Subscription check completed',
                ...result,
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Subscription check failed',
                error: result.error,
            });
        }
    } catch (error) {
        console.error('Error running subscription check:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/jobs/status
 * Check if job routes are working
 */
router.get('/status', (req, res) => {
    res.json({
        status: 'ok',
        availableJobs: [
            {
                name: 'check-subscriptions',
                method: 'POST',
                path: '/api/jobs/check-subscriptions',
                description: 'Check subscription status for migrated users',
                requiresAuth: true,
            }
        ],
    });
});

module.exports = router;

