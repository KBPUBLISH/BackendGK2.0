/**
 * Subscription Checker Job
 * 
 * This job runs daily to check if migrated users have renewed their subscriptions
 * in the old Godly Kids app. If a renewal is detected, their subscription is updated
 * in the new backend.
 * 
 * Usage:
 * - Can be called manually via POST /api/jobs/check-subscriptions
 * - Should be set up as a cron job to run daily (e.g., via Render cron jobs or external scheduler)
 */

const axios = require('axios');
const User = require('../models/User');

// Configuration
const OLD_BACKEND_URL = process.env.OLD_BACKEND_URL || 'https://api.devgodlykids.kbpublish.org/api';
const MIGRATION_API_KEY = process.env.MIGRATION_API_KEY;

/**
 * Check a single user's subscription status against the old backend
 */
async function checkUserSubscription(user) {
    if (!user.email || !user.migratedFromOldApp) {
        return { userId: user._id, skipped: true, reason: 'Not migrated or no email' };
    }

    try {
        const response = await axios.post(
            `${OLD_BACKEND_URL}/migration/check-subscription`,
            { email: user.email },
            { 
                headers: { 
                    'X-Migration-API-Key': MIGRATION_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );

        const data = response.data;

        if (!data.found) {
            return { userId: user._id, updated: false, reason: 'User not found in old backend' };
        }

        const isPaid = data.membership === 'paid';
        const isActive = isPaid && (
            !data.subscriptionExpiryDate || 
            data.subscriptionExpiryDate > Date.now()
        );

        // Check if status has changed
        const wasActive = user.isPremium && user.subscriptionStatus === 'active';
        
        if (isActive && !wasActive) {
            // Subscription renewed!
            await User.findByIdAndUpdate(user._id, {
                isPremium: true,
                subscriptionStatus: data.isTrialActive ? 'trial' : 'active',
                subscriptionExpiryDate: data.subscriptionExpiryDate,
                subscriptionStartDate: data.subscriptionStartDate,
            });

            return { 
                userId: user._id, 
                updated: true, 
                action: 'renewed',
                newExpiry: data.subscriptionExpiryDate 
            };
        } else if (!isActive && wasActive) {
            // Subscription expired
            await User.findByIdAndUpdate(user._id, {
                isPremium: false,
                subscriptionStatus: 'expired',
            });

            return { 
                userId: user._id, 
                updated: true, 
                action: 'expired' 
            };
        }

        return { userId: user._id, updated: false, reason: 'No status change' };

    } catch (error) {
        console.error(`Error checking subscription for user ${user._id}:`, error.message);
        return { userId: user._id, error: error.message };
    }
}

/**
 * Run the subscription check job for all migrated users
 */
async function runSubscriptionCheck() {
    console.log('🔄 Starting subscription check job...');
    
    if (!MIGRATION_API_KEY) {
        console.error('❌ MIGRATION_API_KEY not configured');
        return { success: false, error: 'Migration API key not configured' };
    }

    const startTime = Date.now();
    const results = {
        total: 0,
        checked: 0,
        renewed: 0,
        expired: 0,
        skipped: 0,
        errors: 0,
    };

    try {
        // Find all users who were migrated from the old app
        const migratedUsers = await User.find({
            migratedFromOldApp: true,
        }).select('_id email isPremium subscriptionStatus subscriptionExpiryDate migratedFromOldApp');

        results.total = migratedUsers.length;
        console.log(`📊 Found ${migratedUsers.length} migrated users to check`);

        // Process users in batches to avoid overwhelming the old backend
        const BATCH_SIZE = 10;
        const DELAY_BETWEEN_BATCHES = 2000; // 2 seconds

        for (let i = 0; i < migratedUsers.length; i += BATCH_SIZE) {
            const batch = migratedUsers.slice(i, i + BATCH_SIZE);
            
            const batchResults = await Promise.all(
                batch.map(user => checkUserSubscription(user))
            );

            // Tally results
            for (const result of batchResults) {
                if (result.skipped) {
                    results.skipped++;
                } else if (result.error) {
                    results.errors++;
                } else if (result.updated) {
                    results.checked++;
                    if (result.action === 'renewed') {
                        results.renewed++;
                        console.log(`✅ User ${result.userId} subscription renewed until ${new Date(result.newExpiry).toISOString()}`);
                    } else if (result.action === 'expired') {
                        results.expired++;
                        console.log(`⚠️ User ${result.userId} subscription expired`);
                    }
                } else {
                    results.checked++;
                }
            }

            // Delay between batches
            if (i + BATCH_SIZE < migratedUsers.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
            }
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✨ Subscription check completed in ${duration}s`);
        console.log(`   Total: ${results.total}, Checked: ${results.checked}, Renewed: ${results.renewed}, Expired: ${results.expired}, Skipped: ${results.skipped}, Errors: ${results.errors}`);

        return {
            success: true,
            duration: `${duration}s`,
            ...results,
        };

    } catch (error) {
        console.error('❌ Subscription check job failed:', error);
        return {
            success: false,
            error: error.message,
            ...results,
        };
    }
}

module.exports = {
    checkUserSubscription,
    runSubscriptionCheck,
};

