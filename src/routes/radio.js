const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fetch = require('node-fetch');
const crypto = require('crypto');
const RadioHost = require('../models/RadioHost');
const RadioStation = require('../models/RadioStation');
const RadioSegment = require('../models/RadioSegment');
const RadioLibrary = require('../models/RadioLibrary');
const Playlist = require('../models/Playlist');
const { bucket } = require('../config/storage');
const textToSpeech = require('@google-cloud/text-to-speech');

// Initialize TTS client (same pattern as googleTts.js)
let ttsClient = null;
const credentialsJson = process.env.GCS_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (credentialsJson) {
    try {
        const credentials = JSON.parse(credentialsJson);
        ttsClient = new textToSpeech.TextToSpeechClient({ credentials });
        console.log('📻 Radio: TTS client initialized');
    } catch (e) {
        console.error('📻 Radio: Failed to init TTS:', e.message);
    }
}

// Helper: Generate radio script using Gemini AI
const generateRadioScript = async (options) => {
    const {
        hostName,
        hostPersonality,
        nextSongTitle,
        nextSongArtist,
        previousSongTitle,
        previousSongArtist,
        targetDuration = 20,
        stationName = 'Praise Station Radio',
        contentType = 'song',
        contentDescription = '',
    } = options;

    const geminiKey = process.env.GEMINI_API_KEY;
    
    // Fallback script if no API key
    if (!geminiKey) {
        return getFallbackScript(hostName, nextSongTitle, nextSongArtist, contentType);
    }

    const targetWordCount = Math.round(targetDuration * 2.5);
    let taskDescription = '';
    let contextInfo = contentDescription ? `\nCONTENT DESCRIPTION: ${contentDescription}` : '';

    if (contentType === 'station_intro') {
        taskDescription = `YOUR TASK: Write an enthusiastic WELCOME introduction for the station.
1. Welcome listeners warmly to "${stationName}"!
2. Introduce yourself by name (e.g., "I'm ${hostName}")
3. Express excitement about the music and fun ahead
4. Mention what makes this station special (uplifting Christian music for families)
5. Share a quick blessing or encouragement
NOTE: Do NOT mention any specific song titles - this is a general welcome!`;
    } else if (contentType === 'story_intro') {
        taskDescription = `YOUR TASK: Write an exciting "story time" introduction.
1. Announce it's STORY TIME with enthusiasm!
2. Build anticipation for what's coming
3. ${contentDescription ? 'Tease what the story is about' : 'Invite listeners to get cozy'}
NOTE: Do NOT introduce yourself by name. Do NOT mention artist names.`;
    } else if (contentType === 'story_outro') {
        taskDescription = `YOUR TASK: Write a warm reflection after the story ended.
1. Say "I hope you enjoyed that story!"
2. Share a brief reflection or takeaway
3. Encourage listeners
NOTE: Do NOT introduce yourself by name.`;
    } else if (contentType === 'devotional' || contentType === 'devotional_segment') {
        taskDescription = `YOUR TASK: Write a meaningful devotional moment.
1. Create a peaceful, reflective atmosphere
2. Share an encouraging thought about faith or God's love
3. Invite listeners to reflect
NOTE: Do NOT introduce yourself by name. Keep it warm and genuine.`;
    } else {
        taskDescription = `YOUR TASK: Write a SHORT radio transition (just a few sentences).
1. Share a quick encouraging thought or blessing
2. Naturally lead into the next song
NOTE: Do NOT introduce yourself by name. Do NOT mention artist names. Do NOT reference specific time like "yesterday" or "this morning".`;
    }
    
    // IMPORTANT: Host name is for AI context, NOT to be used addressing listeners

    const prompt = `You are ${hostName || 'a friendly radio host'} on "${stationName}", a Christian family radio station.

PERSONALITY: ${hostPersonality || 'Warm, encouraging, and uplifting.'}
${contextInfo}

${taskDescription}

REQUIREMENTS:
- Target: ~${targetWordCount} words (${targetDuration} seconds)
- Natural, conversational language
- Family-friendly
- Warm and genuine
- Reference God, faith, blessings naturally
- Address listeners as "friends", "everyone", or "you"
- NEVER use temporal references like "yesterday", "this morning", "earlier today"
- NEVER mention artist names (just song titles if needed)
- Only introduce yourself by name if this is the STATION INTRO

EMOTIONAL CUES (use sparingly for expressiveness):
- Add [excited] before enthusiastic parts
- Add [warm] or [gentle] for tender moments
- Add [joyful] for happy announcements
- Add [reverent] for prayer or devotional moments
- Add [upbeat] for energetic transitions
Example: "[excited] Welcome to Praise Station Radio! [warm] We're so glad you're here with us today."

Respond with ONLY the script (including emotional cues where appropriate).`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.8, maxOutputTokens: 300 },
                }),
            }
        );

        if (!response.ok) {
            console.error('❌ Gemini error:', await response.text());
            return getFallbackScript(hostName, nextSongTitle, nextSongArtist, contentType);
        }

        const data = await response.json();
        const scriptText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!scriptText) {
            return getFallbackScript(hostName, nextSongTitle, nextSongArtist, contentType);
        }

        // Clean up script - keep [emotional cues] for Gemini TTS!
        return scriptText
            .replace(/\*[^*]+\*/g, '')  // Remove *actions*
            .replace(/\([^)]+\)/g, '')  // Remove (parentheticals)
            // Keep [brackets] - Gemini TTS uses them for emotional cues!
            .replace(/\s+/g, ' ')
            .trim();
    } catch (err) {
        console.error('❌ Script generation error:', err.message);
        return getFallbackScript(hostName, nextSongTitle, nextSongArtist, contentType);
    }
};

// Fallback scripts when AI is unavailable
const getFallbackScript = (hostName, songTitle, songArtist, contentType) => {
    const title = songTitle || 'this next song';

    if (contentType === 'station_intro') {
        return `[excited] Welcome to Praise Station Radio! I'm ${hostName}, and I'm so glad you're here with us! [warm] Get ready for uplifting music and encouragement for your whole family. We've got some wonderful songs lined up for you. Let's have some fun together!`;
    } else if (contentType === 'story_intro') {
        return `[excited] It's story time, friends! Get cozy and ready for a wonderful adventure. [warm] Let's listen together!`;
    } else if (contentType === 'story_outro') {
        return `[warm] I hope you enjoyed that story! What a wonderful reminder of God's love. [gentle] Let's keep the good vibes going!`;
    } else if (contentType === 'devotional' || contentType === 'devotional_segment') {
        return `[gentle] Let's take a moment to reflect and grow closer to God together. [reverent] Open your heart and listen.`;
    }
    return `[warm] What a blessing to be with you! [joyful] Here comes another great song to lift your spirit!`;
};

