require('dotenv').config(); // Ensure env vars are loaded
const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { bucket } = require('../config/storage');
const TTSCache = require('../models/TTSCache');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Helper to save buffer to file (Local or GCS)
const saveAudioFile = async (buffer, filename, bookId = null) => {
    const filePath = bookId ? `books/${bookId}/audio/${filename}` : `audio/${filename}`;

    // Check if GCS is configured
    if (bucket && process.env.GCS_BUCKET_NAME) {
        return new Promise((resolve, reject) => {
            const blob = bucket.file(filePath);
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: 'audio/mpeg',
                },
            });

            blobStream.on('error', (error) => {
                console.error('GCS Upload error:', error);
                // Fallback to local
                saveLocal(buffer, filePath).then(resolve).catch(reject);
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                resolve(publicUrl);
            });

            blobStream.end(buffer);
        });
    } else {
        return saveLocal(buffer, filePath);
    }
};

const saveLocal = (buffer, gcsPath) => {
    return new Promise((resolve, reject) => {
        const localPath = path.join(uploadsDir, gcsPath);
        const dir = path.dirname(localPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFile(localPath, buffer, (err) => {
            if (err) reject(err);
            else resolve(`/uploads/${gcsPath}`);
        });
    });
};

// POST /generate - Generate TTS audio
router.post('/generate', async (req, res) => {
    try {
        const { text, voiceId, bookId } = req.body;

        if (!text || !voiceId) {
            return res.status(400).json({ message: 'Text and voiceId are required' });
        }

        // 1. Check Cache
        const textHash = crypto.createHash('md5').update(text).digest('hex');
        const cached = await TTSCache.findOne({ textHash, voiceId });

        if (cached) {
            console.log('TTS Cache Hit');
            return res.json({
                audioUrl: cached.audioUrl,
                alignment: cached.alignmentData
            });
        }

        console.log('TTS Cache Miss - Calling ElevenLabs');

        // 2. Call ElevenLabs API
        const apiKey = process.env.ELEVENLABS_API_KEY;
        console.log('TTS API Key check:', apiKey ? `Found (${apiKey.substring(0, 10)}...)` : 'NOT FOUND');
        if (!apiKey) {
            console.error('ELEVENLABS_API_KEY is missing from environment');
            return res.status(500).json({ message: 'ElevenLabs API key not configured' });
        }

        // Use the non-stream endpoint to get word-level timestamps
        // ElevenLabs supports word-level timestamps via the standard endpoint with enable_logging
        const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                text,
                model_id: "eleven_multilingual_v2",
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            },
            {
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                responseType: 'arraybuffer',
                params: {
                    output_format: 'mp3_44100_128',
                    enable_logging: false // Set to true if you want detailed logs
                }
            }
        );

        // 3. Save Audio
        const filename = `${Date.now()}_${textHash}.mp3`;
        const audioUrl = await saveAudioFile(response.data, filename, bookId);

        // 4. Generate word-level alignment data
        // Since ElevenLabs doesn't return timestamps in the standard API response,
        // we'll estimate word timings based on text length and average speaking rate
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const totalChars = text.length;
        
        // Estimate: average speaking rate is ~150 words per minute = 2.5 words per second
        // Or ~400ms per word on average (including pauses)
        const estimatedDurationPerWord = 0.4; // seconds
        const totalEstimatedDuration = words.length * estimatedDurationPerWord;
        
        // Create word-level alignment data
        const alignmentData = {
            words: words.map((word, index) => {
                const startTime = index * estimatedDurationPerWord;
                const endTime = (index + 1) * estimatedDurationPerWord;
                return {
                    word: word,
                    start: startTime,
                    end: endTime
                };
            }),
            // Keep character-level for backward compatibility (empty for now)
            characters: [],
            character_start_times_seconds: [],
            character_end_times_seconds: []
        };

        // 5. Save to Cache
        const newCache = new TTSCache({
            textHash,
            voiceId,
            text,
            audioUrl,
            alignmentData
        });
        await newCache.save();

        res.json({
            audioUrl,
            alignment: alignmentData
        });

    } catch (error) {
        console.error('TTS Error:', error.response?.data || error.message);
        res.status(500).json({ message: 'TTS Generation Failed', error: error.message });
    }
});

// GET /voices - Get available voices
router.get('/voices', async (req, res) => {
    try {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ message: 'ElevenLabs API key not configured' });
        }

        const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey }
        });

        const voices = response.data.voices.map(v => ({
            voice_id: v.voice_id,
            name: v.name,
            preview_url: v.preview_url,
            category: v.category
        }));

        res.json(voices);
    } catch (error) {
        console.error('Fetch Voices Error:', error.message);
        res.status(500).json({ message: 'Failed to fetch voices' });
    }
});

module.exports = router;
