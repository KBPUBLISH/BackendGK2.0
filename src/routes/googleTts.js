require('dotenv').config();
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { bucket } = require('../config/storage');
const textToSpeech = require('@google-cloud/text-to-speech');

// Initialize Google Cloud TTS client at module load time (same pattern as storage.js)
let ttsClient = null;

// Try multiple methods to load credentials (matching storage.js pattern)
const credentialsJson = process.env.GCS_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (credentialsJson) {
    try {
        const credentials = JSON.parse(credentialsJson);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
        console.log('✅ Google TTS: Loaded credentials from GCS_CREDENTIALS_JSON');
    } catch (e) {
        console.error('❌ Google TTS: Failed to parse credentials JSON:', e.message);
    }
} else if (credentialsPath) {
    try {
        ttsClient = new textToSpeech.TextToSpeechClient();
        console.log('✅ Google TTS: Using GOOGLE_APPLICATION_CREDENTIALS file');
    } catch (e) {
        console.error('❌ Google TTS: Failed to load from credentials file:', e.message);
    }
} else {
    console.error('❌ Google TTS: No credentials configured (need GCS_CREDENTIALS_JSON or GOOGLE_APPLICATION_CREDENTIALS)');
}

const getTTSClient = () => {
    return ttsClient;
};

// Available Google TTS voices (curated list of high-quality voices for radio)
const AVAILABLE_VOICES = [
    // ========== CHIRP 3 HD VOICES (Newest, Highest Quality) ==========
    // Female Chirp 3 HD voices
    { name: 'en-US-Chirp3-HD-Vindemiatrix', gender: 'FEMALE', description: 'Clear, friendly young adult female - Standard American', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Laomedeia', gender: 'FEMALE', description: 'Warm, nurturing mature female - Great for storytelling', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Achernar', gender: 'FEMALE', description: 'Bright, energetic young adult female', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Gacrux', gender: 'FEMALE', description: 'Professional, confident female voice', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Pulcherrima', gender: 'FEMALE', description: 'Soft, gentle female - Perfect for calming content', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Chara', gender: 'FEMALE', description: 'Cheerful, upbeat young female', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Zosma', gender: 'FEMALE', description: 'Clear, articulate female - Great for instructions', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Auva', gender: 'FEMALE', description: 'Warm, motherly female voice', languageCode: 'en-US', tier: 'chirp3-hd' },
    
    // Male Chirp 3 HD voices  
    { name: 'en-US-Chirp3-HD-Algieba', gender: 'MALE', description: 'Mature adult male - Professional, authoritative', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Zubenelgenubi', gender: 'MALE', description: 'Clear, friendly young adult male - Tech-focused', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Sadachbia', gender: 'MALE', description: 'Energetic mature male - Fast paced, confident', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Iapetus', gender: 'MALE', description: 'Friendly conversational male - Versatile', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Enceladus', gender: 'MALE', description: 'Warm, friendly mature male - Great for assistants', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Algenib', gender: 'MALE', description: 'Confident, professional male - Fast paced', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Schedar', gender: 'MALE', description: 'Deep, warm male voice - Storytelling', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Rasalhague', gender: 'MALE', description: 'Clear, engaging male - Educational content', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Alnilam', gender: 'MALE', description: 'Calm, soothing male voice', languageCode: 'en-US', tier: 'chirp3-hd' },
    { name: 'en-US-Chirp3-HD-Kochab', gender: 'MALE', description: 'Friendly, approachable male', languageCode: 'en-US', tier: 'chirp3-hd' },
    
    // ========== STUDIO VOICES (High Quality) ==========
    { name: 'en-US-Studio-O', gender: 'FEMALE', description: 'Warm, friendly female (Studio quality)', languageCode: 'en-US', tier: 'studio' },
    { name: 'en-US-Studio-Q', gender: 'MALE', description: 'Warm, friendly male (Studio quality)', languageCode: 'en-US', tier: 'studio' },
    
    // ========== JOURNEY VOICES (Storytelling) ==========
    { name: 'en-US-Journey-D', gender: 'MALE', description: 'Storytelling male voice', languageCode: 'en-US', tier: 'journey' },
    { name: 'en-US-Journey-F', gender: 'FEMALE', description: 'Storytelling female voice', languageCode: 'en-US', tier: 'journey' },
    { name: 'en-US-Journey-O', gender: 'FEMALE', description: 'Expressive storytelling female', languageCode: 'en-US', tier: 'journey' },
    
    // ========== NEWS VOICES (Broadcast Style) ==========
    { name: 'en-US-News-K', gender: 'FEMALE', description: 'News anchor female', languageCode: 'en-US', tier: 'news' },
    { name: 'en-US-News-L', gender: 'FEMALE', description: 'Reporter female', languageCode: 'en-US', tier: 'news' },
    { name: 'en-US-News-N', gender: 'MALE', description: 'News anchor male', languageCode: 'en-US', tier: 'news' },
    
    // ========== NEURAL2 VOICES (Very High Quality) ==========
    { name: 'en-US-Neural2-A', gender: 'MALE', description: 'Natural male voice', languageCode: 'en-US', tier: 'neural2' },
    { name: 'en-US-Neural2-C', gender: 'FEMALE', description: 'Natural female voice', languageCode: 'en-US', tier: 'neural2' },
    { name: 'en-US-Neural2-D', gender: 'MALE', description: 'Deep male voice', languageCode: 'en-US', tier: 'neural2' },
    { name: 'en-US-Neural2-F', gender: 'FEMALE', description: 'Warm female voice', languageCode: 'en-US', tier: 'neural2' },
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

        const selectedVoice = voiceName || 'en-US-Chirp3-HD-Enceladus';
        console.log(`🎙️ Generating TTS: "${text.substring(0, 50)}..." with voice ${selectedVoice}`);

        // Prepare the request
        const request = {
            input: { text },
            voice: {
                languageCode: languageCode || 'en-US',
                name: selectedVoice,
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
            voice: selectedVoice,
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

        const selectedVoice = voiceName || 'en-US-Chirp3-HD-Enceladus';
        
        const request = {
            input: { text: previewText },
            voice: {
                languageCode: languageCode || 'en-US',
                name: selectedVoice,
            },
            audioConfig: {
                audioEncoding: 'MP3',
                pitch: pitch || 0,
                speakingRate: speakingRate || 1.0,
            },
        };

        console.log('🎙️ Calling Google TTS with Chirp 3 HD voice:', selectedVoice);

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