// Helper: Generate duo radio script (two hosts) using Gemini AI
const generateDuoRadioScript = async (options) => {
    const {
        host1Name,
        host1Personality,
        host2Name,
        host2Personality,
        nextSongTitle,
        nextSongArtist,
        previousSongTitle,
        previousSongArtist,
        targetDuration = 60,
        stationName = 'Praise Station Radio',
        contentType = 'song',
        contentDescription = '',
    } = options;

    const geminiKey = process.env.GEMINI_API_KEY;
    
    // Fallback if no API key
    if (!geminiKey) {
        return getDuoFallbackScript(host1Name, host2Name, nextSongTitle, nextSongArtist, contentType);
    }

    const targetWordCount = Math.round(targetDuration * 2.5);
    let taskDescription = '';
    let contextInfo = contentDescription ? `\nCONTENT DESCRIPTION: ${contentDescription}` : '';

    if (contentType === 'station_intro') {
        taskDescription = `YOUR TASK: Write a FUN, NATURAL conversation where BOTH hosts welcome listeners.
1. They greet each other AND the listeners warmly
2. BOTH hosts introduce themselves by name
3. They express excitement about the music and fun ahead
4. They have natural back-and-forth banter (friendly, playful)
5. They share what makes Praise Station special (uplifting Christian music for families)
6. End with excitement about what's coming up
NOTE: Do NOT mention any specific song titles - this is a general welcome!`;
    } else if (contentType === 'devotional_segment') {
        taskDescription = `YOUR TASK: Write a meaningful DEVOTIONAL DISCUSSION between the two hosts.
1. One host brings up a faith topic thoughtfully
2. They discuss it naturally with personal reflections
3. They encourage listeners with practical application
4. They share hope and God's love
${contentDescription ? 'THEME: ' + contentDescription : 'THEME: God\'s love, encouragement, or gratitude'}
NOTE: Do NOT introduce yourselves by name. Do NOT mention artist names.`;
    } else {
        taskDescription = `YOUR TASK: Write a SHORT, FUN conversation between the two hosts.
1. Quick, playful banter (2-3 exchanges)
2. Share a quick encouraging thought or observation
3. Natural, warm transition
NOTE: Do NOT introduce yourselves by name. Do NOT mention artist names. Do NOT use temporal references like "yesterday".`;
    }

    const prompt = `Write a radio dialogue between TWO hosts on "${stationName}", a Christian family radio station.

HOST 1: "${host1Name}"
- Personality: ${host1Personality || 'Warm and energetic'}

HOST 2: "${host2Name}"  
- Personality: ${host2Personality || 'Thoughtful and encouraging'}

${contextInfo}

${taskDescription}

FORMAT YOUR RESPONSE EXACTLY LIKE THIS (use the actual host names):
${host1Name}: [excited] Hey everyone! Welcome back to Praise Station!
${host2Name}: [warm] So glad to be here with you today...
${host1Name}: [joyful] That's right! We've got...

REQUIREMENTS:
- Target: ~${targetWordCount} words (${targetDuration} seconds)
- Natural conversation - not scripted-sounding
- Warm banter between hosts
- Family-friendly
- Reference God, faith, blessings naturally
- Each host speaks 2-4 times
- NEVER use temporal references like "yesterday", "this morning", "earlier"
- NEVER mention artist names
- Only introduce yourselves by name if this is the STATION INTRO

EMOTIONAL CUES (use sparingly):
- [excited], [warm], [gentle], [joyful], [reverent], [upbeat], [playful]

Respond with ONLY the dialogue script.`;

    try {
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.9, maxOutputTokens: 500 },
                }),
            }
        );

        if (!response.ok) {
            console.error('❌ Gemini duo script error:', await response.text());
            return getDuoFallbackScript(host1Name, host2Name, nextSongTitle, nextSongArtist, contentType);
        }

        const data = await response.json();
        const scriptText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!scriptText) {
            return getDuoFallbackScript(host1Name, host2Name, nextSongTitle, nextSongArtist, contentType);
        }

        return scriptText
            .replace(/\*[^*]+\*/g, '')  // Remove *actions*
            .replace(/\([^)]+\)/g, '')  // Remove (parentheticals)
            .replace(/\s+/g, ' ')
            .trim();
    } catch (err) {
        console.error('❌ Duo script generation error:', err.message);
        return getDuoFallbackScript(host1Name, host2Name, nextSongTitle, nextSongArtist, contentType);
    }
};

// Fallback duo scripts
const getDuoFallbackScript = (host1Name, host2Name, songTitle, songArtist, contentType) => {
    const h1 = host1Name || 'Host';
    const h2 = host2Name || 'Co-host';

    if (contentType === 'station_intro') {
        return `${h1}: [excited] Hey everyone! Welcome to Praise Station Radio! I'm ${h1}!
${h2}: [warm] And I'm ${h2}! We're so glad you're joining us!
${h1}: [joyful] That's right! We've got amazing music and fun lined up for you.
${h2}: [upbeat] Uplifting songs for the whole family!
${h1}: [excited] Let's get started!`;
    } else if (contentType === 'devotional_segment') {
        return `${h1}: [warm] You know, ${h2}, I've been thinking about God's faithfulness.
${h2}: [gentle] Oh, me too! It's amazing how He's always there for us.
${h1}: [reverent] Right? No matter what we face, His love never changes.
${h2}: [warm] Friends, take a moment to think about how God has been faithful in your life.
${h1}: [gentle] What a beautiful reminder of His love.`;
    }
    return `${h1}: [excited] That was great!
${h2}: [warm] So good! I love this music.
${h1}: [joyful] Here comes another one!`;
};

// Gemini TTS speakers (from Google's documentation)
const GEMINI_TTS_SPEAKERS = {
    male: ['Charon', 'Fenrir', 'Orus', 'Puck', 'Zephyr'],
    female: ['Kore', 'Aoede', 'Leda']
};

// Get access token for Vertex AI using service account
const getVertexAccessToken = async () => {
    const credentialsJson = process.env.GCS_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!credentialsJson) return null;
    
    try {
        const { GoogleAuth } = require('google-auth-library');
        const credentials = JSON.parse(credentialsJson);
        const auth = new GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        return token.token;
    } catch (err) {
        console.error('❌ Failed to get Vertex access token:', err.message);
        return null;
    }
};

