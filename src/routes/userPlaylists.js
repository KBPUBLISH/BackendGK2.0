const express = require('express');
const router = express.Router();
const UserPlaylist = require('../models/UserPlaylist');
const Playlist = require('../models/Playlist');

// GET /api/user-playlists - Get all playlists for a user
router.get('/', async (req, res) => {
    try {
        const { userId } = req.query;
        
        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }
        
        const playlists = await UserPlaylist.find({ userId })
            .sort({ updatedAt: -1 });
        
        res.json(playlists);
    } catch (error) {
        console.error('Get user playlists error:', error);
        res.status(500).json({ message: 'Failed to fetch playlists', error: error.message });
    }
});

// GET /api/user-playlists/:id - Get a specific playlist
router.get('/:id', async (req, res) => {
    try {
        const playlist = await UserPlaylist.findById(req.params.id);
        
        if (!playlist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        res.json(playlist);
    } catch (error) {
        console.error('Get playlist error:', error);
        res.status(500).json({ message: 'Failed to fetch playlist', error: error.message });
    }
});

// POST /api/user-playlists - Create a new playlist
router.post('/', async (req, res) => {
    try {
        const { userId, name, description, coverImage } = req.body;
        
        if (!userId || !name) {
            return res.status(400).json({ message: 'userId and name are required' });
        }
        
        // Check if user already has a playlist with this name
        const existing = await UserPlaylist.findOne({ userId, name });
        if (existing) {
            return res.status(400).json({ message: 'You already have a playlist with this name' });
        }
        
        const playlist = new UserPlaylist({
            userId,
            name: name.trim(),
            description: description?.trim(),
            coverImage,
            items: [],
        });
        
        await playlist.save();
        
        console.log(`📋 New playlist created: "${name}" for user ${userId}`);
        res.status(201).json(playlist);
    } catch (error) {
        console.error('Create playlist error:', error);
        res.status(500).json({ message: 'Failed to create playlist', error: error.message });
    }
});

// PUT /api/user-playlists/:id - Update playlist details
router.put('/:id', async (req, res) => {
    try {
        const { name, description, coverImage, aiGenerated } = req.body;
        
        const playlist = await UserPlaylist.findById(req.params.id);
        if (!playlist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        if (name) playlist.name = name.trim();
        if (description !== undefined) playlist.description = description?.trim() || '';
        if (coverImage !== undefined) playlist.coverImage = coverImage;
        if (aiGenerated) playlist.aiGenerated = aiGenerated;
        
        await playlist.save();
        
        res.json(playlist);
    } catch (error) {
        console.error('Update playlist error:', error);
        res.status(500).json({ message: 'Failed to update playlist', error: error.message });
    }
});

// DELETE /api/user-playlists/:id - Delete a playlist
router.delete('/:id', async (req, res) => {
    try {
        const playlist = await UserPlaylist.findByIdAndDelete(req.params.id);
        
        if (!playlist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        console.log(`🗑️ Playlist deleted: "${playlist.name}"`);
        res.json({ success: true, message: 'Playlist deleted' });
    } catch (error) {
        console.error('Delete playlist error:', error);
        res.status(500).json({ message: 'Failed to delete playlist', error: error.message });
    }
});

// POST /api/user-playlists/:id/items - Add item to playlist
router.post('/:id/items', async (req, res) => {
    try {
        const { playlistId, itemId } = req.body;
        
        if (!playlistId || !itemId) {
            return res.status(400).json({ message: 'playlistId and itemId are required' });
        }
        
        const userPlaylist = await UserPlaylist.findById(req.params.id);
        if (!userPlaylist) {
            return res.status(404).json({ message: 'User playlist not found' });
        }
        
        // Check if item already exists in playlist
        const alreadyExists = userPlaylist.items.some(
            item => item.itemId.toString() === itemId
        );
        if (alreadyExists) {
            return res.status(400).json({ message: 'Item already in playlist' });
        }
        
        // Find the source playlist and item
        const sourcePlaylist = await Playlist.findById(playlistId);
        if (!sourcePlaylist) {
            return res.status(404).json({ message: 'Source playlist not found' });
        }
        
        const sourceItem = sourcePlaylist.items.id(itemId);
        if (!sourceItem) {
            return res.status(404).json({ message: 'Item not found in source playlist' });
        }
        
        // Add the item with cached data
        const newItem = {
            playlistId: sourcePlaylist._id,
            itemId: sourceItem._id,
            title: sourceItem.title,
            author: sourceItem.author || sourcePlaylist.author,
            coverImage: sourceItem.coverImage || sourcePlaylist.coverImage,
            audioUrl: sourceItem.audioUrl,
            duration: sourceItem.duration,
            type: sourcePlaylist.type,
            order: userPlaylist.items.length,
        };
        
        userPlaylist.items.push(newItem);
        
        // If this is the first item and no cover, use the item's cover
        if (!userPlaylist.coverImage && newItem.coverImage) {
            userPlaylist.coverImage = newItem.coverImage;
        }
        
        await userPlaylist.save();
        
        console.log(`➕ Added "${sourceItem.title}" to playlist "${userPlaylist.name}"`);
        res.json(userPlaylist);
    } catch (error) {
        console.error('Add item to playlist error:', error);
        res.status(500).json({ message: 'Failed to add item', error: error.message });
    }
});

// DELETE /api/user-playlists/:id/items/:itemId - Remove item from playlist
router.delete('/:id/items/:itemId', async (req, res) => {
    try {
        const userPlaylist = await UserPlaylist.findById(req.params.id);
        if (!userPlaylist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        const itemIndex = userPlaylist.items.findIndex(
            item => item._id.toString() === req.params.itemId
        );
        
        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Item not found in playlist' });
        }
        
        const removedItem = userPlaylist.items[itemIndex];
        userPlaylist.items.splice(itemIndex, 1);
        
        // Reorder remaining items
        userPlaylist.items.forEach((item, idx) => {
            item.order = idx;
        });
        
        await userPlaylist.save();
        
        console.log(`➖ Removed "${removedItem.title}" from playlist "${userPlaylist.name}"`);
        res.json(userPlaylist);
    } catch (error) {
        console.error('Remove item from playlist error:', error);
        res.status(500).json({ message: 'Failed to remove item', error: error.message });
    }
});

// PUT /api/user-playlists/:id/reorder - Reorder items in playlist
router.put('/:id/reorder', async (req, res) => {
    try {
        const { itemIds } = req.body; // Array of item IDs in new order
        
        if (!itemIds || !Array.isArray(itemIds)) {
            return res.status(400).json({ message: 'itemIds array is required' });
        }
        
        const userPlaylist = await UserPlaylist.findById(req.params.id);
        if (!userPlaylist) {
            return res.status(404).json({ message: 'Playlist not found' });
        }
        
        // Reorder items based on provided order
        const reorderedItems = itemIds.map((id, index) => {
            const item = userPlaylist.items.find(i => i._id.toString() === id);
            if (item) {
                item.order = index;
            }
            return item;
        }).filter(Boolean);
        
        userPlaylist.items = reorderedItems;
        await userPlaylist.save();
        
        res.json(userPlaylist);
    } catch (error) {
        console.error('Reorder playlist error:', error);
        res.status(500).json({ message: 'Failed to reorder items', error: error.message });
    }
});

module.exports = router;

