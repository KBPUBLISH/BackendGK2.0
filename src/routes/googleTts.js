const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { bucket } = require('../config/storage');
const textToSpeech = require('@google-cloud/text-to-speech');

// Initialize Google Cloud TTS client
// Uses GOOGLE_APPLICATION_CREDENTIALS env var or GCS_CREDENTIALS_JSON
let ttsClient = null;

const getTTSClient = () => {
    if (ttsClient) return ttsClient;
    
    try {
        // Check if we have credentials from GCS config (same as storage.js uses)
        if (process.env.GCS_CREDENTIALS_JSON) {
            const credentials = JSON.parse(process.env.GCS_CREDENTIALS_JSON);
            ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
            console.log('✅ Google TTS: Using GCS_CREDENTIALS_JSON');
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            ttsClient = new textToSpeech.TextToSpeechClient();
            console.log('✅ Google TTS: Using GOOGLE_APPLICATION_CREDENTIALS file');
        } else {
            console.error('❌ Google TTS: No credentials configured');
            return null;
        }
        return ttsClient;
    } catch (error) {
        console.error('❌ Google TTS client init error:', error.message);
        return null;
    }
};

// Available Google TTS voices (curated list of high-quality voices for radio)
const AVAILABLE_VOICES = [
    // Studio voices (highest quality, natural-sounding)
    { name: 'en-US-Studio-O', gender: 'FEMALE', description: 'Warm, friendly female (Studio quality)', languageCode: 'en-US' },
    { name: 'en-US-Studio-Q', gender: 'MALE', description: 'Warm, friendly male (Studio quality)', languageCode: 'en-US' },
    
    // Neural2 voices (very high quality)
    { name: 'en-US-Neural2-A', gender: 'MALE', description: 'Natural male voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-C', gender: 'FEMALE', description: 'Natural female voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-D', gender: 'MALE', description: 'Deep male voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-E', gender: 'FEMALE', description: 'Expressive female voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-F', gender: 'FEMALE', description: 'Warm female voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-G', gender: 'FEMALE', description: 'Bright female voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-H', gender: 'FEMALE', description: 'Casual female voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-I', gender: 'MALE', description: 'Casual male voice', languageCode: 'en-US' },
    { name: 'en-US-Neural2-J', gender: 'MALE', description: 'Professional male voice', languageCode: 'en-US' },
    
    // Polyglot voices (can speak multiple languages naturally)
    { name: 'en-US-Polyglot-1', gender: 'MALE', description: 'Multilingual male voice', languageCode: 'en-US' },
    
    // News voices (clear, broadcast-style)
    { name: 'en-US-News-K', gender: 'FEMALE', description: 'News anchor female', languageCode: 'en-US' },
    { name: 'en-US-News-L', gender: 'FEMALE', description: 'Reporter female', languageCode: 'en-US' },
    { name: 'en-US-News-N', gender: 'MALE', description: 'News anchor male', languageCode: 'en-US' },
    
    // Journey voices (storytelling)
    { name: 'en-US-Journey-D', gender: 'MALE', description: 'Storytelling male voice', languageCode: 'en-US' },
    { name: 'en-US-Journey-F', gender: 'FEMALE', description: 'Storytelling female voice', languageCode: 'en-US' },
    
    // Casual voices
    { name: 'en-US-Casual-K', gender: 'MALE', description: 'Casual conversational male', languageCode: 'en-US' },
];

// Helper to save audio buffer to GCS or local
const saveAudioFile = async (buffer, filename) => {
    const filePath = `radio/tts/${filename}`;

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
                reject(error);
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                resolve(publicUrl);
            });

            blobStream.end(buffer);
        });
    } else {
        // For local development, return a placeholder
        console.warn('⚠️ GCS not configured, audio not saved');
        return null;
    }
};

// GET /api/google-tts/voices - List available voices
router.get('/voices', (req, res) => {
    try {
        res.json({
            voices: AVAILABLE_VOICES,
            total: AVAILABLE_VOICES.length,
        });
    } catch (error) {
        console.error('Error fetching voices:', error);
        res.status(500).json({ message: 'Failed to fetch voices', error: error.message });
    }
});