// Helper: Generate TTS audio using Vertex AI Gemini TTS or Google Cloud TTS fallback
const generateTTSAudio = async (text, voiceConfig) => {
    const credentialsJson = process.env.GCS_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    
    // Try Vertex AI Gemini 2.5 Flash TTS first (supports emotional cues)
    if (credentialsJson) {
        try {
            console.log('🎙️ Trying Vertex AI Gemini 2.5 Flash TTS...');
            
            const credentials = JSON.parse(credentialsJson);
            const projectId = credentials.project_id;
            const clientEmail = credentials.client_email;
            console.log(`📍 Using project: ${projectId}, service account: ${clientEmail}`);
            
            const accessToken = await getVertexAccessToken();
            
            if (!accessToken) {
                throw new Error('Could not get access token');
            }
            
            // Map voice config to Gemini speaker based on gender
            // Gemini TTS voices: Kore (F), Charon (M), Fenrir (M), Aoede (F), Puck (M), Leda (F), Orus (M), Zephyr (M)
            let speaker = voiceConfig.geminiSpeaker;
            if (!speaker) {
                // Use gender from host config (passed via voiceConfig.gender)
                const isMale = voiceConfig.gender === 'male';
                
                // Pick a Gemini voice based on gender
                const maleVoices = ['Charon', 'Fenrir', 'Orus', 'Puck', 'Zephyr'];
                const femaleVoices = ['Kore', 'Aoede', 'Leda'];
                
                if (isMale) {
                    speaker = maleVoices[Math.floor(Math.random() * maleVoices.length)];
                } else {
                    speaker = femaleVoices[Math.floor(Math.random() * femaleVoices.length)];
                }
                console.log(`🎭 Selected Gemini voice: ${speaker} (${isMale ? 'male' : 'female'} host)`);
            }
            
            // Use Vertex AI endpoint with Gemini 2.5 Flash TTS
            const response = await fetch(
                `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash-preview-tts:generateContent`,
                {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        contents: [{
                            role: 'user',
                            parts: [{ text: text }]
                        }],
                        generationConfig: {
                            responseModalities: ['AUDIO'],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: {
                                        voiceName: speaker
                                    }
                                }
                            }
                        }
                    })
                }
            );

            if (response.ok) {
                const data = await response.json();
                const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                
                if (audioData) {
                    // audioData is base64 encoded
                    let audioBuffer = Buffer.from(audioData, 'base64');
                    
                    // Get mime type from response
                    const mimeType = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType || 'audio/wav';
                    console.log(`🎵 Vertex AI TTS audio format: ${mimeType}, size: ${audioBuffer.length} bytes`);
                    
                    // Determine file extension based on mime type
                    let extension = 'wav';
                    let contentType = 'audio/wav';
                    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) {
                        extension = 'mp3';
                        contentType = 'audio/mpeg';
                    } else if (mimeType.includes('ogg')) {
                        extension = 'ogg';
                        contentType = 'audio/ogg';
                    } else if (mimeType.includes('L16') || mimeType.includes('pcm')) {
                        // PCM L16 - convert to WAV by adding header
                        console.log('🔄 Converting PCM to WAV...');
                        
                        // Parse sample rate from mime type (e.g., "audio/L16;codec=pcm;rate=24000")
                        const rateMatch = mimeType.match(/rate=(\d+)/);
                        const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
                        const numChannels = 1; // Mono
                        const bitsPerSample = 16; // L16 = 16-bit
                        const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
                        const blockAlign = numChannels * (bitsPerSample / 8);
                        
                        // Create WAV header (44 bytes)
                        const wavHeader = Buffer.alloc(44);
                        wavHeader.write('RIFF', 0);
                        wavHeader.writeUInt32LE(36 + audioBuffer.length, 4); // File size - 8
                        wavHeader.write('WAVE', 8);
                        wavHeader.write('fmt ', 12);
                        wavHeader.writeUInt32LE(16, 16); // Subchunk1 size
                        wavHeader.writeUInt16LE(1, 20); // Audio format (PCM)
                        wavHeader.writeUInt16LE(numChannels, 22);
                        wavHeader.writeUInt32LE(sampleRate, 24);
                        wavHeader.writeUInt32LE(byteRate, 28);
                        wavHeader.writeUInt16LE(blockAlign, 32);
                        wavHeader.writeUInt16LE(bitsPerSample, 34);
                        wavHeader.write('data', 36);
                        wavHeader.writeUInt32LE(audioBuffer.length, 40);
                        
                        // Combine header + PCM data
                        audioBuffer = Buffer.concat([wavHeader, audioBuffer]);
                        extension = 'wav';
                        contentType = 'audio/wav';
                        console.log(`✅ Converted to WAV: ${audioBuffer.length} bytes, ${sampleRate}Hz`);
                    }
                    
                    // Save to GCS
                    const hash = crypto.createHash('md5').update(text + Date.now()).digest('hex');
                    const filename = `radio/tts/hostbreak_${hash}.${extension}`;
                    
                    if (bucket) {
                        const blob = bucket.file(filename);
                        await new Promise((resolve, reject) => {
                            const stream = blob.createWriteStream({ metadata: { contentType } });
                            stream.on('error', reject);
                            stream.on('finish', resolve);
                            stream.end(audioBuffer);
                        });
                        console.log(`✅ Vertex AI TTS audio saved to GCS (${extension})`);
                        return `https://storage.googleapis.com/${bucket.name}/${filename}`;
                    }
                }
            } else {
                const errorText = await response.text();
                console.log('⚠️ Vertex AI TTS error, falling back to Google Cloud TTS:', errorText);
            }
        } catch (err) {
            console.log('⚠️ Vertex AI TTS error, falling back:', err.message);
        }
    }
    
    // Fallback to Google Cloud TTS
    if (!ttsClient) {
        console.error('❌ No TTS client available');
        return null;
    }

    try {
        console.log('🎙️ Using Google Cloud TTS fallback...');
        
        // Strip emotional cues for Google Cloud TTS (it doesn't support them)
        const cleanText = text.replace(/\[[^\]]+\]/g, '').replace(/\s+/g, ' ').trim();
        
        const request = {
            input: { text: cleanText },
            voice: {
                languageCode: voiceConfig.languageCode || 'en-US',
                name: voiceConfig.name || 'en-US-Chirp3-HD-Enceladus',
            },
            audioConfig: {
                audioEncoding: 'MP3',
                pitch: voiceConfig.pitch || 0,
                speakingRate: voiceConfig.speakingRate || 1.0,
            },
        };

        const [response] = await ttsClient.synthesizeSpeech(request);
        
        if (!response.audioContent) {
            throw new Error('No audio content');
        }

        // Save to GCS
        const hash = crypto.createHash('md5').update(text + Date.now()).digest('hex');
        const filename = `radio/tts/hostbreak_${hash}.mp3`;
        
        if (bucket) {
            const blob = bucket.file(filename);
            await new Promise((resolve, reject) => {
                const stream = blob.createWriteStream({ metadata: { contentType: 'audio/mpeg' } });
                stream.on('error', reject);
                stream.on('finish', resolve);
                stream.end(response.audioContent);
            });
            return `https://storage.googleapis.com/${bucket.name}/${filename}`;
        }
        
        return null;
    } catch (err) {
        console.error('❌ TTS error:', err.message);
        return null;
    }
};

