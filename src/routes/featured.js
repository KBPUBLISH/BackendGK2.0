const express = require('express');
const router = express.Router();
const FeaturedContent = require('../models/FeaturedContent');
const Book = require('../models/Book');
const Playlist = require('../models/Playlist');
const Lesson = require('../models/Lesson');

/**
 * GET /api/featured/new-user
 * Get featured content for new user welcome screen
 * Used by the app to display curated content to first-time users
 */
router.get('/new-user', async (req, res) => {
    try {
        const featured = await FeaturedContent.findOne({ 
            section: 'new_user_welcome',
            isActive: true 
        });

        if (!featured) {
            // Return default empty state if not configured
            return res.json({
                success: true,
                isConfigured: false,
                welcomeTitle: 'Welcome to Godly Kids!',
                welcomeSubtitle: 'Start exploring our wonderful content:',
                items: [],
                showSkipButton: true,
                skipButtonText: 'Explore the App',
            });
        }

        // Fetch full book details
        const bookIds = featured.featuredBooks.map(fb => fb.bookId);
        const books = await Book.find({ 
            _id: { $in: bookIds },
            status: 'published' 
        }).select('title coverImageUrl description ageRange categories isAudio');

        // Fetch full playlist details
        const playlistIds = featured.featuredPlaylists.map(fp => fp.playlistId);
        const playlists = await Playlist.find({ 
            _id: { $in: playlistIds },
            status: 'published' 
        }).select('title coverImageUrl description type');

        // Fetch full lesson details
        const lessonIds = featured.featuredLessons.map(fl => fl.lessonId);
        const lessons = await Lesson.find({ 
            _id: { $in: lessonIds },
            status: 'published' 
        }).select('title thumbnailUrl description');

        // Combine and format items with order
        const items = [];

        // Add books
        featured.featuredBooks.forEach(fb => {
            const book = books.find(b => b._id.toString() === fb.bookId.toString());
            if (book) {
                items.push({
                    id: book._id,
                    type: book.isAudio ? 'audiobook' : 'book',
                    title: fb.customTitle || book.title,
                    description: fb.customDescription || book.description,
                    imageUrl: book.coverImageUrl,
                    order: fb.order,
                    ageRange: book.ageRange,
                    categories: book.categories,
                });
            }
        });

        // Add playlists
        featured.featuredPlaylists.forEach(fp => {
            const playlist = playlists.find(p => p._id.toString() === fp.playlistId.toString());
            if (playlist) {
                items.push({
                    id: playlist._id,
                    type: 'playlist',
                    title: fp.customTitle || playlist.title,
                    description: fp.customDescription || playlist.description,
                    imageUrl: playlist.coverImageUrl,
                    order: fp.order,
                    playlistType: playlist.type,
                });
            }
        });

        // Add lessons
        featured.featuredLessons.forEach(fl => {
            const lesson = lessons.find(l => l._id.toString() === fl.lessonId.toString());
            if (lesson) {
                items.push({
                    id: lesson._id,
                    type: 'lesson',
                    title: fl.customTitle || lesson.title,
                    description: fl.customDescription || lesson.description,
                    imageUrl: lesson.thumbnailUrl,
                    order: fl.order,
                });
            }
        });

        // Sort by order and limit
        items.sort((a, b) => a.order - b.order);
        const limitedItems = items.slice(0, featured.maxItemsToShow);

        res.json({
            success: true,
            isConfigured: true,
            welcomeTitle: featured.welcomeTitle,
            welcomeSubtitle: featured.welcomeSubtitle,
            items: limitedItems,
            showSkipButton: featured.showSkipButton,
            skipButtonText: featured.skipButtonText,
        });
    } catch (error) {
        console.error('Error fetching featured content:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch featured content',
            error: error.message 
        });
    }
});

/**
 * GET /api/featured/config/:section
 * Get full configuration for a section (for portal editing)
 */
router.get('/config/:section', async (req, res) => {
    try {
        const { section } = req.params;
        
        let featured = await FeaturedContent.findOne({ section });

        if (!featured) {
            // Create default config if doesn't exist
            featured = new FeaturedContent({ section });
            await featured.save();
        }

        res.json({
            success: true,
            config: featured,
        });
    } catch (error) {
        console.error('Error fetching featured config:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch featured config',
            error: error.message 
        });
    }
});

/**
 * PUT /api/featured/config/:section
 * Update featured content configuration (from portal)
 */
router.put('/config/:section', async (req, res) => {
    try {
        const { section } = req.params;
        const {
            welcomeTitle,
            welcomeSubtitle,
            featuredBooks,
            featuredPlaylists,
            featuredLessons,
            isActive,
            showSkipButton,
            skipButtonText,
            maxItemsToShow,
            lastEditedBy,
        } = req.body;

        const updateData = {
            updatedAt: Date.now(),
        };

        // Only update fields that are provided
        if (welcomeTitle !== undefined) updateData.welcomeTitle = welcomeTitle;
        if (welcomeSubtitle !== undefined) updateData.welcomeSubtitle = welcomeSubtitle;
        if (featuredBooks !== undefined) updateData.featuredBooks = featuredBooks;
        if (featuredPlaylists !== undefined) updateData.featuredPlaylists = featuredPlaylists;
        if (featuredLessons !== undefined) updateData.featuredLessons = featuredLessons;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (showSkipButton !== undefined) updateData.showSkipButton = showSkipButton;
        if (skipButtonText !== undefined) updateData.skipButtonText = skipButtonText;
        if (maxItemsToShow !== undefined) updateData.maxItemsToShow = maxItemsToShow;
        if (lastEditedBy !== undefined) updateData.lastEditedBy = lastEditedBy;

        const featured = await FeaturedContent.findOneAndUpdate(
            { section },
            { $set: updateData },
            { new: true, upsert: true }
        );

        console.log(`✅ Featured content updated for section: ${section}`);

        res.json({
            success: true,
            message: 'Featured content updated',
            config: featured,
        });
    } catch (error) {
        console.error('Error updating featured config:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update featured config',
            error: error.message 
        });
    }
});

/**
 * GET /api/featured/available-content
 * Get all available books, playlists, lessons for selection in portal
 */
router.get('/available-content', async (req, res) => {
    try {
        // Get all published books
        const books = await Book.find({ status: 'published' })
            .select('title coverImageUrl isAudio categories')
            .sort({ title: 1 });

        // Get all published playlists
        const playlists = await Playlist.find({ status: 'published' })
            .select('title coverImageUrl type')
            .sort({ title: 1 });

        // Get all published lessons
        const lessons = await Lesson.find({ status: 'published' })
            .select('title thumbnailUrl')
            .sort({ title: 1 });

        res.json({
            success: true,
            books: books.map(b => ({
                id: b._id,
                title: b.title,
                imageUrl: b.coverImageUrl,
                type: b.isAudio ? 'audiobook' : 'book',
                categories: b.categories,
            })),
            playlists: playlists.map(p => ({
                id: p._id,
                title: p.title,
                imageUrl: p.coverImageUrl,
                type: p.type,
            })),
            lessons: lessons.map(l => ({
                id: l._id,
                title: l.title,
                imageUrl: l.thumbnailUrl,
            })),
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

