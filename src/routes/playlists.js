const express = require('express');
const router = express.Router();
const Playlist = require('../models/Playlist');
const { notifyNewPlaylist, notifyNewPlaylistItem } = require('../services/notificationService');

// GET all playlists (with pagination support)
router.get('/', async (req, res) => {
    try {
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
        const skip = (page - 1) * limit;
        
        // Filter parameters
        const filter = {};
        // Default to published playlists only, unless explicitly requesting all statuses
        // Portal can pass status=all to get everything, or status=draft for drafts only
        if (req.query.status === 'all') {
            // Don't filter by status - show all
        } else if (req.query.status) {
            filter.status = req.query.status;
        } else {
            // Default: only show published playlists in the main app
            filter.status = 'published';
        }
        if (req.query.categoryId) filter.categoryId = req.query.categoryId;
        if (req.query.type) filter.type = req.query.type;
        
        // Get total count for pagination metadata
        const total = await Playlist.countDocuments(filter);
        
        // Fetch playlists with pagination
        const playlists = await Playlist.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(); // Use lean() for better performance
        
        // Return with pagination metadata
        res.json({
            data: playlists,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                hasMore: page * limit < total
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET featured playlists for carousel
router.get('/featured', async (req, res) => {
    try {
        const playlists = await Playlist.find({ 
            isFeatured: true, 
            status: 'published' 
        }).sort({ featuredOrder: 1, createdAt: -1 });
        res.json(playlists);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET featured episodes (individual playlist items marked as featured)
router.get('/featured-episodes', async (req, res) => {
    try {
        // Find all playlists that have at least one featured item
        const playlists = await Playlist.find({ 
            status: 'published',
            'items.isFeatured': true 
        }).lean();
        
        // Extract featured episodes with their parent playlist info
        const featuredEpisodes = [];
        
        for (const playlist of playlists) {
            const featuredItems = (playlist.items || []).filter(item => item.isFeatured);
            
            for (const item of featuredItems) {
                featuredEpisodes.push({
                    _id: item._id,
                    title: item.title,
                    author: item.author || playlist.author,
                    description: item.description,
                    coverImage: item.coverImage || playlist.coverImage,
                    audioUrl: item.audioUrl,
                    duration: item.duration,
                    isMembersOnly: item.isMembersOnly || playlist.isMembersOnly,
                    featuredOrder: item.featuredOrder || 0,
                    playCount: item.playCount || 0,
                    // Parent playlist info
                    playlist: {
                        _id: playlist._id,
                        title: playlist.title,
                        type: playlist.type,
                        coverImage: playlist.coverImage,
                    },
                    // Index of this item in the playlist for direct playback
                    itemIndex: playlist.items.findIndex(i => i._id.toString() === item._id.toString()),
                });
            }
        }
        
        // Sort by featuredOrder
        featuredEpisodes.sort((a, b) => a.featuredOrder - b.featuredOrder);
        
        console.log(`🎵 Featured episodes: ${featuredEpisodes.length} items from ${playlists.length} playlists`);
        res.json(featuredEpisodes);
    } catch (error) {
        console.error('Error fetching featured episodes:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET trending episodes (top episodes by play count)
router.get('/trending-episodes', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        
        // Find all published playlists
        const playlists = await Playlist.find({ 
            status: 'published',
            'items.0': { $exists: true } // Has at least one item
        }).lean();
        
        // Extract all episodes with their play counts
        const allEpisodes = [];
        
        for (const playlist of playlists) {
            for (let i = 0; i < (playlist.items || []).length; i++) {
                const item = playlist.items[i];
                // Only include items with play counts > 0
                if (item.playCount && item.playCount > 0) {
                    allEpisodes.push({
                        _id: item._id,
                        title: item.title,
                        author: item.author || playlist.author,
                        description: item.description,
                        coverImage: item.coverImage || playlist.coverImage,
                        audioUrl: item.audioUrl,
                        duration: item.duration,
                        isMembersOnly: item.isMembersOnly || playlist.isMembersOnly,
                        playCount: item.playCount || 0,
                        // Parent playlist info
                        playlist: {
                            _id: playlist._id,
                            title: playlist.title,
                            type: playlist.type,
                            coverImage: playlist.coverImage,
                        },
                        // Index of this item in the playlist for direct playback
                        itemIndex: i,
                    });
                }
            }
        }
        
        // Sort by play count (highest first) and take top N
        allEpisodes.sort((a, b) => b.playCount - a.playCount);
        const trendingEpisodes = allEpisodes.slice(0, limit);
        
        console.log(`📈 Trending episodes: ${trendingEpisodes.length} items (top ${limit})`);
        res.json(trendingEpisodes);
    } catch (error) {
        console.error('Error fetching trending episodes:', error);
        res.status(500).json({ message: error.message });
    }
});

// PUT toggle featured status for a specific episode
router.put('/:playlistId/items/:itemId/featured', async (req, res) => {
    try {
        const { playlistId, itemId } = req.params;
        const { isFeatured, featuredOrder } = req.body;
        
        const playlist = await Playlist.findById(playlistId);
        if (!playlist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        const item = playlist.items.id(itemId);
        if (!item) {
            return res.status(404).json({ message: 'Item not found in playlist' });
        }
        
        item.isFeatured = isFeatured;
        if (featuredOrder !== undefined) {
            item.featuredOrder = featuredOrder;
        }
        
        await playlist.save();
        
        console.log(`⭐ Episode "${item.title}" featured status: ${isFeatured}`);
        res.json({ 
            success: true, 
            item: {
                _id: item._id,
                title: item.title,
                isFeatured: item.isFeatured,
                featuredOrder: item.featuredOrder,
            }
        });
    } catch (error) {
        console.error('Error updating episode featured status:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET top-rated playlists (15% or more likes/favorites to plays ratio)
router.get('/top-rated', async (req, res) => {
    try {
        const minRatio = parseFloat(req.query.minRatio) || 0.15; // Default 15%
        const minPlays = parseInt(req.query.minPlays) || 5; // Minimum plays to qualify
        
        const playlists = await Playlist.find({ 
            status: 'published',
            playCount: { $gte: minPlays } // At least minPlays to be considered
        });
        
        // Calculate rating ratio and filter
        const topRatedPlaylists = playlists
            .map(playlist => {
                const playlistObj = playlist.toObject();
                const totalEngagement = (playlistObj.likeCount || 0) + (playlistObj.favoriteCount || 0);
                const ratio = playlistObj.playCount > 0 ? totalEngagement / playlistObj.playCount : 0;
                playlistObj.ratingRatio = ratio;
                return playlistObj;
            })
            .filter(playlist => playlist.ratingRatio >= minRatio)
            .sort((a, b) => b.ratingRatio - a.ratingRatio); // Sort by highest ratio first
        
        res.json(topRatedPlaylists);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET single playlist
router.get('/:id', async (req, res) => {
    try {
        const playlist = await Playlist.findById(req.params.id);
        if (!playlist) return res.status(404).json({ message: 'Playlist not found' });
        res.json(playlist);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST create playlist
router.post('/', async (req, res) => {
    try {
        console.log('📝 POST /api/playlists - Request body:', JSON.stringify(req.body, null, 2));
        
        // Validate required fields
        if (!req.body.title) {
            return res.status(400).json({ message: 'Title is required' });
        }
        if (!req.body.type) {
            return res.status(400).json({ message: 'Type is required (Song or Audiobook)' });
        }
        
        // Process items to ensure coverImage is optional
        const processedItems = (req.body.items || []).map((item, index) => ({
            title: item.title || '',
            author: item.author || 'Kingdom Builders Publishing',
            audioUrl: item.audioUrl || '',
            order: item.order !== undefined ? item.order : index,
            duration: item.duration,
            coverImage: (item.coverImage && item.coverImage.trim() !== '') ? item.coverImage : null, // Convert empty strings to null
        }));
        
        console.log('📝 Processed items:', JSON.stringify(processedItems, null, 2));
        
        const playlist = new Playlist({
            title: req.body.title,
            author: req.body.author || 'Kingdom Builders Publishing',
            description: req.body.description || '',
            coverImage: (req.body.coverImage && req.body.coverImage.trim() !== '') ? req.body.coverImage : null, // Convert empty strings to null
            category: req.body.category || 'Music',
            categories: req.body.categories || [],
            type: req.body.type,
            items: processedItems,
            status: req.body.status || 'draft',
            minAge: req.body.minAge,
            level: req.body.level || '',
            isMembersOnly: req.body.isMembersOnly || false,
            isFeatured: req.body.isFeatured || false,
            featuredOrder: req.body.featuredOrder || 0,
        });
        
        console.log('📝 Creating playlist with categories:', req.body.categories);

        console.log('📝 About to save new playlist...');
        const newPlaylist = await playlist.save();
        console.log('✅ Playlist created successfully:', newPlaylist._id);
        
        // Send notification if playlist is published
        if (newPlaylist.status === 'published') {
            notifyNewPlaylist(newPlaylist).catch(err => console.error('Notification error:', err));
        }
        
        res.status(201).json(newPlaylist);
    } catch (error) {
        console.error('❌ Playlist creation error:', error);
        console.error('❌ Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        if (error.errors) {
            console.error('❌ Validation errors:', JSON.stringify(error.errors, null, 2));
        }
        res.status(400).json({ 
            message: error.message,
            error: error.name,
            details: error.errors || undefined
        });
    }
});

// PUT update playlist
router.put('/:id', async (req, res) => {
    try {
        console.log('📝 PUT /api/playlists/:id - Request body:', JSON.stringify(req.body, null, 2));
        const playlist = await Playlist.findById(req.params.id);
        if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

        // Update fields
        if (req.body.title !== undefined) playlist.title = req.body.title;
        if (req.body.author !== undefined) playlist.author = req.body.author;
        if (req.body.description !== undefined) playlist.description = req.body.description;
        if (req.body.coverImage !== undefined) playlist.coverImage = req.body.coverImage;
        if (req.body.category !== undefined) playlist.category = req.body.category;
        if (req.body.categories !== undefined) {
            playlist.categories = req.body.categories;
            playlist.markModified('categories');
            console.log('📝 Setting categories:', req.body.categories);
        }
        if (req.body.type !== undefined) playlist.type = req.body.type;
        if (req.body.status !== undefined) playlist.status = req.body.status;
        if (req.body.minAge !== undefined) playlist.minAge = req.body.minAge;
        if (req.body.level !== undefined) playlist.level = req.body.level;
        if (req.body.isMembersOnly !== undefined) playlist.isMembersOnly = req.body.isMembersOnly;
        if (req.body.isFeatured !== undefined) {
            playlist.isFeatured = req.body.isFeatured;
            console.log('⭐ Setting isFeatured:', req.body.isFeatured);
        }
        if (req.body.featuredOrder !== undefined) {
            playlist.featuredOrder = req.body.featuredOrder;
            console.log('📍 Setting featuredOrder:', req.body.featuredOrder);
        }
        if (req.body.items !== undefined) {
            // For items, ensure all required fields are present
            playlist.items = req.body.items.map((item, index) => {
                const mappedItem = {
                    title: item.title || '',
                    author: item.author || 'Kingdom Builders Publishing',
                    audioUrl: item.audioUrl || '',
                    order: item.order !== undefined ? item.order : index,
                    duration: item.duration,
                    coverImage: (item.coverImage && item.coverImage.trim() !== '') ? item.coverImage : null, // Convert empty strings to null
                    description: item.description || '',
                    isMembersOnly: item.isMembersOnly === true, // Preserve members-only flag per item
                };
                console.log(`📝 Item ${index}:`, JSON.stringify(mappedItem, null, 2));
                return mappedItem;
            });
            console.log('📝 Mapped items:', JSON.stringify(playlist.items, null, 2));
        }
        
        // Also handle playlist coverImage
        if (req.body.coverImage !== undefined) {
            playlist.coverImage = (req.body.coverImage && req.body.coverImage.trim() !== '') ? req.body.coverImage : null;
        }

        // Track if status is changing to published and if new items were added
        const wasPublished = playlist.status === 'published';
        const previousItemCount = playlist.items?.length || 0;
        
        console.log('📝 About to save playlist...');
        const updatedPlaylist = await playlist.save();
        console.log('✅ Playlist saved successfully');
        
        // Send notification if playlist was just published
        if (!wasPublished && updatedPlaylist.status === 'published') {
            notifyNewPlaylist(updatedPlaylist).catch(err => console.error('Notification error:', err));
        }
        // If already published and new items were added, notify about new items
        else if (wasPublished && updatedPlaylist.status === 'published') {
            const newItemCount = updatedPlaylist.items?.length || 0;
            if (newItemCount > previousItemCount) {
                // Get the newest item(s)
                const newItems = updatedPlaylist.items.slice(previousItemCount);
                for (const newItem of newItems) {
                    notifyNewPlaylistItem(updatedPlaylist, newItem).catch(err => 
                        console.error('Notification error:', err)
                    );
                }
            }
        }
        
        res.json(updatedPlaylist);
    } catch (error) {
        console.error('❌ Playlist update error:', error);
        console.error('❌ Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        if (error.errors) {
            console.error('❌ Validation errors:', JSON.stringify(error.errors, null, 2));
        }
        res.status(400).json({ 
            message: error.message,
            error: error.name,
            details: error.errors || undefined
        });
    }
});

// DELETE delete playlist
router.delete('/:id', async (req, res) => {
    try {
        const playlist = await Playlist.findById(req.params.id);
        if (!playlist) return res.status(404).json({ message: 'Playlist not found' });

        await playlist.deleteOne();
        res.json({ message: 'Playlist deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST increment playlist play count
router.post('/:id/play', async (req, res) => {
    try {
        const playlist = await Playlist.findByIdAndUpdate(
            req.params.id,
            { $inc: { playCount: 1 } },
            { new: true }
        );
        
        if (!playlist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        console.log(`🎵 Playlist "${playlist.title}" play count incremented to ${playlist.playCount}`);
        res.json({ playCount: playlist.playCount });
    } catch (error) {
        console.error('Error incrementing playlist play count:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST increment individual song/episode play count
router.post('/:playlistId/items/:itemId/play', async (req, res) => {
    try {
        const playlist = await Playlist.findById(req.params.playlistId);
        
        if (!playlist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        const item = playlist.items.id(req.params.itemId);
        if (!item) {
            return res.status(404).json({ message: 'Item not found in playlist' });
        }
        
        // Increment item play count
        item.playCount = (item.playCount || 0) + 1;
        
        // Also increment playlist total play count
        playlist.playCount = (playlist.playCount || 0) + 1;
        
        await playlist.save();
        
        console.log(`🎵 Song "${item.title}" play count: ${item.playCount}, Playlist total: ${playlist.playCount}`);
        res.json({ 
            itemPlayCount: item.playCount,
            playlistPlayCount: playlist.playCount 
        });
    } catch (error) {
        console.error('Error incrementing item play count:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