// Helper: Generate duo (multi-speaker) TTS audio using Vertex AI
const generateDuoTTSAudio = async (script, options) => {
    const { host1Gender, host2Gender, host1Name, host2Name } = options;
    const credentialsJson = process.env.GCS_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    
    if (!credentialsJson) {
        console.error('❌ No credentials for duo TTS');
        return null;
    }
    
    try {
        console.log('🎙️ Generating DUO TTS audio with Gemini...');
        
        const credentials = JSON.parse(credentialsJson);
        const projectId = credentials.project_id;
        const accessToken = await getVertexAccessToken();
        
        if (!accessToken) {
            throw new Error('Could not get access token');
        }
        
        // Select voices based on gender
        const speaker1 = host1Gender === 'female' 
            ? GEMINI_TTS_SPEAKERS.female[Math.floor(Math.random() * GEMINI_TTS_SPEAKERS.female.length)]
            : GEMINI_TTS_SPEAKERS.male[Math.floor(Math.random() * GEMINI_TTS_SPEAKERS.male.length)];
        const speaker2 = host2Gender === 'female'
            ? GEMINI_TTS_SPEAKERS.female[Math.floor(Math.random() * GEMINI_TTS_SPEAKERS.female.length)]
            : GEMINI_TTS_SPEAKERS.male[Math.floor(Math.random() * GEMINI_TTS_SPEAKERS.male.length)];
        
        // Make sure we pick different voices if both same gender
        let finalSpeaker2 = speaker2;
        if (speaker1 === speaker2) {
            const voiceList = host2Gender === 'female' ? GEMINI_TTS_SPEAKERS.female : GEMINI_TTS_SPEAKERS.male;
            finalSpeaker2 = voiceList.find(v => v !== speaker1) || speaker2;
        }
        
        console.log(`🎭 Duo voices: ${host1Name}=${speaker1}, ${host2Name}=${finalSpeaker2}`);
        
        // Parse the dialogue script and create multi-turn format
        // Format: "HostName: [emotion] text..." becomes turns with speaker assignment
        const lines = script.split('\n').filter(line => line.trim());
        const turns = [];
        
        for (const line of lines) {
            const match = line.match(/^([^:]+):\s*(.+)$/);
            if (match) {
                const speakerName = match[1].trim();
                const text = match[2].trim();
                
                // Determine which speaker this is
                const isHost1 = speakerName.toLowerCase().includes(host1Name.toLowerCase()) || 
                               speakerName.toLowerCase() === host1Name.toLowerCase().split(' ')[0];
                const speaker = isHost1 ? speaker1 : finalSpeaker2;
                
                turns.push({ speaker, text });
            }
        }
        
        if (turns.length === 0) {
            // If parsing failed, just use the whole script with first speaker
            console.log('⚠️ Could not parse duo script, using single speaker');
            return generateTTSAudio(script, { gender: host1Gender });
        }
        
        console.log(`📝 Parsed ${turns.length} dialogue turns`);
        
        // Combine all turns with speaker tags for Gemini
        // Using the multi-speaker format: "<speaker:Name>text"
        const combinedScript = turns.map(t => `<speaker:${t.speaker}>${t.text}`).join('\n');
        
        // Use Vertex AI endpoint with multi-speaker config
        const response = await fetch(
            `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.5-flash-preview-tts:generateContent`,
            {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
                },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: combinedScript }]
                    }],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            multiSpeakerVoiceConfig: {
                                speakerVoiceConfigs: [
                                    {
                                        speaker: speaker1,
                                        voiceConfig: {
                                            prebuiltVoiceConfig: { voiceName: speaker1 }
                                        }
                                    },
                                    {
                                        speaker: finalSpeaker2,
                                        voiceConfig: {
                                            prebuiltVoiceConfig: { voiceName: finalSpeaker2 }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                })
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            console.error('❌ Duo TTS Vertex error:', errText);
            // Fallback to single-speaker
            console.log('⚠️ Falling back to single-speaker TTS');
            return generateTTSAudio(script, { gender: host1Gender });
        }

        const data = await response.json();
        const audioData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        
        if (!audioData) {
            console.log('⚠️ No audio data in response, falling back');
            return generateTTSAudio(script, { gender: host1Gender });
        }
        
        let audioBuffer = Buffer.from(audioData, 'base64');
        const mimeType = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType || 'audio/wav';
        console.log(`🎵 Duo TTS audio format: ${mimeType}, size: ${audioBuffer.length} bytes`);
        
        // Handle PCM conversion if needed
        if (mimeType.includes('L16') || mimeType.includes('pcm')) {
            console.log('🔄 Converting duo PCM to WAV...');
            const rateMatch = mimeType.match(/rate=(\d+)/);
            const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
            const numChannels = 1;
            const bitsPerSample = 16;
            const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
            const blockAlign = numChannels * (bitsPerSample / 8);
            
            const wavHeader = Buffer.alloc(44);
            wavHeader.write('RIFF', 0);
            wavHeader.writeUInt32LE(36 + audioBuffer.length, 4);
            wavHeader.write('WAVE', 8);
            wavHeader.write('fmt ', 12);
            wavHeader.writeUInt32LE(16, 16);
            wavHeader.writeUInt16LE(1, 20);
            wavHeader.writeUInt16LE(numChannels, 22);
            wavHeader.writeUInt32LE(sampleRate, 24);
            wavHeader.writeUInt32LE(byteRate, 28);
            wavHeader.writeUInt16LE(blockAlign, 32);
            wavHeader.writeUInt16LE(bitsPerSample, 34);
            wavHeader.write('data', 36);
            wavHeader.writeUInt32LE(audioBuffer.length, 40);
            
            audioBuffer = Buffer.concat([wavHeader, audioBuffer]);
            console.log(`✅ Converted duo to WAV: ${audioBuffer.length} bytes`);
        }
        
        // Upload to GCS
        const { Storage } = require('@google-cloud/storage');
        const storage = new Storage({ credentials });
        const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'productiongk');
        const crypto = require('crypto');
        const hash = crypto.createHash('md5').update(script).digest('hex');
        const extension = mimeType.includes('mp3') ? 'mp3' : 'wav';
        const filename = `radio/tts/duo_hostbreak_${hash}.${extension}`;
        
        const blob = bucket.file(filename);
        await new Promise((resolve, reject) => {
            const stream = blob.createWriteStream({ 
                metadata: { contentType: extension === 'mp3' ? 'audio/mpeg' : 'audio/wav' } 
            });
            stream.on('error', reject);
            stream.on('finish', resolve);
            stream.end(audioBuffer);
        });
        
        const audioUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
        console.log(`✅ Duo TTS saved: ${audioUrl}`);
        return audioUrl;
        
    } catch (err) {
        console.error('❌ Duo TTS error:', err.message);
        // Fallback to single-speaker
        return generateTTSAudio(script, { gender: host1Gender });
    }
};

// ===========================
// STATION ROUTES
// ===========================

// GET /api/radio/station - Get the radio station config (creates default if none exists)
router.get('/station', async (req, res) => {
    try {
        let station = await RadioStation.findOne()
            .populate('hosts')
            .populate('playlists', 'title coverImage type items');
        
        // Create default station if none exists
        if (!station) {
            station = new RadioStation({
                name: 'Praise Station Radio',
                tagline: 'Uplifting music for the whole family',
            });
            await station.save();
        }
        
        res.json(station);
    } catch (error) {
        console.error('Error fetching station:', error);
        res.status(500).json({ message: 'Failed to fetch station', error: error.message });
    }
});