// POST /api/google-tts/generate - Generate TTS audio
router.post('/generate', async (req, res) => {
    try {
        const { text, voiceName, languageCode, pitch, speakingRate } = req.body;

        if (!text || text.trim().length === 0) {
            return res.status(400).json({ message: 'Text is required' });
        }

        const client = getTTSClient();
        if (!client) {
            return res.status(500).json({ 
                message: 'Google TTS not configured',
                hint: 'Set GCS_CREDENTIALS_JSON environment variable with service account credentials'
            });
        }

        console.log(`🎙️ Generating TTS: "${text.substring(0, 50)}..." with voice ${voiceName || 'default'}`);

        // Prepare the request
        const request = {
            input: { text },
            voice: {
                languageCode: languageCode || 'en-US',
                name: voiceName || 'en-US-Neural2-D',
            },
            audioConfig: {
                audioEncoding: 'MP3',
                pitch: pitch || 0,
                speakingRate: speakingRate || 1.0,
                effectsProfileId: ['headphone-class-device'],
            },
        };

        const [response] = await client.synthesizeSpeech(request);

        if (!response.audioContent) {
            throw new Error('No audio content in response');
        }

        // audioContent is already a Buffer
        const audioBuffer = response.audioContent;

        // Generate unique filename
        const hash = crypto.createHash('md5').update(text + voiceName + Date.now()).digest('hex');
        const filename = `radio_${hash}.mp3`;

        // Save to GCS
        const audioUrl = await saveAudioFile(audioBuffer, filename);

        // Estimate duration (rough: ~150 words per minute for normal speech)
        const wordCount = text.split(/\s+/).length;
        const estimatedDuration = Math.ceil((wordCount / 150) * 60);

        console.log(`✅ TTS generated: ${audioUrl || 'local'}, estimated ${estimatedDuration}s`);

        res.json({
            audioUrl,
            audioBase64: audioUrl ? null : audioBuffer.toString('base64'),
            duration: estimatedDuration,
            text,
            voice: voiceName || 'en-US-Neural2-D',
        });

    } catch (error) {
        console.error('❌ Google TTS error:', error.message);
        res.status(500).json({ 
            message: 'Failed to generate TTS audio', 
            error: error.message 
        });
    }
});

// POST /api/google-tts/preview - Generate a quick preview (returns base64 directly)
router.post('/preview', async (req, res) => {
    try {
        const { text, voiceName, languageCode, pitch, speakingRate } = req.body;

        const previewText = text || 'Hello! Welcome to Praise Station Radio, where we lift up your spirit with uplifting music and encouraging words.';

        const client = getTTSClient();
        
        console.log('🎙️ TTS Preview request:', { 
            voiceName, 
            hasClient: !!client,
            textLength: previewText.length 
        });
        
        if (!client) {
            console.error('❌ Google TTS client not initialized');
            return res.status(500).json({ 
                message: 'Google TTS not configured',
                hint: 'Set GCS_CREDENTIALS_JSON environment variable with service account credentials'
            });
        }

        const request = {
            input: { text: previewText },
            voice: {
                languageCode: languageCode || 'en-US',
                name: voiceName || 'en-US-Neural2-D',
            },
            audioConfig: {
                audioEncoding: 'MP3',
                pitch: pitch || 0,
                speakingRate: speakingRate || 1.0,
            },
        };

        console.log('🎙️ Calling Google TTS with voice:', request.voice.name);

        const [response] = await client.synthesizeSpeech(request);

        if (!response.audioContent) {
            throw new Error('No audio content in response');
        }

        console.log('✅ TTS Preview generated successfully');

        // Return base64 audio directly for preview
        res.json({
            audioBase64: response.audioContent.toString('base64'),
            contentType: 'audio/mpeg',
        });

    } catch (error) {
        console.error('❌ Google TTS preview error:', error.message);
        
        let errorMessage = 'Failed to generate preview';
        let hint = 'Check that GCS_CREDENTIALS_JSON is set and the Text-to-Speech API is enabled';
        
        // Common error patterns
        if (error.message.includes('PERMISSION_DENIED')) {
            errorMessage = 'Text-to-Speech API not enabled in Google Cloud Console';
            hint = 'Go to Google Cloud Console → APIs & Services → Enable "Cloud Text-to-Speech API"';
        } else if (error.message.includes('INVALID_ARGUMENT')) {
            errorMessage = 'Invalid voice name or configuration';
            hint = 'Check that the voice name exists in the available voices list';
        }
        
        res.status(500).json({ 
            message: errorMessage, 
            error: error.message,
            hint
        });
    }
});

module.exports = router;

