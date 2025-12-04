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

        // 5. Save to Cache (handle duplicate key errors gracefully)
        try {
            const newCache = new TTSCache({
                textHash,
                voiceId,
                text,
                audioUrl,
                alignmentData
            });
            await newCache.save();
        } catch (cacheError) {
            // If it's a duplicate key error, that's fine - another request already cached it
            if (cacheError.code === 11000) {
                console.log('TTS Cache: Entry already exists (race condition), continuing...');
            } else {
                console.warn('TTS Cache save warning:', cacheError.message);
            }
            // Don't fail the request - we still have the audio
        }

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

CRITICAL RULES:
1. NEVER put brackets around words that already exist in the text!
   - WRONG: "he [gasped]" - this removes "gasped" from being spoken
   - CORRECT: "[gasps] he gasped" - adds sound effect BEFORE, keeps original word
   
2. Emotion tags must be SEPARATE from existing words, not replacing them
   - WRONG: "Farmer Joe's heart [thumped]" 
   - CORRECT: "Farmer Joe's heart thumped [nervously]"
   
3. Place emotion/mood tags like [excitedly], [sadly], [nervously] AFTER the phrase they describe
4. Place sound effect tags like [gasps], [laughs], [sighs] BEFORE the action
5. Don't overuse tags - typically 1-3 per paragraph is enough
6. Add [pause] or [long pause] for dramatic moments
7. For dialogue, add emotions that match the character's feelings

Examples:
- Input: "Wait! he gasped"
- Output: "[gasps] 'Wait!' he gasped [breathlessly]"

- Input: "She laughed with joy"
- Output: "[laughs] She laughed with joy [happily]"

Return ONLY the enhanced text with emotion tags inserted. No explanations. Every original word must remain in the output.`
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
        // IMPORTANT: Never replace words, only add tags before/after them
        let enhancedText = text;

        // Add pauses after periods for dramatic effect
        enhancedText = enhancedText.replace(/\.\s+/g, '. [pause] ');
        
        // Common story phrases - add emotion BEFORE the word, keep the word intact
        // Pattern: word stays, tag is added before it
        enhancedText = enhancedText.replace(/\b(whispered)\b/gi, '[whispers] $1');
        enhancedText = enhancedText.replace(/\b(shouted)\b/gi, '[shouts] $1');
        enhancedText = enhancedText.replace(/\b(yelled)\b/gi, '[yells] $1');
        enhancedText = enhancedText.replace(/\b(screamed)\b/gi, '[shouts] $1');
        enhancedText = enhancedText.replace(/\b(laughed)\b/gi, '[laughs] $1');
        enhancedText = enhancedText.replace(/\b(giggled)\b/gi, '[giggles] $1');
        enhancedText = enhancedText.replace(/\b(chuckled)\b/gi, '[chuckles] $1');
        enhancedText = enhancedText.replace(/\b(cried)\b/gi, '[cries] $1');
        enhancedText = enhancedText.replace(/\b(sobbed)\b/gi, '[sobs] $1');
        enhancedText = enhancedText.replace(/\b(gasped)\b/gi, '[gasps] $1');
        enhancedText = enhancedText.replace(/\b(sighed)\b/gi, '[sighs] $1');
        enhancedText = enhancedText.replace(/\b(exclaimed)\b/gi, '[excitedly] $1');
        enhancedText = enhancedText.replace(/\b(groaned)\b/gi, '[groans] $1');
        enhancedText = enhancedText.replace(/\b(thumped|pounded)\b/gi, '[nervously] $1');
        
        // Dramatic moments
        enhancedText = enhancedText.replace(/\b(suddenly|all of a sudden)\b/gi, '[pause] $1');
        enhancedText = enhancedText.replace(/\b(the end)\b/gi, '[long pause] The End');

        res.json({ enhancedText, method: 'rules' });

    } catch (error) {
        console.error('Text Enhancement Error:', error.message);
        res.status(500).json({ message: 'Failed to enhance text', error: error.message });
    }
});

// POST /enhance-sfx - Add sound effect prompts to text for ambient audio
router.post('/enhance-sfx', async (req, res) => {
    try {
        const { text } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ message: 'Text is required' });
        }

        // Common sound effect categories for children's stories
        const soundEffectExamples = [
            // Nature sounds
            '[gentle wind breeze]', '[wind howling]', '[leaves rustling]', '[rain falling]',
            '[thunder rumbling]', '[birds chirping]', '[owl hooting]', '[crickets chirping]',
            '[water flowing]', '[waves crashing]', '[waterfall]', '[campfire crackling]',
            // Animal sounds
            '[dog barking]', '[cat meowing]', '[horse neighing]', '[cow mooing]',
            '[rooster crowing]', '[sheep bleating]', '[pig oinking]', '[wolf howling]',
            '[lion roaring]', '[elephant trumpeting]', '[frog croaking]', '[bee buzzing]',
            // Environment sounds
            '[door creaking]', '[door slamming]', '[footsteps approaching]', '[footsteps on leaves]',
            '[floorboards creaking]', '[clock ticking]', '[bell ringing]', '[church bells]',
            '[car engine]', '[train whistle]', '[airplane overhead]', '[horse galloping]',
            // Action sounds
            '[glass breaking]', '[wood chopping]', '[hammer pounding]', '[splash]',
            '[swoosh]', '[thud]', '[crash]', '[pop]', '[click]', '[snap]',
            // Magical/Fantasy sounds
            '[magical sparkle]', '[mystical chime]', '[fairy dust]', '[spell casting]',
            '[dragon roar]', '[sword clashing]', '[arrow whoosh]', '[portal opening]',
            // Emotional/Ambient sounds
            '[gentle music]', '[suspenseful music]', '[happy melody]', '[sad melody]',
            '[heartbeat]', '[crowd cheering]', '[children laughing]', '[applause]'
        ];

        // Use OpenAI to intelligently add sound effect prompts
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
                                content: `You are a children's book sound designer. Your job is to enhance story text with sound effect cues that will trigger ambient audio.