// PUT /api/radio/station - Update station config
router.put('/station', async (req, res) => {
    try {
        const { 
            name, tagline, hosts, playlists, 
            hostBreakDuration, hostBreakFrequency, 
            devotionalFrequency, devotionalDuration, enableDuoDiscussions,
            customIntroScript,
            settings, coverImageUrl, isLive 
        } = req.body;
        
        let station = await RadioStation.findOne();
        
        if (!station) {
            station = new RadioStation();
        }
        
        // Check if custom intro changed - clear cache if so
        const introChanged = customIntroScript !== undefined && 
            customIntroScript !== station.customIntroScript;
        
        // Update fields
        if (name !== undefined) station.name = name;
        if (tagline !== undefined) station.tagline = tagline;
        if (hosts !== undefined) station.hosts = hosts;
        if (playlists !== undefined) station.playlists = playlists;
        if (hostBreakDuration !== undefined) station.hostBreakDuration = hostBreakDuration;
        if (hostBreakFrequency !== undefined) station.hostBreakFrequency = hostBreakFrequency;
        if (devotionalFrequency !== undefined) station.devotionalFrequency = devotionalFrequency;
        if (devotionalDuration !== undefined) station.devotionalDuration = devotionalDuration;
        if (enableDuoDiscussions !== undefined) station.enableDuoDiscussions = enableDuoDiscussions;
        if (customIntroScript !== undefined) station.customIntroScript = customIntroScript;
        if (settings !== undefined) station.settings = { ...station.settings, ...settings };
        if (coverImageUrl !== undefined) station.coverImageUrl = coverImageUrl;
        if (isLive !== undefined) station.isLive = isLive;
        
        // Clear cached intro if the custom intro was changed
        if (introChanged) {
            station.cachedIntro = undefined;
            console.log('🔄 Custom intro changed, clearing cached intro');
        }
        
        await station.save();
        
        // Return populated station
        station = await RadioStation.findById(station._id)
            .populate('hosts')
            .populate('playlists', 'title coverImage type items');
        
        res.json(station);
    } catch (error) {
        console.error('Error updating station:', error);
        res.status(500).json({ message: 'Failed to update station', error: error.message });
    }
});

// ===========================
// HOST ROUTES
// ===========================

// GET /api/radio/hosts - List all hosts
router.get('/hosts', async (req, res) => {
    try {
        const hosts = await RadioHost.find().sort({ order: 1, createdAt: 1 });
        res.json(hosts);
    } catch (error) {
        console.error('Error fetching hosts:', error);
        res.status(500).json({ message: 'Failed to fetch hosts', error: error.message });
    }
});

// GET /api/radio/hosts/:id - Get single host
router.get('/hosts/:id', async (req, res) => {
    try {
        const host = await RadioHost.findById(req.params.id);
        if (!host) {
            return res.status(404).json({ message: 'Host not found' });
        }
        res.json(host);
    } catch (error) {
        console.error('Error fetching host:', error);
        res.status(500).json({ message: 'Failed to fetch host', error: error.message });
    }
});

// POST /api/radio/hosts - Create new host
router.post('/hosts', async (req, res) => {
    try {
        const { name, personality, googleVoice, samplePhrases, avatarUrl, enabled, order } = req.body;
        
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ message: 'Host name is required' });
        }
        
        const host = new RadioHost({
            name: name.trim(),
            personality: personality || undefined,
            googleVoice: googleVoice || undefined,
            samplePhrases: samplePhrases || [],
            avatarUrl: avatarUrl || undefined,
            enabled: enabled !== undefined ? enabled : true,
            order: order || 0,
        });
        
        await host.save();
        
        console.log(`📻 Created radio host: ${host.name}`);
        res.status(201).json(host);
    } catch (error) {
        console.error('Error creating host:', error);
        res.status(500).json({ message: 'Failed to create host', error: error.message });
    }
});

// PUT /api/radio/hosts/:id - Update host
router.put('/hosts/:id', async (req, res) => {
    try {
        const { name, personality, googleVoice, samplePhrases, avatarUrl, enabled, order } = req.body;
        
        const host = await RadioHost.findById(req.params.id);
        if (!host) {
            return res.status(404).json({ message: 'Host not found' });
        }
        
        if (name !== undefined) host.name = name.trim();
        if (personality !== undefined) host.personality = personality;
        if (googleVoice !== undefined) host.googleVoice = googleVoice;
        if (samplePhrases !== undefined) host.samplePhrases = samplePhrases;
        if (avatarUrl !== undefined) host.avatarUrl = avatarUrl;
        if (enabled !== undefined) host.enabled = enabled;
        if (order !== undefined) host.order = order;
        
        await host.save();
        
        console.log(`📻 Updated radio host: ${host.name}`);
        res.json(host);
    } catch (error) {
        console.error('Error updating host:', error);
        res.status(500).json({ message: 'Failed to update host', error: error.message });
    }
});

// DELETE /api/radio/hosts/:id - Delete host
router.delete('/hosts/:id', async (req, res) => {
    try {
        const host = await RadioHost.findById(req.params.id);
        if (!host) {
            return res.status(404).json({ message: 'Host not found' });
        }
        
        // Remove from station if assigned
        await RadioStation.updateMany(
            { hosts: host._id },
            { $pull: { hosts: host._id } }
        );
        
        await RadioHost.findByIdAndDelete(req.params.id);
        
        console.log(`📻 Deleted radio host: ${host.name}`);
        res.json({ message: 'Host deleted', id: req.params.id });
    } catch (error) {
        console.error('Error deleting host:', error);
        res.status(500).json({ message: 'Failed to delete host', error: error.message });
    }
});

// ===========================
// SEGMENT ROUTES
// ===========================

// GET /api/radio/segments - List segments for a station
router.get('/segments', async (req, res) => {
    try {
        const station = await RadioStation.findOne();
        if (!station) {
            return res.json([]);
        }
        
        const segments = await RadioSegment.find({ stationId: station._id })
            .populate('hostId', 'name avatarUrl')
            .sort({ order: 1 });
        
        res.json(segments);
    } catch (error) {
        console.error('Error fetching segments:', error);
        res.status(500).json({ message: 'Failed to fetch segments', error: error.message });
    }
});

// POST /api/radio/segments - Create a segment manually
router.post('/segments', async (req, res) => {
    try {
        const { type, order, hostId, scriptText, audioUrl, duration, playlistId, playlistItemIndex, songInfo, nextTrack, previousTrack } = req.body;
        
        const station = await RadioStation.findOne();
        if (!station) {
            return res.status(400).json({ message: 'No station configured' });
        }
        
        const segment = new RadioSegment({
            stationId: station._id,
            type,
            order,
            hostId: hostId || undefined,
            scriptText: scriptText || undefined,
            audioUrl: audioUrl || undefined,
            duration: duration || undefined,
            playlistId: playlistId || undefined,
            playlistItemIndex: playlistItemIndex !== undefined ? playlistItemIndex : undefined,
            songInfo: songInfo || undefined,
            nextTrack: nextTrack || undefined,
            previousTrack: previousTrack || undefined,
            status: audioUrl ? 'ready' : 'pending',
        });
        
        await segment.save();
        res.status(201).json(segment);
    } catch (error) {
        console.error('Error creating segment:', error);
        res.status(500).json({ message: 'Failed to create segment', error: error.message });
    }
});

