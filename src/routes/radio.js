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
        taskDescription = `YOUR TASK: Write an enthusiastic WELCOME introduction. This plays when a listener first tunes in.
1. Welcome listeners warmly to "${stationName}"!
2. You may introduce yourself by name (e.g., "I'm ${hostName}")
3. Express excitement about the music ahead
4. Mention what makes this station special (uplifting Christian music for families)
5. Share a quick blessing
6. Introduce the first song: "${nextSongTitle}"${nextSongArtist ? ` by ${nextSongArtist}` : ''}`;
    } else if (contentType === 'story_intro') {
        taskDescription = `YOUR TASK: Write an exciting "story time" introduction.
1. ${previousSongTitle ? `Briefly wrap up "${previousSongTitle}"` : 'Build excitement for story time'}
2. Announce it's STORY TIME with enthusiasm!
3. Introduce the story "${nextSongTitle}"${nextSongArtist ? ` by ${nextSongArtist}` : ''}
4. ${contentDescription ? 'Tease what the story is about' : 'Build anticipation'}
5. Invite listeners to get cozy`;
    } else if (contentType === 'story_outro') {
        taskDescription = `YOUR TASK: Write a warm reflection after the story ended.
1. Say "I hope you enjoyed that story!"
2. Reference "${nextSongTitle}"
3. Share a brief reflection on the story's message
4. Relate to faith or daily life
5. Transition to what's next`;
    } else if (contentType === 'devotional') {
        taskDescription = `YOUR TASK: Write a reverent devotional introduction.
1. Create a peaceful atmosphere
2. Introduce the devotional "${nextSongTitle}"${nextSongArtist ? ` by ${nextSongArtist}` : ''}
3. Encourage listeners to open their hearts`;
    } else {
        taskDescription = `YOUR TASK: Write a short radio host segment.
1. ${previousSongTitle ? `Briefly reflect on "${previousSongTitle}"` : 'Start with a warm greeting'}
2. Share a brief encouraging message
3. Introduce "${nextSongTitle}"${nextSongArtist ? ` by ${nextSongArtist}` : ''}`;
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
- Address listeners as "friends", "everyone", or "you" - NEVER use your own name to address them
- You may introduce yourself by name ONCE at the start if it's a station intro

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
// Note: hostName is the DJ's name, NOT used to address listeners
const getFallbackScript = (hostName, songTitle, songArtist, contentType) => {
    const title = songTitle || 'this next song';
    const artist = songArtist ? ` by ${songArtist}` : '';

    if (contentType === 'station_intro') {
        return `Welcome to Praise Station Radio! I'm so glad you're here with us today. Get ready for uplifting music and encouragement for your whole family. Coming up first, here's "${title}"${artist}. Enjoy!`;
    } else if (contentType === 'story_intro') {
        return `It's story time, friends! Get cozy and ready for a wonderful adventure. Coming up, we have "${title}"${artist}. Let's listen together!`;
    } else if (contentType === 'story_outro') {
        return `I hope you enjoyed that story! "${title}" reminds us of God's amazing love. What a blessing! Let's continue with more great content.`;
    } else if (contentType === 'devotional') {
        return `Let's take a moment to reflect and grow closer to God together. Up next is "${title}"${artist}. Open your heart and listen.`;
    }
    return `What a blessing to be with you today! Up next we have "${title}"${artist}. May it lift your spirit!`;
};

// Gemini TTS speakers (from Google's documentation)
const GEMINI_TTS_SPEAKERS = [
    'Kore', 'Charon', 'Fenrir', 'Aoede', 'Puck', 'Leda', 'Orus', 'Zephyr'
];

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
    
    // Try Vertex AI Gemini TTS first (supports emotional cues)
    if (credentialsJson) {
        try {
            console.log('🎙️ Trying Vertex AI Gemini TTS...');
            
            const credentials = JSON.parse(credentialsJson);
            const projectId = credentials.project_id;
            const accessToken = await getVertexAccessToken();
            
            if (!accessToken) {
                throw new Error('Could not get access token');
            }
            
            // Map voice config to Gemini speaker or use default
            const speaker = voiceConfig.geminiSpeaker || 'Kore';
            
            // Use Vertex AI endpoint
            const response = await fetch(
                `https://us-central1-aiplatform.googleapis.com/v1/projects/${projectId}/locations/us-central1/publishers/google/models/gemini-2.0-flash-exp:generateContent`,
                {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${accessToken}`
                    },
                    body: JSON.stringify({
                        contents: [{
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
                    const audioBuffer = Buffer.from(audioData, 'base64');
                    
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
                        // PCM needs to be converted - skip for now and fall back
                        console.log('⚠️ PCM audio format not supported, falling back to Google Cloud TTS');
                        throw new Error('PCM format not supported');
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
        const { name, tagline, hosts, playlists, hostBreakDuration, hostBreakFrequency, settings, coverImageUrl, isLive } = req.body;
        
        let station = await RadioStation.findOne();
        
        if (!station) {
            station = new RadioStation();
        }
        
        // Update fields
        if (name !== undefined) station.name = name;
        if (tagline !== undefined) station.tagline = tagline;
        if (hosts !== undefined) station.hosts = hosts;
        if (playlists !== undefined) station.playlists = playlists;
        if (hostBreakDuration !== undefined) station.hostBreakDuration = hostBreakDuration;
        if (hostBreakFrequency !== undefined) station.hostBreakFrequency = hostBreakFrequency;
        if (settings !== undefined) station.settings = { ...station.settings, ...settings };
        if (coverImageUrl !== undefined) station.coverImageUrl = coverImageUrl;
        if (isLive !== undefined) station.isLive = isLive;
        
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
            targetDuration = 20,
            contentType = 'song',
            contentDescription = '',
        } = req.body;

        if (!nextSongTitle) {
            return res.status(400).json({ message: 'nextSongTitle is required' });
        }

        // Get a random host if not specified
        let host;
        if (hostId) {
            host = await RadioHost.findById(hostId);
        } else {
            const hosts = await RadioHost.find({ enabled: true });
            if (hosts.length > 0) {
                host = hosts[Math.floor(Math.random() * hosts.length)];
            }
        }

        if (!host) {
            return res.status(400).json({ message: 'No hosts available' });
        }

        console.log(`📻 Generating host break for "${nextSongTitle}" with ${host.name}`);

        // Step 1: Generate script using direct function call (no HTTP)
        const script = await generateRadioScript({
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

        // Step 2: Generate TTS audio using direct function call (no HTTP)
        const audioUrl = await generateTTSAudio(script, {
            name: host.googleVoice?.name || 'en-US-Chirp3-HD-Enceladus',
            languageCode: host.googleVoice?.languageCode || 'en-US',
            pitch: host.googleVoice?.pitch || 0,
            speakingRate: host.googleVoice?.speakingRate || 1.0,
        });

        // Calculate estimated duration
        const wordCount = script.split(/\s+/).length;
        const estimatedDuration = Math.ceil((wordCount / 2.5));

        console.log(`✅ Host break generated: ${audioUrl ? 'with audio' : 'script only'}`);
        if (audioUrl) {
            console.log(`🔗 Audio URL: ${audioUrl}`);
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

