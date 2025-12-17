const express = require('express');
const router = express.Router();
const Music = require('../models/Music');

// GET /api/music - Get all music tracks
router.get('/', async (req, res) => {
    try {
        const { category, status } = req.query;
        const query = {};
        
        if (category) {
            query.category = category;
        }
        if (status) {
            query.status = status;
        } else {
            query.status = 'published';
        }

        const music = await Music.find(query).sort({ order: 1, createdAt: -1 });
        res.json(music);
    } catch (error) {
        console.error('Error fetching music:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/music/categories - Get music categories
router.get('/categories', async (req, res) => {
    try {
        const categories = await Music.distinct('category');
        res.json(categories);
    } catch (error) {
        console.error('Error fetching music categories:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/music/:id - Get a specific track
router.get('/:id', async (req, res) => {
    try {
        const track = await Music.findById(req.params.id);
        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }
        res.json(track);
    } catch (error) {
        console.error('Error fetching track:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/music - Create a new track (admin)
router.post('/', async (req, res) => {
    try {
        const track = new Music(req.body);
        await track.save();
        res.status(201).json(track);
    } catch (error) {
        console.error('Error creating track:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/music/:id - Update a track (admin)
router.put('/:id', async (req, res) => {
    try {
        const track = await Music.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true }
        );
        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }
        res.json(track);
    } catch (error) {
        console.error('Error updating track:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/music/:id - Delete a track (admin)
router.delete('/:id', async (req, res) => {
    try {
        const track = await Music.findByIdAndDelete(req.params.id);
        if (!track) {
            return res.status(404).json({ error: 'Track not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting track:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

