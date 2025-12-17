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

        const voices = await Voice.find().sort({ displayOrder: 1, name: 1 });
        res.json(voices);
    } catch (error) {
        console.error('Get Voices Error:', error);
        res.status(500).json({ message: 'Failed to fetch voices', error: error.message });
    }
});

// Default voices to return if database is empty and ElevenLabs fails
// These are standard ElevenLabs voices that should always work
const DEFAULT_VOICES = [
    { voiceId: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', category: 'premade', enabled: true },
    { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', category: 'premade', enabled: true },
    { voiceId: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', category: 'premade', enabled: true },
    { voiceId: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', category: 'premade', enabled: true },
    { voiceId: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', category: 'premade', enabled: true },
    { voiceId: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', category: 'premade', enabled: true },
];

// GET /enabled - Get only enabled voices (for app use)
router.get('/enabled', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            console.log('⚠️ Database not connected, returning default voices');
            return res.json(DEFAULT_VOICES);
        }

        const voices = await Voice.find({ enabled: true }).sort({ displayOrder: 1, name: 1 });
        
        // If no voices are in the database, fallback to fetching from ElevenLabs directly
        if (voices.length === 0) {
            console.log('⚠️ No voices in database, falling back to ElevenLabs API...');
            const apiKey = process.env.ELEVENLABS_API_KEY;
            if (apiKey) {
                try {
                    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
                        headers: { 'xi-api-key': apiKey }
                    });
                    const elevenLabsVoices = response.data.voices.map(v => ({
                        voiceId: v.voice_id,
                        name: v.name,
                        category: v.category || 'premade',
                        previewUrl: v.preview_url,
                        enabled: true
                    }));
                    console.log(`📢 Returning ${elevenLabsVoices.length} voices from ElevenLabs (database empty)`);
                    return res.json(elevenLabsVoices);
                } catch (elevenLabsError) {
                    console.error('ElevenLabs fallback failed:', elevenLabsError.message);
                    // Fall through to return default voices
                }
            }
            
            // Last resort: return hardcoded default voices
            console.log('⚠️ Returning hardcoded default voices (ElevenLabs API failed or no key)');
            return res.json(DEFAULT_VOICES);
        }
        
        console.log(`📢 Returning ${voices.length} enabled voices from database`);
        res.json(voices);
    } catch (error) {
        console.error('Get Enabled Voices Error:', error);
        // Even on error, return default voices so TTS works
        console.log('⚠️ Error occurred, returning default voices');
        res.json(DEFAULT_VOICES);
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
        console.log('🔄 Syncing voices from ElevenLabs...');
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
                // Update existing voice (but preserve user-defined fields)
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
                    enabled: true,
                    displayOrder: synced // Default order based on sync order
                });
                created++;
            }
            synced++;
        }

        console.log(`✅ Voices synced: ${synced} total, ${created} created, ${updated} updated`);
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

        console.log(`✅ Voice enabled: ${voice.customName || voice.name}`);
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

        console.log(`🔇 Voice disabled: ${voice.customName || voice.name}`);
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
        if (req.body.customName !== undefined) voice.customName = req.body.customName;
        if (req.body.characterImage !== undefined) voice.characterImage = req.body.characterImage;
        if (req.body.description !== undefined) voice.description = req.body.description;
        if (req.body.ageGroup !== undefined) voice.ageGroup = req.body.ageGroup;
        if (req.body.language !== undefined) voice.language = req.body.language;
        if (req.body.displayOrder !== undefined) voice.displayOrder = req.body.displayOrder;
        if (req.body.isPremium !== undefined) voice.isPremium = req.body.isPremium;
        
        voice.updatedAt = Date.now();
        await voice.save();

        console.log(`📝 Voice updated: ${voice.customName || voice.name}`);
        res.json({ message: 'Voice updated', voice });
    } catch (error) {
        console.error('Update Voice Error:', error);
        res.status(500).json({ message: 'Failed to update voice', error: error.message });
    }
});

// DELETE /:voiceId - Delete a voice
router.delete('/:voiceId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ message: 'Database not connected' });
        }

        const result = await Voice.findOneAndDelete({ voiceId: req.params.voiceId });
        if (!result) {
            return res.status(404).json({ message: 'Voice not found' });
        }

        console.log(`🗑️ Voice deleted: ${result.customName || result.name}`);
        res.json({ message: 'Voice deleted', voice: result });
    } catch (error) {
        console.error('Delete Voice Error:', error);
        res.status(500).json({ message: 'Failed to delete voice', error: error.message });
    }
});

module.exports = router;
