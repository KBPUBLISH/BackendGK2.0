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
const saveAudioFile = async (buffer, filename, bookId = null, pageNumber = null) => {
    // If pageNumber is provided, organize into page-specific subfolder for clarity
    let filePath;
    if (bookId && pageNumber !== null && pageNumber !== undefined) {
        filePath = `books/${bookId}/audio/page${pageNumber}_${filename}`;
    } else if (bookId) {
        filePath = `books/${bookId}/audio/${filename}`;
    } else {
        filePath = `audio/${filename}`;
    }

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

/**
 * Process ElevenLabs character-level alignment into word-level timing
 * @param {string} text - The original text that was sent to TTS
 * @param {object} alignment - ElevenLabs alignment object with characters and timing arrays
 * @returns {object} - Word-level alignment data
 */
const processAlignmentToWords = (text, alignment) => {
    if (!alignment || !alignment.characters || !alignment.character_start_times_seconds) {
        console.warn('⚠️ No valid alignment data received');
        // Fallback to estimated timing
        const words = text.split(/\s+/).filter(w => w.length > 0);
        const estimatedDurationPerWord = 0.4;
        return {
            words: words.map((word, index) => ({
                word,
                start: index * estimatedDurationPerWord,
                end: (index + 1) * estimatedDurationPerWord
            })),
            isEstimated: true
        };
    }

    const { characters, character_start_times_seconds, character_end_times_seconds } = alignment;
    
    // Build word-level timing from character timing
    const words = [];
    let currentWord = '';
    let wordStartTime = null;
    let wordEndTime = null;
    
    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const startTime = character_start_times_seconds[i];
        const endTime = character_end_times_seconds[i];
        
        // Check if this is a word boundary (space, newline, or punctuation followed by space)
        if (char === ' ' || char === '\n' || char === '\t') {
            // End current word if we have one
            if (currentWord.trim().length > 0) {
                words.push({
                    word: currentWord.trim(),
                    start: wordStartTime,
                    end: wordEndTime
                });
            }
            currentWord = '';
            wordStartTime = null;
            wordEndTime = null;
        } else {
            // Add character to current word
            if (wordStartTime === null) {
                wordStartTime = startTime;
            }
            wordEndTime = endTime;
            currentWord += char;
        }
    }
    
    // Don't forget the last word
    if (currentWord.trim().length > 0) {
        words.push({
            word: currentWord.trim(),
            start: wordStartTime,
            end: wordEndTime
        });
    }
    
    console.log('📊 Processed alignment:', {
        totalCharacters: characters.length,
        totalWords: words.length,
        firstWord: words[0],
        lastWord: words[words.length - 1]
    });
    
    return {
        words,
        isEstimated: false
    };
};

