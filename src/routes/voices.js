const express = require('express');
const router = express.Router();
const axios = require('axios');
const mongoose = require('mongoose');
const Voice = require('../models/Voice');

// GET / - Get all voices (enabled and disabled)
router.get('/', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database not connected' });
        }

        const voices = await Voice.find().sort({ name: 1 });
        res.json(voices);
    } catch (error) {
        console.error('Get Voices Error:', error);
        res.status(500).json({ message: 'Failed to fetch voices', error: error.message });
    }
});

// GET /enabled - Get only enabled voices (for app use)
router.get('/enabled', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database not connected' });
        }

        const voices = await Voice.find({ enabled: true }).sort({ name: 1 });
        res.json(voices);
    } catch (error) {
        console.error('Get Enabled Voices Error:', error);
        res.status(500).json({ message: 'Failed to fetch enabled voices', error: error.message });
    }
});

// GET /sync - Sync voices from ElevenLabs API
router.get('/sync', async (req, res) => {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ message: 'ElevenLabs API key not configured' });
        }

        // Fetch voices from ElevenLabs
        const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey }
        });

        const elevenLabsVoices = response.data.voices;
        let synced = 0;
        let created = 0;
        let updated = 0;

        // Sync each voice
        for (const voice of elevenLabsVoices) {
            const existing = await Voice.findOne({ voiceId: voice.voice_id });
            
            if (existing) {
                // Update existing voice
                existing.name = voice.name;
                existing.category = voice.category || 'premade';
                existing.previewUrl = voice.preview_url;
                existing.updatedAt = Date.now();
                await existing.save();
                updated++;
            } else {
                // Create new voice (default to enabled)
                await Voice.create({
                    voiceId: voice.voice_id,
                    name: voice.name,
                    category: voice.category || 'premade',
                    previewUrl: voice.preview_url,
                    enabled: true
                });
                created++;
            }
            synced++;
        }

        res.json({
            message: 'Voices synced successfully',
            synced,
            created,
            updated,
            total: synced
        });
    } catch (error) {
        console.error('Sync Voices Error:', error);
        res.status(500).json({ message: 'Failed to sync voices', error: error.message });
    }
});

// PUT /:voiceId/enable - Enable a voice
router.put('/:voiceId/enable', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database not connected' });
        }

        const voice = await Voice.findOne({ voiceId: req.params.voiceId });
        if (!voice) {
            return res.status(404).json({ message: 'Voice not found' });
        }

        voice.enabled = true;
        voice.updatedAt = Date.now();
        await voice.save();

        res.json({ message: 'Voice enabled', voice });
    } catch (error) {
        console.error('Enable Voice Error:', error);
        res.status(500).json({ message: 'Failed to enable voice', error: error.message });
    }
});

// PUT /:voiceId/disable - Disable a voice
router.put('/:voiceId/disable', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database not connected' });
        }

        const voice = await Voice.findOne({ voiceId: req.params.voiceId });
        if (!voice) {
            return res.status(404).json({ message: 'Voice not found' });
        }

        voice.enabled = false;
        voice.updatedAt = Date.now();
        await voice.save();

        res.json({ message: 'Voice disabled', voice });
    } catch (error) {
        console.error('Disable Voice Error:', error);
        res.status(500).json({ message: 'Failed to disable voice', error: error.message });
    }
});

// PUT /:voiceId - Update voice metadata
router.put('/:voiceId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database not connected' });
        }

        const voice = await Voice.findOne({ voiceId: req.params.voiceId });
        if (!voice) {
            return res.status(404).json({ message: 'Voice not found' });
        }

        // Update allowed fields
        if (req.body.enabled !== undefined) voice.enabled = req.body.enabled;
        if (req.body.description !== undefined) voice.description = req.body.description;
        if (req.body.ageGroup !== undefined) voice.ageGroup = req.body.ageGroup;
        if (req.body.language !== undefined) voice.language = req.body.language;
        
        voice.updatedAt = Date.now();
        await voice.save();

        res.json({ message: 'Voice updated', voice });
    } catch (error) {
        console.error('Update Voice Error:', error);
        res.status(500).json({ message: 'Failed to update voice', error: error.message });
    }
});

module.exports = router;

