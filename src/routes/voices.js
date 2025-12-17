const express = require('express');
const router = express.Router();

// In-memory voice list (could be moved to DB later)
const voices = [
    { id: 'alloy', name: 'Alloy', description: 'Neutral and balanced', category: 'standard', isEnabled: true },
    { id: 'echo', name: 'Echo', description: 'Warm and conversational', category: 'standard', isEnabled: true },
    { id: 'fable', name: 'Fable', description: 'Expressive and dramatic', category: 'standard', isEnabled: true },
    { id: 'onyx', name: 'Onyx', description: 'Deep and authoritative', category: 'standard', isEnabled: true },
    { id: 'nova', name: 'Nova', description: 'Friendly and upbeat', category: 'standard', isEnabled: true },
    { id: 'shimmer', name: 'Shimmer', description: 'Clear and gentle', category: 'standard', isEnabled: true },
];

// GET /api/voices - Get all voices
router.get('/', async (req, res) => {
    try {
        res.json(voices);
    } catch (error) {
        console.error('Error fetching voices:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/voices/enabled - Get only enabled voices
router.get('/enabled', async (req, res) => {
    try {
        const enabledVoices = voices.filter(v => v.isEnabled);
        res.json(enabledVoices);
    } catch (error) {
        console.error('Error fetching enabled voices:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/voices/:id - Get a specific voice
router.get('/:id', async (req, res) => {
    try {
        const voice = voices.find(v => v.id === req.params.id);
        if (!voice) {
            return res.status(404).json({ error: 'Voice not found' });
        }
        res.json(voice);
    } catch (error) {
        console.error('Error fetching voice:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