// DELETE /api/radio/segments/:id - Delete a segment
router.delete('/segments/:id', async (req, res) => {
    try {
        await RadioSegment.findByIdAndDelete(req.params.id);
        res.json({ message: 'Segment deleted', id: req.params.id });
    } catch (error) {
        console.error('Error deleting segment:', error);
        res.status(500).json({ message: 'Failed to delete segment', error: error.message });
    }
});

// DELETE /api/radio/segments - Clear all segments
router.delete('/segments', async (req, res) => {
    try {
        const station = await RadioStation.findOne();
        if (station) {
            await RadioSegment.deleteMany({ stationId: station._id });
        }
        res.json({ message: 'All segments cleared' });
    } catch (error) {
        console.error('Error clearing segments:', error);
        res.status(500).json({ message: 'Failed to clear segments', error: error.message });
    }
});

// POST /api/radio/segments/generate - Generate segments from playlists
router.post('/segments/generate', async (req, res) => {
    try {
        const { playlistIds, hostIds, clearExisting } = req.body;
        
        const station = await RadioStation.findOne().populate('hosts');
        if (!station) {
            return res.status(400).json({ message: 'No station configured' });
        }
        
        // Get playlists to use
        const playlistIdsToUse = playlistIds || station.playlists.map(p => p.toString());
        if (playlistIdsToUse.length === 0) {
            return res.status(400).json({ message: 'No playlists selected' });
        }
        
        // Get hosts to use
        const hostIdsToUse = hostIds || station.hosts.map(h => h._id.toString());
        
        // First try to get enabled hosts
        let hosts = await RadioHost.find({ 
            _id: { $in: hostIdsToUse }, 
            enabled: true 
        }).sort({ order: 1 });
        
        // If no enabled hosts, try all hosts (maybe they're all disabled)
        if (hosts.length === 0) {
            hosts = await RadioHost.find({ 
                _id: { $in: hostIdsToUse }
            }).sort({ order: 1 });
            
            // Enable them automatically
            if (hosts.length > 0) {
                console.log('⚠️ No enabled hosts, enabling all hosts automatically');
                await RadioHost.updateMany(
                    { _id: { $in: hostIdsToUse } },
                    { $set: { enabled: true } }
                );
            }
        }
        
        if (hosts.length === 0) {
            return res.status(400).json({ 
                message: 'No hosts available. Please create at least one radio host first.',
                hint: 'Go to Radio > Hosts to create a host'
            });
        }
        
        // Clear existing segments if requested
        if (clearExisting) {
            await RadioSegment.deleteMany({ stationId: station._id });
        }
        
        // Fetch playlists with items
        const playlists = await Playlist.find({ 
            _id: { $in: playlistIdsToUse },
            status: 'published'
        });
        
        // Collect all songs from playlists
        const songs = [];
        for (const playlist of playlists) {
            if (playlist.items && playlist.items.length > 0) {
                for (let i = 0; i < playlist.items.length; i++) {
                    const item = playlist.items[i];
                    songs.push({
                        playlistId: playlist._id,
                        playlistItemIndex: i,
                        title: item.title,
                        artist: item.author || playlist.author || 'Unknown Artist',
                        coverImage: item.coverImage || playlist.coverImage,
                        audioUrl: item.audioUrl,
                        duration: item.duration || 180, // Default 3 min
                    });
                }
            }
        }
        
        if (songs.length === 0) {
            return res.status(400).json({ message: 'No songs found in selected playlists' });
        }
        
        // Shuffle if enabled
        if (station.settings?.shuffleSongs) {
            for (let i = songs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [songs[i], songs[j]] = [songs[j], songs[i]];
            }
        }
        
        // Generate segments with host breaks
        const segments = [];
        let order = 0;
        let hostIndex = 0;
        
        for (let i = 0; i < songs.length; i++) {
            const song = songs[i];
            const previousSong = i > 0 ? songs[i - 1] : null;
            const nextSong = songs[i]; // The current song is what the host will introduce
            
            // Add host break before each song (or based on frequency)
            if (i % station.hostBreakFrequency === 0) {
                const host = hosts[hostIndex % hosts.length];
                
                segments.push({
                    stationId: station._id,
                    type: 'host_break',
                    order: order++,
                    hostId: host._id,
                    nextTrack: { title: nextSong.title, artist: nextSong.artist },
                    previousTrack: previousSong ? { title: previousSong.title, artist: previousSong.artist } : null,
                    duration: station.hostBreakDuration,
                    status: 'pending', // Will need script generation
                });
                
                if (station.settings?.rotateHosts) {
                    hostIndex++;
                }
            }
            
            // Add song segment
            segments.push({
                stationId: station._id,
                type: 'song',
                order: order++,
                playlistId: song.playlistId,
                playlistItemIndex: song.playlistItemIndex,
                songInfo: {
                    title: song.title,
                    artist: song.artist,
                    coverImage: song.coverImage,
                    audioUrl: song.audioUrl,
                    duration: song.duration,
                },
                duration: song.duration,
                status: 'ready',
            });
        }
        
        // Bulk insert segments
        const createdSegments = await RadioSegment.insertMany(segments);
        
        console.log(`📻 Generated ${createdSegments.length} segments (${songs.length} songs, ${createdSegments.length - songs.length} host breaks)`);
        
        res.json({
            message: 'Segments generated successfully',
            totalSegments: createdSegments.length,
            songs: songs.length,
            hostBreaks: createdSegments.length - songs.length,
            segments: createdSegments,
        });
    } catch (error) {
        console.error('Error generating segments:', error);
        res.status(500).json({ message: 'Failed to generate segments', error: error.message });
    }
});

// PUT /api/radio/segments/:id - Update a segment (e.g., edit script)
router.put('/segments/:id', async (req, res) => {
    try {
        const { scriptText, audioUrl, status, order } = req.body;
        
        const segment = await RadioSegment.findById(req.params.id);
        if (!segment) {
            return res.status(404).json({ message: 'Segment not found' });
        }
        
        if (scriptText !== undefined) segment.scriptText = scriptText;
        if (audioUrl !== undefined) segment.audioUrl = audioUrl;
        if (status !== undefined) segment.status = status;
        if (order !== undefined) segment.order = order;
        
        await segment.save();
        res.json(segment);
    } catch (error) {
        console.error('Error updating segment:', error);
        res.status(500).json({ message: 'Failed to update segment', error: error.message });
    }
});

// POST /api/radio/segments/reorder - Reorder segments
router.post('/segments/reorder', async (req, res) => {
    try {
        const { segmentOrders } = req.body; // Array of { id, order }
        
        if (!Array.isArray(segmentOrders)) {
            return res.status(400).json({ message: 'segmentOrders array is required' });
        }
        
        const bulkOps = segmentOrders.map(({ id, order }) => ({
            updateOne: {
                filter: { _id: new mongoose.Types.ObjectId(id) },
                update: { $set: { order } },
            },
        }));
        
        await RadioSegment.bulkWrite(bulkOps);
        
        res.json({ message: 'Segments reordered successfully' });
    } catch (error) {
        console.error('Error reordering segments:', error);
        res.status(500).json({ message: 'Failed to reorder segments', error: error.message });
    }
});