// POST /generate - Generate TTS audio
router.post('/generate', async (req, res) => {
    try {
        const { text, voiceId, bookId, languageCode, pageNumber, textBoxIndex } = req.body;

        if (!text || !voiceId) {
            return res.status(400).json({ message: 'Text and voiceId are required' });
        }
        
        // Log page info for debugging
        if (bookId && pageNumber !== undefined) {
            console.log(`📄 Generating TTS for book ${bookId}, page ${pageNumber}${textBoxIndex !== undefined ? `, textbox ${textBoxIndex}` : ''}`);
        }

        // Include language in cache key for multilingual support
        const cacheKey = languageCode && languageCode !== 'en' 
            ? `${text}${voiceId}${languageCode}` 
            : `${text}${voiceId}`;
        
        // 1. Check Cache
        const textHash = crypto.createHash('md5').update(cacheKey).digest('hex');
        const cached = await TTSCache.findOne({ textHash, voiceId });

        if (cached) {
            // Check if cached URL is a local path but GCS is now configured
            // If so, we need to regenerate with GCS
            const isLocalPath = cached.audioUrl && cached.audioUrl.startsWith('/uploads/');
            const gcsConfigured = bucket && process.env.GCS_BUCKET_NAME;
            
            if (isLocalPath && gcsConfigured) {
                console.log('TTS Cache Hit - but URL is local path and GCS is configured, regenerating...');
                // Delete old cache entry so we regenerate with GCS
                await TTSCache.deleteOne({ _id: cached._id });
                // Fall through to generate new audio
            } else if (isLocalPath) {
                console.log('TTS Cache Hit - local path (GCS not configured)');
                return res.json({
                    audioUrl: cached.audioUrl,
                    alignment: cached.alignmentData
                });
            } else {
                console.log('TTS Cache Hit - GCS URL');
                return res.json({
                    audioUrl: cached.audioUrl,
                    alignment: cached.alignmentData
                });
            }
        }

        console.log('TTS Cache Miss - Generating Audio with Timestamps');
        let audioBuffer;
        let alignmentData;

        // ELEVENLABS GENERATION WITH TIMESTAMPS
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ message: 'TTS Generation Failed', error: 'apiKey is not defined' });
        }

        // Use multilingual model for non-English languages
        const isMultilingual = languageCode && languageCode !== 'en';
        const modelId = isMultilingual ? "eleven_multilingual_v2" : "eleven_v3";
        
        // Strip emotional cues from text before sending to ElevenLabs
        // These are bracketed expressions like [happy], [Niños riendo], [long pause], etc.
        // The multilingual model doesn't handle them, and they can interfere with TTS quality
        let processedText = text;
        const bracketRegex = /\[[^\]]+\]/g;
        const brackets = text.match(bracketRegex);
        if (brackets && brackets.length > 0) {
            processedText = text.replace(bracketRegex, '').replace(/\s+/g, ' ').trim();
            console.log(`🔧 Stripped ${brackets.length} bracketed expression(s): ${brackets.join(', ')}`);
        }
        
        console.log(`🎤 Generating TTS with ElevenLabs model: ${modelId} (language: ${languageCode || 'en'})`);
        console.log(`📝 Text length: ${processedText.length} chars`);

        try {
            // Use the /with-timestamps endpoint to get word-level timing
            const response = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
                {
                    text: processedText, // Use processed text with brackets stripped
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
                    params: {
                        output_format: 'mp3_44100_128'
                    }
                }
            );

            // Response contains: audio_base64, alignment (with characters and timing)
            const { audio_base64, alignment } = response.data;
            
            // Convert base64 audio to buffer
            audioBuffer = Buffer.from(audio_base64, 'base64');
            
            // Process character-level alignment into word-level timing (use processed text for accurate alignment)
            alignmentData = processAlignmentToWords(processedText, alignment);
            
            console.log('✅ Got alignment data:', {
                characters: alignment?.characters?.length || 0,
                words: alignmentData?.words?.length || 0
            });

        } catch (error) {
            console.error('❌ ElevenLabs API Error:', error.response?.status, error.response?.data);
            
            // Fallback to regular TTS without timestamps if /with-timestamps fails
            console.log('⚠️ Falling back to TTS without timestamps...');
            try {
                const fallbackResponse = await axios.post(
                    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                    {
                        text: processedText, // Use processed text with brackets stripped
                        model_id: modelId,
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75
                        }
                    },
                    {
                        headers: {
                            'xi-api-key': apiKey,
                            'Content-Type': 'application/json'
                        },
                        responseType: 'arraybuffer',
                        params: {
                            output_format: 'mp3_44100_128'
                        }
                    }
                );
                audioBuffer = fallbackResponse.data;
                
                // Generate estimated word timing as fallback (use processed text)
                const words = processedText.split(/\s+/).filter(w => w.length > 0);
                const estimatedDurationPerWord = 0.4;
                alignmentData = {
                    words: words.map((word, index) => ({
                        word,
                        start: index * estimatedDurationPerWord,
                        end: (index + 1) * estimatedDurationPerWord
                    })),
                    isEstimated: true
                };
            } catch (fallbackError) {
                console.error('❌ Fallback TTS also failed:', fallbackError.message);
                throw fallbackError;
            }
        }

        // 3. Save Audio with descriptive filename
        // Include page and textbox info if available for easier identification in GCS
        let filename;
        if (pageNumber !== undefined && textBoxIndex !== undefined) {
            filename = `p${pageNumber}_tb${textBoxIndex}_${textHash.substring(0, 8)}.mp3`;
        } else if (pageNumber !== undefined) {
            filename = `p${pageNumber}_${textHash.substring(0, 8)}.mp3`;
        } else {
            filename = `${Date.now()}_${textHash.substring(0, 12)}.mp3`;
        }
        const audioUrl = await saveAudioFile(audioBuffer, filename, bookId, pageNumber);

        // 5. Save to Cache (handle duplicate key errors gracefully)
        try {
            const newCache = new TTSCache({
                textHash,
                voiceId,
                text,
                audioUrl,
                alignmentData,
                bookId: bookId || null // Store bookId for cache clearing by book
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

// DELETE /clear-cache - Clear TTS cache to force regeneration with real timestamps
// This is useful when timestamp logic has been updated
router.delete('/clear-cache', async (req, res) => {
    try {
        const { textHash, voiceId, clearAll } = req.body;
        
        if (clearAll === true) {
            // Clear all cache entries
            const result = await TTSCache.deleteMany({});
            console.log(`🗑️ Cleared entire TTS cache: ${result.deletedCount} entries`);
            return res.json({ 
                success: true, 
                message: `Cleared ${result.deletedCount} cache entries`,
                deletedCount: result.deletedCount 
            });
        }
        
        // Clear only entries with local paths (for migration to GCS)
        if (req.body.clearLocalPaths === true) {
            const result = await TTSCache.deleteMany({ 
                audioUrl: { $regex: '^/uploads/' } 
            });
            console.log(`🗑️ Cleared ${result.deletedCount} cache entries with local paths`);
            return res.json({ 
                success: true, 
                message: `Cleared ${result.deletedCount} cache entries with local /uploads/ paths`,
                deletedCount: result.deletedCount 
            });
        }
        
        if (textHash && voiceId) {
            // Clear specific cache entry
            const result = await TTSCache.deleteOne({ textHash, voiceId });
            return res.json({ 
                success: true, 
                message: result.deletedCount > 0 ? 'Cache entry cleared' : 'No cache entry found',
                deletedCount: result.deletedCount 
            });
        }
        
        if (voiceId) {
            // Clear all cache entries for a specific voice
            const result = await TTSCache.deleteMany({ voiceId });
            return res.json({ 
                success: true, 
                message: `Cleared ${result.deletedCount} cache entries for voice`,
                deletedCount: result.deletedCount 
            });
        }
        
        // Clear all cache entries for a specific book
        if (req.body.bookId) {
            const result = await TTSCache.deleteMany({ bookId: req.body.bookId });
            console.log(`🗑️ Cleared ${result.deletedCount} TTS cache entries for book ${req.body.bookId}`);
            return res.json({ 
                success: true, 
                message: `Cleared ${result.deletedCount} cache entries for book`,
                deletedCount: result.deletedCount,
                bookId: req.body.bookId
            });
        }
        
        return res.status(400).json({ 
            success: false, 
            message: 'Provide textHash+voiceId, voiceId, bookId, or clearAll=true' 
        });
        
    } catch (error) {
        console.error('Clear Cache Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to clear cache', error: error.message });
    }
});

// GET /cache-stats - Get TTS cache statistics
router.get('/cache-stats', async (req, res) => {
    try {
        const totalEntries = await TTSCache.countDocuments();
        const estimatedEntries = await TTSCache.countDocuments({ 'alignmentData.isEstimated': true });
        const realTimestampEntries = await TTSCache.countDocuments({ 'alignmentData.isEstimated': { $ne: true } });
        
        res.json({
            totalEntries,
            estimatedEntries,
            realTimestampEntries,
            note: 'Entries without isEstimated flag are old cache with estimated timestamps'
        });
    } catch (error) {
        console.error('Cache Stats Error:', error.message);
        res.status(500).json({ message: 'Failed to get cache stats', error: error.message });
    }
});

module.exports = router;
