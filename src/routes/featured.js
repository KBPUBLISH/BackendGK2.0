const express = require('express');
const router = express.Router();
const FeaturedContent = require('../models/FeaturedContent');
const Book = require('../models/Book');
const Playlist = require('../models/Playlist');
const Lesson = require('../models/Lesson');
const mongoose = require('mongoose');

// Helper to fetch content details by type
const fetchContentDetails = async (item) => {
    let model;
    switch (item.contentType) {
        case 'book': model = Book; break;
        case 'playlist': model = Playlist; break;
        case 'lesson': model = Lesson; break;
        default: return null;
    }
    
    try {
        const content = await model.findById(item.contentId).lean();
        if (!content) return null;

        return {
            _id: content._id,
            type: item.contentType,
            title: item.title || content.title,
            subtitle: item.subtitle || content.subtitle || content.description,
            imageUrl: item.imageUrl || content.coverImageUrl || content.thumbnailUrl,
            order: item.order,
        };
    } catch (err) {
        console.error(`Error fetching ${item.contentType} ${item.contentId}:`, err.message);
        return null;
    }
};

/**
 * GET /api/featured/new-user
 * Get featured content for new user welcome screen
 * Used by the app to display curated content to first-time users
 */
router.get('/new-user', async (req, res) => {
    try {
        const config = await FeaturedContent.findOne({ section: 'new-user-welcome' }).lean();

        if (!config) {
            return res.json({
                success: true,
                config: {
                    section: 'new-user-welcome',
                    title: 'Welcome to Godly Kids!',
                    subtitle: 'Pick something to start your adventure.',
                    maxItems: 6,
                    skipButtonText: 'Skip for now',
                    showSkipButton: true,
                },
                items: []
            });
        }

        // Populate item details
        const populatedItems = [];
        for (const item of config.items || []) {
            const details = await fetchContentDetails(item);
            if (details) {
                populatedItems.push(details);
            }
        }

        // Sort by order
        populatedItems.sort((a, b) => a.order - b.order);

        res.json({
            success: true,
            config: {
                section: config.section,
                title: config.title,
                subtitle: config.subtitle,
                maxItems: config.maxItems,
                skipButtonText: config.skipButtonText,
                showSkipButton: config.showSkipButton,
            },
            items: populatedItems.slice(0, config.maxItems)
        });
    } catch (error) {
        console.error('Error fetching new user featured content:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch featured content' });
    }
});

/**
 * GET /api/featured/config/:section
 * Get configuration for a specific featured section (for portal editing)
 */
router.get('/config/:section', async (req, res) => {
    try {
        const { section } = req.params;
        let config = await FeaturedContent.findOne({ section }).lean();

        if (!config) {
            // Create a default config if it doesn't exist
            config = await FeaturedContent.create({ section });
            config = config.toObject();
        }

        // Populate item details for display in portal
        const populatedItems = [];
        for (const item of config.items || []) {
            const details = await fetchContentDetails(item);
            if (details) {
                populatedItems.push(details);
            }
        }
        populatedItems.sort((a, b) => a.order - b.order);

        res.json({ 
            success: true, 
            config: { 
                ...config, 
                items: populatedItems 
            } 
        });
    } catch (error) {
        console.error(`Error fetching featured config for ${req.params.section}:`, error);
        res.status(500).json({ success: false, message: 'Failed to fetch featured config' });
    }
});

/**
 * PUT /api/featured/config/:section
 * Update configuration for a specific featured section (from portal)
 */
router.put('/config/:section', async (req, res) => {
    try {
        const { section } = req.params;
        const { title, subtitle, items, maxItems, skipButtonText, showSkipButton } = req.body;

        // Transform items from portal format to storage format
        const transformedItems = (items || []).map((item, index) => ({
            contentId: new mongoose.Types.ObjectId(item._id),
            contentType: item.type,
            order: index,
            title: item.title,
            subtitle: item.subtitle,
            imageUrl: item.imageUrl,
        }));

        const updatedConfig = await FeaturedContent.findOneAndUpdate(
            { section },
            {
                title,
                subtitle,
                items: transformedItems,
                maxItems,
                skipButtonText,
                showSkipButton,
                updatedAt: new Date(),
            },
            { new: true, upsert: true, runValidators: true }
        ).lean();

        console.log(`✅ Featured content updated for section: ${section}`);

        res.json({ success: true, config: updatedConfig });
    } catch (error) {
        console.error(`Error updating featured config for ${req.params.section}:`, error);
        res.status(500).json({ success: false, message: 'Failed to update featured config' });
    }
});

/**
 * GET /api/featured/available-content
 * Get all available books, playlists, lessons for selection in portal
 * Returns combined content array for portal UI
 */
router.get('/available-content', async (req, res) => {
    try {
        // Get all published books
        const books = await Book.find({ status: 'published' })
            .select('title coverImageUrl isAudio categories')
            .sort({ title: 1 });

        // Get all published playlists
        const playlists = await Playlist.find({ status: 'published' })
            .select('title coverImageUrl thumbnailUrl type')
            .sort({ title: 1 });

        // Get all published lessons
        const lessons = await Lesson.find({ status: 'published' })
            .select('title thumbnailUrl')
            .sort({ title: 1 });

        // Combine into single content array for portal
        const content = [
            ...books.map(b => ({
                _id: b._id,
                title: b.title,
                imageUrl: b.coverImageUrl,
                type: 'book',
            })),
            ...playlists.map(p => ({
                _id: p._id,
                title: p.title,
                imageUrl: p.coverImageUrl || p.thumbnailUrl,
                type: 'playlist',
            })),
            ...lessons.map(l => ({
                _id: l._id,
                title: l.title,
                imageUrl: l.thumbnailUrl,
                type: 'lesson',
            })),
        ];

        console.log(`📚 Available content: ${books.length} books, ${playlists.length} playlists, ${lessons.length} lessons`);

        res.json({
            success: true,
            content,
        });
    } catch (error) {
        console.error('Error fetching available content:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch available content',
            error: error.message 
        });
    }
});

module.exports = router;