// GET /api/radio/stats - Get radio statistics
router.get('/stats', async (req, res) => {
    try {
        const station = await RadioStation.findOne();
        const hostsCount = await RadioHost.countDocuments({ enabled: true });
        const segmentsCount = station ? await RadioSegment.countDocuments({ stationId: station._id }) : 0;
        const pendingSegments = station ? await RadioSegment.countDocuments({ stationId: station._id, status: 'pending' }) : 0;
        const readySegments = station ? await RadioSegment.countDocuments({ stationId: station._id, status: 'ready' }) : 0;
        
        res.json({
            stationName: station?.name || 'Not configured',
            isLive: station?.isLive || false,
            hostsCount,
            playlistsCount: station?.playlists?.length || 0,
            segmentsCount,
            pendingSegments,
            readySegments,
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ message: 'Failed to fetch stats', error: error.message });
    }
});

// ===========================
// RADIO LIBRARY ROUTES
// ===========================

// GET /api/radio/library - Get all tracks in the radio library
router.get('/library', async (req, res) => {
    try {
        const { category, rotation, enabled } = req.query;
        const filter = {};
        
        if (category) filter.category = category;
        if (rotation) filter.rotation = rotation;
        if (enabled !== undefined) filter.enabled = enabled === 'true';
        
        const tracks = await RadioLibrary.find(filter)
            .sort({ createdAt: -1 });
        
        res.json({
            tracks,
            total: tracks.length,
            enabledCount: tracks.filter(t => t.enabled).length
        });
    } catch (error) {
        console.error('Error fetching radio library:', error);
        res.status(500).json({ message: 'Failed to fetch library', error: error.message });
    }
});

// POST /api/radio/library - Add a track to the library
router.post('/library', async (req, res) => {
    try {
        const { title, artist, audioUrl, coverImage, duration, category, rotation, sourcePlaylistId, sourceItemIndex, notes, description, enabled } = req.body;
        
        if (!title || !audioUrl) {
            return res.status(400).json({ message: 'Title and audioUrl are required' });
        }
        
        // Check for duplicate (same audio URL)
        const existing = await RadioLibrary.findOne({ audioUrl });
        if (existing) {
            return res.status(400).json({ message: 'This track is already in the library' });
        }
        
        const track = new RadioLibrary({
            title,
            artist,
            audioUrl,
            coverImage,
            duration,
            description, // For context-aware radio hosting
            category: category || 'general',
            rotation: rotation || 'medium',
            enabled: enabled !== undefined ? enabled : true,
            sourcePlaylistId,
            sourceItemIndex,
            notes
        });
        
        await track.save();
        console.log(`📻 Added to radio library: ${title}`);
        
        res.status(201).json(track);
    } catch (error) {
        console.error('Error adding to library:', error);
        res.status(500).json({ message: 'Failed to add track', error: error.message });
    }
});

