require('dotenv').config(); // Ensure env vars are loaded
const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
// FormData not needed for TTS generation - using JSON with ElevenLabs API
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
        const textHash = crypto.createHash('md5').update(text + voiceId).digest('hex');
        const cached = await TTSCache.findOne({ textHash, voiceId });

        if (cached) {
            console.log('TTS Cache Hit');
            return res.json({
                audioUrl: cached.audioUrl,
                alignment: cached.alignmentData
            });
        }

        console.log('TTS Cache Miss - Generating Audio');
        let audioBuffer;

        // ELEVENLABS GENERATION (for all voices including cloned)
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ message: 'TTS Generation Failed', error: 'apiKey is not defined' });
        }

        const modelId = "eleven_v3";
        console.log('🎤 Generating TTS with ElevenLabs model:', modelId);

        try {
            const response = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                {
                    text,
                    model_id: modelId,
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
                        enable_logging: false
                    }
                }
            );
            audioBuffer = response.data;
        } catch (error) {
            console.error('❌ ElevenLabs API Error:', error.response?.status);
            throw error;
        }

        // 3. Save Audio
        const filename = `${Date.now()}_${textHash}.mp3`;
        const audioUrl = await saveAudioFile(audioBuffer, filename, bookId);

        // 4. Generate word-level alignment data (Estimate)
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const estimatedDurationPerWord = 0.4; // seconds

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

// POST /enhance - Add ElevenLabs emotion prompts to text
router.post('/enhance', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ message: 'Text is required' });
        }

        // ElevenLabs v3 supported emotion/style tags
        // Reference: https://elevenlabs.io/docs/speech-synthesis/prompting
        const emotionTags = [
            '[laughs]', '[chuckles]', '[giggles]', '[sighs]', '[gasps]',
            '[whispers]', '[shouts]', '[yells]', '[cries]', '[sobs]',
            '[sniffles]', '[clears throat]', '[coughs]', '[groans]',
            '[excitedly]', '[sadly]', '[angrily]', '[happily]', '[nervously]',
            '[mysteriously]', '[dramatically]', '[softly]', '[loudly]',
            '[slowly]', '[quickly]', '[pause]', '[long pause]'
        ];

        // Use OpenAI to intelligently add emotion prompts
        const openaiKey = process.env.OPENAI_API_KEY;
        
        if (openaiKey) {
            try {
                const response = await axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    {
                        model: 'gpt-4o-mini',
                        messages: [
                            {
                                role: 'system',
                                content: `You are a children's book narrator assistant. Your job is to enhance story text with emotion prompts that ElevenLabs text-to-speech can interpret.

Available emotion tags you can insert:
${emotionTags.join(', ')}

Rules:
1. Insert emotion tags naturally where they fit the story's mood
2. Don't overuse tags - typically 1-3 per paragraph is enough
3. Place tags BEFORE the text they should affect, or inline for sound effects
4. Keep the original text intact, only add tags
5. For dialogue, add emotions that match the character's feelings
6. Add [pause] or [long pause] for dramatic moments
7. Use [whispers] for secrets, [excitedly] for exciting parts, [sadly] for sad moments
8. Sound effects like [laughs], [gasps], [sighs] should be placed where a character would make that sound

Return ONLY the enhanced text with emotion tags inserted. No explanations.`
                            },
                            {
                                role: 'user',
                                content: `Enhance this children's story text with appropriate emotion prompts:\n\n${text}`
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 2000
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${openaiKey}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );

                const enhancedText = response.data.choices[0].message.content.trim();
                return res.json({ enhancedText, method: 'ai' });
            } catch (aiError) {
                console.error('OpenAI enhancement failed, falling back to rule-based:', aiError.message);
            }
        }

        // Fallback: Simple rule-based enhancement
        let enhancedText = text;

        // Add pauses after periods for dramatic effect
        enhancedText = enhancedText.replace(/\.\s+/g, '. [pause] ');
        
        // Add excitement for exclamation marks
        enhancedText = enhancedText.replace(/!\s*/g, '! ');
        
        // Add mystery for questions
        enhancedText = enhancedText.replace(/\?\s*/g, '? ');

        // Common story phrases
        enhancedText = enhancedText.replace(/\b(whispered)\b/gi, '[whispers] whispered');
        enhancedText = enhancedText.replace(/\b(shouted|yelled|screamed)\b/gi, '[shouts] $1');
        enhancedText = enhancedText.replace(/\b(laughed|giggled|chuckled)\b/gi, '[laughs] $1');
        enhancedText = enhancedText.replace(/\b(cried|sobbed)\b/gi, '[sadly] $1');
        enhancedText = enhancedText.replace(/\b(gasped)\b/gi, '[gasps] gasped');
        enhancedText = enhancedText.replace(/\b(sighed)\b/gi, '[sighs] sighed');
        enhancedText = enhancedText.replace(/\b(exclaimed)\b/gi, '[excitedly] exclaimed');
        
        // Dramatic moments
        enhancedText = enhancedText.replace(/\b(suddenly|all of a sudden)\b/gi, '[pause] $1');
        enhancedText = enhancedText.replace(/\b(the end)\b/gi, '[long pause] The End');

        res.json({ enhancedText, method: 'rules' });

    } catch (error) {
        console.error('Text Enhancement Error:', error.message);
        res.status(500).json({ message: 'Failed to enhance text', error: error.message });
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
