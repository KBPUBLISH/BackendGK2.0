const express = require('express');
const router = express.Router();
const User = require('../models/User');

// OneSignal configuration
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

/**
 * Send push notification via OneSignal
 */
async function sendPushNotification(playerId, title, message, data = {}) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    console.log('⚠️ OneSignal not configured, skipping push notification');
    return false;
  }

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`,
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        include_player_ids: [playerId],
        headings: { en: title },
        contents: { en: message },
        data: data,
        ios_sound: 'coin_sound.wav',
        android_sound: 'coin_sound',
      }),
    });

    const result = await response.json();
    console.log('📬 Push notification sent:', result);
    return true;
  } catch (error) {
    console.error('❌ Failed to send push notification:', error);
    return false;
  }
}

/**
 * POST /api/referrals/sync
 * Sync user's referral code to the backend
 */
router.post('/sync', async (req, res) => {
  try {
    const { userId, email, referralCode } = req.body;

    if (!referralCode) {
      return res.status(400).json({ error: 'Referral code is required' });
    }

    // Find user by email or ID
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    }
    if (!user && email) {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if this code is already taken by another user
    const existingCode = await User.findOne({ 
      referralCode: referralCode.toUpperCase(),
      _id: { $ne: user._id }
    });

    if (existingCode) {
      return res.status(409).json({ error: 'Referral code already in use' });
    }

    // Update user's referral code
    user.referralCode = referralCode.toUpperCase();
    await user.save();

    console.log(`✅ Synced referral code ${referralCode} for user ${user.email}`);
    res.json({ success: true, referralCode: user.referralCode });
  } catch (error) {
    console.error('❌ Error syncing referral code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/referrals/update-push-token
 * Update user's push notification token
 */
router.post('/update-push-token', async (req, res) => {
  try {
    const { userId, email, pushToken } = req.body;

    if (!pushToken) {
      return res.status(400).json({ error: 'Push token is required' });
    }

    // Find user by email or ID
    let user = null;
    if (userId) {
      user = await User.findById(userId);
    }
    if (!user && email) {
      user = await User.findOne({ email: email.toLowerCase() });
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.pushToken = pushToken;
    await user.save();

    console.log(`✅ Updated push token for user ${user.email}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error updating push token:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/referrals/redeem
 * Redeem a referral code and notify the code owner
 */
router.post('/redeem', async (req, res) => {
  try {
    const { code, redeemerUserId, redeemerEmail, redeemerName } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Referral code is required' });
    }

    const normalizedCode = code.toUpperCase().trim();

    // Find the user who owns this referral code
    const codeOwner = await User.findOne({ referralCode: normalizedCode });

    if (!codeOwner) {
      return res.status(404).json({ 
        success: false, 
        error: 'Invalid referral code',
        message: "Hmm, that code doesn't look right. Double-check it!"
      });
    }

    // Check if the redeemer is trying to use their own code
    if (redeemerUserId && codeOwner._id.toString() === redeemerUserId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot use own code',
        message: "Nice try! You can't use your own referral code 😄"
      });
    }

    if (redeemerEmail && codeOwner.email.toLowerCase() === redeemerEmail.toLowerCase()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot use own code',
        message: "Nice try! You can't use your own referral code 😄"
      });
    }

    // Update code owner's stats
    codeOwner.referralStats = codeOwner.referralStats || { totalReferrals: 0, coinsEarned: 0 };
    codeOwner.referralStats.totalReferrals += 1;
    codeOwner.referralStats.coinsEarned += 500;
    await codeOwner.save();

    console.log(`🎉 Referral code ${normalizedCode} redeemed! Owner: ${codeOwner.email}`);

    // Send push notification to code owner
    if (codeOwner.pushToken) {
      const displayName = redeemerName || 'Someone';
      await sendPushNotification(
        codeOwner.pushToken,
        '🎉 You earned 500 Gold Coins!',
        `${displayName} used your referral code! Keep sharing to earn more!`,
        { 
          type: 'referral_used',
          coinsEarned: 500 
        }
      );
    }

    res.json({ 
      success: true, 
      message: '🎉 Awesome! You earned 500 gold coins!',
      ownerNotified: !!codeOwner.pushToken
    });
  } catch (error) {
    console.error('❌ Error redeeming referral code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/referrals/validate/:code
 * Check if a referral code is valid (without redeeming)
 */
router.get('/validate/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase().trim();
    const codeOwner = await User.findOne({ referralCode: code });

    if (!codeOwner) {
      return res.json({ valid: false });
    }

    res.json({ 
      valid: true,
      // Don't expose owner's full email for privacy
      ownerInitial: codeOwner.username ? codeOwner.username.charAt(0).toUpperCase() : '?'
    });
  } catch (error) {
    console.error('❌ Error validating referral code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/referrals/stats/:userId
 * Get referral stats for a user
 */
router.get('/stats/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      referralCode: user.referralCode,
      stats: user.referralStats || { totalReferrals: 0, coinsEarned: 0 }
    });
  } catch (error) {
    console.error('❌ Error getting referral stats:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

