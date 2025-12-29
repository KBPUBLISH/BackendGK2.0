const express = require('express');
const router = express.Router();
const PlayEvent = require('../models/PlayEvent');

// POST - Record a play event
router.post('/', async (req, res) => {
    try {
        const { contentType, contentId, playlistId, itemIndex, userId } = req.body;
        
        if (!contentType || !contentId) {
            return res.status(400).json({ message: 'contentType and contentId are required' });
        }
        
        const playEvent = new PlayEvent({
            contentType,
            contentId,
            playlistId,
            itemIndex,
            userId: userId || 'anonymous',
            playedAt: new Date(),
        });
        
        await playEvent.save();
        
        console.log(`📊 Play event recorded: ${contentType} ${contentId}`);
        res.status(201).json({ success: true, eventId: playEvent._id });
    } catch (error) {
        console.error('Error recording play event:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET - Get play counts for content within a time window
router.get('/counts', async (req, res) => {
    try {
        const { contentType, timeWindow = '7d' } = req.query;
        
        // Parse time window
        const windowMs = parseTimeWindow(timeWindow);
        const since = new Date(Date.now() - windowMs);
        
        const matchStage = { playedAt: { $gte: since } };
        if (contentType) {
            matchStage.contentType = contentType;
        }
        
        const counts = await PlayEvent.aggregate([
            { $match: matchStage },
            { 
                $group: { 
                    _id: { contentType: '$contentType', contentId: '$contentId' },
                    count: { $sum: 1 },
                    lastPlayed: { $max: '$playedAt' }
                } 
            },
            { $sort: { count: -1 } },
            { $limit: 100 }
        ]);
        
        res.json(counts);
    } catch (error) {
        console.error('Error fetching play counts:', error);
        res.status(500).json({ message: error.message });
    }
});

// Helper to parse time window string to milliseconds
function parseTimeWindow(window) {
    const match = window.match(/^(\d+)(h|d|w|m)$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
        case 'h': return value * 60 * 60 * 1000; // hours
        case 'd': return value * 24 * 60 * 60 * 1000; // days
        case 'w': return value * 7 * 24 * 60 * 60 * 1000; // weeks
        case 'm': return value * 30 * 24 * 60 * 60 * 1000; // months (approx)
        default: return 7 * 24 * 60 * 60 * 1000;
    }
}

module.exports = router;

