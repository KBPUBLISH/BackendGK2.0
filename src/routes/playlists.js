const express = require('express');
const router = express.Router();
const Playlist = require('../models/Playlist');
const { notifyNewPlaylist, notifyNewPlaylistItem } = require('../services/notificationService');

// GET all playlists (optionally filtered by status)
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;
        const query = status ? { status } : {};
        const playlists = await Playlist.find(query).sort({ createdAt: -1 });
        res.json(playlists);
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

module.exports = router;
