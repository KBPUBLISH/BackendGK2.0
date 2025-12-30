const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const RadioHost = require('../models/RadioHost');
const RadioStation = require('../models/RadioStation');
const RadioSegment = require('../models/RadioSegment');
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
        const hosts = await RadioHost.find({ 
            _id: { $in: hostIdsToUse }, 
            enabled: true 
        }).sort({ order: 1 });
        
        if (hosts.length === 0) {
            return res.status(400).json({ message: 'No active hosts available' });
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

module.exports = router;

