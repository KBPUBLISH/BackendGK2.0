const express = require('express');
const router = express.Router();
const Playlist = require('../models/Playlist');

// GET all playlists
router.get('/', async (req, res) => {
    try {
        const playlists = await Playlist.find().sort({ createdAt: -1 });
        res.json(playlists);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET single playlist
router.get('/:id', async (req, res) => {
    try {
        const playlist = await Playlist.findById(req.params.id);
        if (!playlist) return res.status(404).json({ message: 'Playlist not found' });
        res.json(playlist);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST create playlist
router.post('/', async (req, res) => {
    const playlist = new Playlist({
        title: req.body.title,
        description: req.body.description,
        coverImage: req.body.coverImage,
        items: req.body.items || [],
        status: req.body.status,
    });

    try {
        const newPlaylist = await playlist.save();
        res.status(201).json(newPlaylist);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT update playlist
router.put('/:id', async (req, res) => {
    try {
        const playlist = await Playlist.findById(req.params.id);
        if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

        Object.assign(playlist, req.body);
        const updatedPlaylist = await playlist.save();
        res.json(updatedPlaylist);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE delete playlist
router.delete('/:id', async (req, res) => {
    try {
        const playlist = await Playlist.findById(req.params.id);
        if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

        await playlist.deleteOne();
        res.json({ message: 'Playlist deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