Example sound effects you can use:
${soundEffectExamples.join(', ')}

You can also create custom sound effects in the same format: [descriptive sound].

RULES:
1. Place sound effect tags at the START of sentences or phrases where the sound should play
2. Use descriptive, clear sound names that match the scene
3. Don't overuse - typically 1-2 sound effects per paragraph is enough
4. Match the sound to the story's mood and setting
5. For nature scenes, add ambient sounds like wind, birds, water
6. For indoor scenes, consider footsteps, doors, clocks
7. For action scenes, add impact sounds like thuds, crashes, swooshes
8. For magical scenes, use mystical sounds
9. Keep all original text intact - only add sound effect tags

Examples:
- Input: "The old door swung open slowly."
  Output: "[door creaking] The old door swung open slowly."

- Input: "Outside, a storm was brewing."
  Output: "[thunder rumbling] Outside, a storm was brewing. [rain falling]"

- Input: "The princess waved her wand."
  Output: "[magical sparkle] The princess waved her wand."

Return ONLY the enhanced text with sound effect tags inserted. No explanations.`
                            },
                            {
                                role: 'user',
                                content: `Add appropriate sound effect cues to this children's story text:\n\n${text}`
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
                console.error('OpenAI SFX enhancement failed, falling back to rule-based:', aiError.message);
            }
        }

        // Fallback: Simple rule-based sound effect enhancement
        let enhancedText = text;

        // Nature keywords
        enhancedText = enhancedText.replace(/\b(wind blew|breeze|windy)\b/gi, '[gentle wind breeze] $1');
        enhancedText = enhancedText.replace(/\b(storm|stormy|lightning)\b/gi, '[thunder rumbling] $1');
        enhancedText = enhancedText.replace(/\b(rain|raining|rainy)\b/gi, '[rain falling] $1');
        enhancedText = enhancedText.replace(/\b(forest|woods|trees)\b/gi, '[birds chirping] $1');
        enhancedText = enhancedText.replace(/\b(river|stream|creek)\b/gi, '[water flowing] $1');
        enhancedText = enhancedText.replace(/\b(ocean|sea|beach)\b/gi, '[waves crashing] $1');
        enhancedText = enhancedText.replace(/\b(fire|fireplace|campfire)\b/gi, '[fire crackling] $1');

        // Animal sounds
        enhancedText = enhancedText.replace(/\b(dog barked|puppy)\b/gi, '[dog barking] $1');
        enhancedText = enhancedText.replace(/\b(cat meowed|kitten)\b/gi, '[cat meowing] $1');
        enhancedText = enhancedText.replace(/\b(horse|pony)\b/gi, '[horse neighing] $1');
        enhancedText = enhancedText.replace(/\b(owl)\b/gi, '[owl hooting] $1');
        enhancedText = enhancedText.replace(/\b(rooster|morning)\b/gi, '[rooster crowing] $1');

        // Environment sounds
        enhancedText = enhancedText.replace(/\b(door opened|door closed|doorway)\b/gi, '[door creaking] $1');
        enhancedText = enhancedText.replace(/\b(footsteps|walked|walking)\b/gi, '[footsteps approaching] $1');
        enhancedText = enhancedText.replace(/\b(bell rang|church)\b/gi, '[bell ringing] $1');
        enhancedText = enhancedText.replace(/\b(clock)\b/gi, '[clock ticking] $1');

        // Action sounds
        enhancedText = enhancedText.replace(/\b(fell|dropped|crash)\b/gi, '[thud] $1');
        enhancedText = enhancedText.replace(/\b(splash|water|jumped in)\b/gi, '[splash] $1');
        enhancedText = enhancedText.replace(/\b(ran|running|hurried)\b/gi, '[footsteps on leaves] $1');

        // Magic sounds
        enhancedText = enhancedText.replace(/\b(magic|magical|spell|wand)\b/gi, '[magical sparkle] $1');
        enhancedText = enhancedText.replace(/\b(dragon)\b/gi, '[dragon roar] $1');
        enhancedText = enhancedText.replace(/\b(fairy|fairies)\b/gi, '[fairy dust] $1');

        res.json({ enhancedText, method: 'rules' });

    } catch (error) {
        console.error('SFX Enhancement Error:', error.message);
        res.status(500).json({ message: 'Failed to enhance text with sound effects', error: error.message });
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
