const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const RadioHost = require('../models/RadioHost');
const RadioStation = require('../models/RadioStation');
const RadioSegment = require('../models/RadioSegment');
const RadioLibrary = require('../models/RadioLibrary');
const Playlist = require('../models/Playlist');

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
        const { title, artist, audioUrl, coverImage, duration, category, rotation, sourcePlaylistId, sourceItemIndex, notes } = req.body;
        
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
            category: category || 'general',
            rotation: rotation || 'medium',
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
            targetDuration = 20, // Shorter default for on-demand
            // New: content-aware hosting
            contentType = 'song', // 'song', 'story_intro', 'story_outro', 'devotional'
            contentDescription = '', // Description for context
            contentCategory = 'general' // 'worship', 'story', 'devotional', 'kids', 'general'
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

        // Step 1: Generate script using AI
        const scriptResponse = await fetch(
            `${process.env.BACKEND_URL || 'http://localhost:' + (process.env.PORT || 3001)}/api/ai-generate/radio-script`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hostName: host.name,
                    hostPersonality: host.personality,
                    nextSongTitle,
                    nextSongArtist,
                    previousSongTitle,
                    previousSongArtist,
                    targetDuration,
                    contentType,
                    contentDescription,
                    contentCategory
                })
            }
        );

        if (!scriptResponse.ok) {
            throw new Error('Failed to generate script');
        }

        const scriptData = await scriptResponse.json();
        const script = scriptData.script;

        // Step 2: Generate TTS audio
        const ttsResponse = await fetch(
            `${process.env.BACKEND_URL || 'http://localhost:' + (process.env.PORT || 3001)}/api/google-tts/generate`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: script,
                    voiceName: host.googleVoice?.name || 'en-US-Chirp3-HD-Algieba',
                    languageCode: host.googleVoice?.languageCode || 'en-US',
                    pitch: host.googleVoice?.pitch || 0,
                    speakingRate: host.googleVoice?.speakingRate || 1.0
                })
            }
        );

        if (!ttsResponse.ok) {
            const errorData = await ttsResponse.json();
            throw new Error(errorData.message || 'Failed to generate TTS audio');
        }

        const ttsData = await ttsResponse.json();

        res.json({
            success: true,
            hostBreak: {
                hostId: host._id,
                hostName: host.name,
                hostAvatar: host.avatarUrl,
                script,
                audioUrl: ttsData.audioUrl,
                duration: ttsData.duration || targetDuration
            }
        });

    } catch (error) {
        console.error('Error generating host break:', error);
        res.status(500).json({ message: 'Failed to generate host break', error: error.message });
    }
});

module.exports = router;

