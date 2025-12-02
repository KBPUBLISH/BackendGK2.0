const express = require('express');
const router = express.Router();
const OneSignal = require('onesignal-node');

// Initialize OneSignal client
const getOneSignalClient = () => {
    const appId = process.env.ONESIGNAL_APP_ID;
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !apiKey) {
        console.warn('⚠️ OneSignal credentials not configured');
        return null;
    }

    return new OneSignal.Client(appId, apiKey);
};

// POST /send - Send notification to all users or specific segments
router.post('/send', async (req, res) => {
    try {
        const client = getOneSignalClient();
        if (!client) {
            return res.status(500).json({ message: 'OneSignal not configured' });
        }

        const {
            title,
            message,
            url,
            segments = ['All'], // Default to all users
            data = {},
            imageUrl,
            buttons
        } = req.body;

        if (!title || !message) {
            return res.status(400).json({ message: 'Title and message are required' });
        }

        const notification = {
            headings: { en: title },
            contents: { en: message },
            included_segments: segments,
            data: data
        };

        // Optional: Add URL to open when notification is clicked
        if (url) {
            notification.url = url;
        }

        // Optional: Add big picture/image
        if (imageUrl) {
            notification.big_picture = imageUrl;
            notification.chrome_web_image = imageUrl;
        }

        // Optional: Add action buttons
        if (buttons && Array.isArray(buttons)) {
            notification.buttons = buttons;
        }

        const response = await client.createNotification(notification);
        
        console.log('✅ Notification sent:', response.body);
        res.json({
            success: true,
            id: response.body.id,
            recipients: response.body.recipients
        });

    } catch (error) {
        console.error('❌ Send notification error:', error);
        res.status(500).json({ 
            message: 'Failed to send notification', 
            error: error.message 
        });
    }
});

// POST /send-to-users - Send notification to specific users by external ID
router.post('/send-to-users', async (req, res) => {
    try {
        const client = getOneSignalClient();
        if (!client) {
            return res.status(500).json({ message: 'OneSignal not configured' });
        }

        const {
            title,
            message,
            userIds, // Array of external user IDs
            url,
            data = {},
            imageUrl
        } = req.body;

        if (!title || !message || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ message: 'Title, message, and userIds array are required' });
        }

        const notification = {
            headings: { en: title },
            contents: { en: message },
            include_external_user_ids: userIds,
            data: data
        };

        if (url) {
            notification.url = url;
        }

        if (imageUrl) {
            notification.big_picture = imageUrl;
            notification.chrome_web_image = imageUrl;
        }

        const response = await client.createNotification(notification);
        
        console.log('✅ Notification sent to users:', response.body);
        res.json({
            success: true,
            id: response.body.id,
            recipients: response.body.recipients
        });

    } catch (error) {
        console.error('❌ Send notification to users error:', error);
        res.status(500).json({ 
            message: 'Failed to send notification', 
            error: error.message 
        });
    }
});

// POST /send-to-players - Send notification to specific player IDs
router.post('/send-to-players', async (req, res) => {
    try {
        const client = getOneSignalClient();
        if (!client) {
            return res.status(500).json({ message: 'OneSignal not configured' });
        }

        const {
            title,
            message,
            playerIds, // Array of OneSignal player IDs
            url,
            data = {},
            imageUrl
        } = req.body;

        if (!title || !message || !playerIds || !Array.isArray(playerIds) || playerIds.length === 0) {
            return res.status(400).json({ message: 'Title, message, and playerIds array are required' });
        }

        const notification = {
            headings: { en: title },
            contents: { en: message },
            include_player_ids: playerIds,
            data: data
        };

        if (url) {
            notification.url = url;
        }

        if (imageUrl) {
            notification.big_picture = imageUrl;
            notification.chrome_web_image = imageUrl;
        }

        const response = await client.createNotification(notification);
        
        console.log('✅ Notification sent to players:', response.body);
        res.json({
            success: true,
            id: response.body.id,
            recipients: response.body.recipients
        });

    } catch (error) {
        console.error('❌ Send notification to players error:', error);
        res.status(500).json({ 
            message: 'Failed to send notification', 
            error: error.message 
        });
    }
});

// GET /segments - Get available segments
router.get('/segments', async (req, res) => {
    // Return common segments - OneSignal doesn't have a direct API for this
    // These are the default segments available in OneSignal
    res.json([
        { id: 'All', name: 'All Users', description: 'Send to all subscribed users' },
        { id: 'Active Users', name: 'Active Users', description: 'Users who have been active recently' },
        { id: 'Inactive Users', name: 'Inactive Users', description: 'Users who haven\'t been active recently' },
        { id: 'Engaged Users', name: 'Engaged Users', description: 'Highly engaged users' }
    ]);
});

// POST /schedule - Schedule a notification for later
router.post('/schedule', async (req, res) => {
    try {
        const client = getOneSignalClient();
        if (!client) {
            return res.status(500).json({ message: 'OneSignal not configured' });
        }

        const {
            title,
            message,
            sendAt, // ISO date string
            segments = ['All'],
            url,
            data = {}
        } = req.body;

        if (!title || !message || !sendAt) {
            return res.status(400).json({ message: 'Title, message, and sendAt are required' });
        }

        const notification = {
            headings: { en: title },
            contents: { en: message },
            included_segments: segments,
            send_after: sendAt,
            data: data
        };

        if (url) {
            notification.url = url;
        }

        const response = await client.createNotification(notification);
        
        console.log('✅ Notification scheduled:', response.body);
        res.json({
            success: true,
            id: response.body.id,
            scheduledFor: sendAt
        });

    } catch (error) {
        console.error('❌ Schedule notification error:', error);
        res.status(500).json({ 
            message: 'Failed to schedule notification', 
            error: error.message 
        });
    }
});

// DELETE /:id - Cancel a scheduled notification
router.delete('/:id', async (req, res) => {
    try {
        const client = getOneSignalClient();
        if (!client) {
            return res.status(500).json({ message: 'OneSignal not configured' });
        }

        const { id } = req.params;

        const response = await client.cancelNotification(id);
        
        console.log('✅ Notification cancelled:', id);
        res.json({
            success: true,
            message: 'Notification cancelled'
        });

    } catch (error) {
        console.error('❌ Cancel notification error:', error);
        res.status(500).json({ 
            message: 'Failed to cancel notification', 
            error: error.message 
        });
    }
});

module.exports = router;