// POST /api/radio/library/bulk - Add multiple tracks from a playlist
router.post('/library/bulk', async (req, res) => {
    try {
        const { playlistId, category, rotation } = req.body;
        
        if (!playlistId) {
            return res.status(400).json({ message: 'playlistId is required' });
        }
        
        const playlist = await Playlist.findById(playlistId);
        if (!playlist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        if (!playlist.items || playlist.items.length === 0) {
            return res.status(400).json({ message: 'Playlist has no items' });
        }
        
        let added = 0;
        let skipped = 0;
        
        for (let i = 0; i < playlist.items.length; i++) {
            const item = playlist.items[i];
            if (!item.audioUrl) continue;
            
            // Check for duplicate
            const existing = await RadioLibrary.findOne({ audioUrl: item.audioUrl });
            if (existing) {
                skipped++;
                continue;
            }
            
            const track = new RadioLibrary({
                title: item.title,
                artist: item.author || playlist.author || 'Unknown Artist',
                audioUrl: item.audioUrl,
                coverImage: item.coverImage || playlist.coverImage,
                duration: item.duration,
                category: category || 'general',
                rotation: rotation || 'medium',
                sourcePlaylistId: playlist._id,
                sourceItemIndex: i
            });
            
            await track.save();
            added++;
        }
        
        console.log(`📻 Bulk added to radio library: ${added} tracks from "${playlist.title}"`);
        
        res.json({
            message: `Added ${added} tracks, skipped ${skipped} duplicates`,
            added,
            skipped
        });
    } catch (error) {
        console.error('Error bulk adding to library:', error);
        res.status(500).json({ message: 'Failed to add tracks', error: error.message });
    }
});

// PUT /api/radio/library/:id - Update a track
router.put('/library/:id', async (req, res) => {
    try {
        const track = await RadioLibrary.findById(req.params.id);
        if (!track) {
            return res.status(404).json({ message: 'Track not found' });
        }
        
        const { title, artist, category, rotation, enabled, notes } = req.body;
        
        if (title !== undefined) track.title = title;
        if (artist !== undefined) track.artist = artist;
        if (category !== undefined) track.category = category;
        if (rotation !== undefined) track.rotation = rotation;
        if (enabled !== undefined) track.enabled = enabled;
        if (notes !== undefined) track.notes = notes;
        
        await track.save();
        
        res.json(track);
    } catch (error) {
        console.error('Error updating track:', error);
        res.status(500).json({ message: 'Failed to update track', error: error.message });
    }
});

// DELETE /api/radio/library/:id - Remove a track from library
router.delete('/library/:id', async (req, res) => {
    try {
        const track = await RadioLibrary.findByIdAndDelete(req.params.id);
        if (!track) {
            return res.status(404).json({ message: 'Track not found' });
        }
        
        console.log(`📻 Removed from radio library: ${track.title}`);
        
        res.json({ message: 'Track removed', track });
    } catch (error) {
        console.error('Error removing track:', error);
        res.status(500).json({ message: 'Failed to remove track', error: error.message });
    }
});

// POST /api/radio/library/:id/toggle - Toggle track enabled/disabled
router.post('/library/:id/toggle', async (req, res) => {
    try {
        const track = await RadioLibrary.findById(req.params.id);
        if (!track) {
            return res.status(404).json({ message: 'Track not found' });
        }
        
        track.enabled = !track.enabled;
        await track.save();
        
        res.json(track);
    } catch (error) {
        console.error('Error toggling track:', error);
        res.status(500).json({ message: 'Failed to toggle track', error: error.message });
    }
});

// GET /api/radio/library/stats - Get library statistics
router.get('/library/stats', async (req, res) => {
    try {
        const totalTracks = await RadioLibrary.countDocuments();
        const enabledTracks = await RadioLibrary.countDocuments({ enabled: true });
        
        // Count by category
        const byCategory = await RadioLibrary.aggregate([
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);
        
        // Count by rotation
        const byRotation = await RadioLibrary.aggregate([
            { $group: { _id: '$rotation', count: { $sum: 1 } } }
        ]);
        
        // Calculate total duration
        const durationResult = await RadioLibrary.aggregate([
            { $match: { enabled: true } },
            { $group: { _id: null, totalDuration: { $sum: '$duration' } } }
        ]);
        
        const totalDuration = durationResult[0]?.totalDuration || 0;
        
        res.json({
            totalTracks,
            enabledTracks,
            disabledTracks: totalTracks - enabledTracks,
            byCategory: Object.fromEntries(byCategory.map(c => [c._id, c.count])),
            byRotation: Object.fromEntries(byRotation.map(r => [r._id, r.count])),
            totalDurationSeconds: totalDuration,
            totalDurationFormatted: `${Math.floor(totalDuration / 3600)}h ${Math.floor((totalDuration % 3600) / 60)}m`
        });
    } catch (error) {
        console.error('Error fetching library stats:', error);
        res.status(500).json({ message: 'Failed to fetch stats', error: error.message });
    }
});

// ===========================
// HOST BREAK GENERATION (On-Demand)
// ===========================

// POST /api/radio/host-break/generate - Generate a host break with script + TTS audio
router.post('/host-break/generate', async (req, res) => {
    try {
        const { 
            hostId,
            nextSongTitle, 
            nextSongArtist,
            previousSongTitle,
            previousSongArtist,
            targetDuration = 10,
            contentType = 'song',
            contentDescription = '',
            forceRegenerate = false,
            isDuo = false,
        } = req.body;

        if (!nextSongTitle) {
            return res.status(400).json({ message: 'nextSongTitle is required' });
        }

        // Get station config
        const station = await RadioStation.findOne({});
        
        // Check for cached station intro
        if (contentType === 'station_intro' && !forceRegenerate) {
            if (station?.cachedIntro?.audioUrl) {
                console.log(`📻 Using cached station intro`);
                return res.json({
                    success: true,
                    cached: true,
                    hostBreak: {
                        hostId: station.cachedIntro.hostId,
                        hostName: station.cachedIntro.hostName,
                        script: station.cachedIntro.script,
                        audioUrl: station.cachedIntro.audioUrl,
                        duration: 25,
                    }
                });
            }
        }

        // Get hosts for the break
        const allHosts = await RadioHost.find({ enabled: true });
        if (allHosts.length === 0) {
            return res.status(400).json({ message: 'No hosts available' });
        }

        // Station intro ALWAYS uses duo mode if two hosts available
        const useDuo = contentType === 'station_intro' 
            ? allHosts.length >= 2  // Force duo for intro
            : (isDuo && allHosts.length >= 2);  // Otherwise respect isDuo flag

        // For duo mode, get two hosts; for single, get one
        let host, secondHost;
        if (useDuo) {
            // Shuffle and pick two different hosts
            const shuffled = allHosts.sort(() => Math.random() - 0.5);
            host = shuffled[0];
            secondHost = shuffled[1];
            console.log(`📻 Generating DUO host break for "${nextSongTitle}" with ${host.name} & ${secondHost.name}`);
        } else {
            if (hostId) {
                host = await RadioHost.findById(hostId);
            } else {
                host = allHosts[Math.floor(Math.random() * allHosts.length)];
            }
            console.log(`📻 Generating host break for "${nextSongTitle}" with ${host.name}`);
        }
        
        // Check for custom intro script
        const hasCustomIntro = contentType === 'station_intro' && station?.customIntroScript?.trim();

        let script, audioUrl;

        if (hasCustomIntro) {
            // Use custom intro script
            script = station.customIntroScript.trim();
            console.log(`📝 Using custom intro script`);
            
            // Generate TTS for custom script (use duo if it looks like dialogue)
            const looksLikeDuo = script.includes(':') && (script.includes(host.name) || script.includes(secondHost?.name));
            
            if (looksLikeDuo && secondHost) {
                audioUrl = await generateDuoTTSAudio(script, {
                    host1Gender: host.gender || 'male',
                    host2Gender: secondHost.gender || 'female',
                    host1Name: host.name,
                    host2Name: secondHost.name,
                });
            } else {
                audioUrl = await generateTTSAudio(script, {
                    name: host.googleVoice?.name || 'en-US-Chirp3-HD-Enceladus',
                    languageCode: host.googleVoice?.languageCode || 'en-US',
                    pitch: host.googleVoice?.pitch || 0,
                    speakingRate: host.googleVoice?.speakingRate || 1.0,
                    gender: host.gender || 'male',
                });
            }
        } else if (useDuo && secondHost) {
            // Generate duo script with back-and-forth dialogue
            script = await generateDuoRadioScript({
                host1Name: host.name,
                host1Personality: host.personality,
                host2Name: secondHost.name,
                host2Personality: secondHost.personality,
                nextSongTitle,
                nextSongArtist,
                previousSongTitle,
                previousSongArtist,
                targetDuration,
                contentType,
                contentDescription,
            });
            
            if (!script) {
                throw new Error('Failed to generate duo script');
            }
            
            console.log(`📝 Duo Script: "${script.substring(0, 80)}..."`);

            // Generate multi-speaker TTS audio
            audioUrl = await generateDuoTTSAudio(script, {
                host1Gender: host.gender || 'male',
                host2Gender: secondHost.gender || 'female',
                host1Name: host.name,
                host2Name: secondHost.name,
            });
        } else {
            // Single host mode (original flow)
            script = await generateRadioScript({
                hostName: host.name,
                hostPersonality: host.personality,
                nextSongTitle,
                nextSongArtist,
                previousSongTitle,
                previousSongArtist,
                targetDuration,
                contentType,
                contentDescription,
            });
            
            if (!script) {
                throw new Error('Failed to generate script');
            }
            
            console.log(`📝 Script: "${script.substring(0, 60)}..."`);

            // Generate single-speaker TTS audio
            audioUrl = await generateTTSAudio(script, {
                name: host.googleVoice?.name || 'en-US-Chirp3-HD-Enceladus',
                languageCode: host.googleVoice?.languageCode || 'en-US',
                pitch: host.googleVoice?.pitch || 0,
                speakingRate: host.googleVoice?.speakingRate || 1.0,
                gender: host.gender || 'male',
            });
        }

        // Calculate estimated duration
        const wordCount = script.split(/\s+/).length;
        const estimatedDuration = Math.ceil((wordCount / 2.5));

        console.log(`✅ Host break generated: ${audioUrl ? 'with audio' : 'script only'}`);
        if (audioUrl) {
            console.log(`🔗 Audio URL: ${audioUrl}`);
        }

        // Cache station intro for future use
        if (contentType === 'station_intro' && audioUrl) {
            try {
                await RadioStation.findOneAndUpdate({}, {
                    cachedIntro: {
                        audioUrl,
                        script,
                        hostId: host._id,
                        hostName: host.name,
                        generatedAt: new Date(),
                    }
                });
                console.log(`💾 Cached station intro`);
            } catch (cacheErr) {
                console.error('Failed to cache intro:', cacheErr.message);
            }
        }

        res.json({
            success: true,
            hostBreak: {
                hostId: host._id,
                hostName: host.name,
                hostAvatar: host.avatarUrl,
                script,
                audioUrl,
                duration: estimatedDuration,
            }
        });

    } catch (error) {
        console.error('❌ Error generating host break:', error.message);
        res.status(500).json({ message: 'Failed to generate host break', error: error.message });
    }
});


module.exports = router;

