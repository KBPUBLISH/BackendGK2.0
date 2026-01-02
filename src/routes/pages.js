const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Page = require('../models/Page');

// GET all pages for a book
router.get('/book/:bookId', async (req, res) => {
    try {
        const { bookId } = req.params;
        
        // Validate that bookId is a valid MongoDB ObjectId
        if (!mongoose.Types.ObjectId.isValid(bookId)) {
            console.log(`⚠️ Invalid bookId format: ${bookId} (expected MongoDB ObjectId)`);
            return res.json([]); // Return empty array for invalid IDs instead of error
        }
        
        // Populate webView.gameId to include game URL for web view pages
        const pages = await Page.find({ bookId })
            .populate('webView.gameId', 'url name coverImage gameType')
            .sort({ pageNumber: 1 });
        res.json(pages);
    } catch (error) {
        console.error('❌ Error fetching pages:', error.message);
        res.status(500).json({ message: error.message });
    }
});

// POST create page
router.post('/', async (req, res) => {
    const page = new Page({
        bookId: req.body.bookId,
        pageNumber: req.body.pageNumber,
        content: req.body.content,
        imageUrl: req.body.imageUrl,
        audioUrl: req.body.audioUrl,
        backgroundUrl: req.body.backgroundUrl,
        backgroundType: req.body.backgroundType,
        scrollUrl: req.body.scrollUrl,
        scrollHeight: req.body.scrollHeight,
        scrollMidHeight: req.body.scrollMidHeight,
        scrollMaxHeight: req.body.scrollMaxHeight,
        scrollOffsetY: req.body.scrollOffsetY || 0,
        scrollWidth: req.body.scrollWidth || 100,
        soundEffectUrl: req.body.soundEffectUrl,
        backgroundAudioUrl: req.body.backgroundAudioUrl, // Auto-extracted from video for iOS audio layering
        textBoxes: req.body.textBoxes,
        // Coloring page settings
        isColoringPage: req.body.isColoringPage || false,
        coloringEndModalOnly: req.body.coloringEndModalOnly !== false, // Default to true (end modal only)
        // Web View page settings
        isWebViewPage: req.body.isWebViewPage || false,
        webView: req.body.webView || {},
        // Video sequence settings
        videoSequence: req.body.videoSequence || [],
        useVideoSequence: req.body.useVideoSequence || false,
        // Image sequence settings
        imageSequence: req.body.imageSequence || [],
        useImageSequence: req.body.useImageSequence || false,
        imageSequenceDuration: req.body.imageSequenceDuration || 3,
        imageSequenceAnimation: req.body.imageSequenceAnimation || 'kenBurns',
    });

    try {
        const newPage = await page.save();
        res.status(201).json(newPage);
    } catch (error) {
        console.error('Error saving page:', error);
        res.status(400).json({ message: error.message });
    }
});

// PUT update page
router.put('/:id', async (req, res) => {
    try {
        const page = await Page.findById(req.params.id);
        if (!page) return res.status(404).json({ message: 'Page not found' });

        // If textBoxes is being updated at root level, also update content.textBoxes
        // and clear the old content.textBoxes to avoid stale data conflicts
        if (req.body.textBoxes) {
            // Update root level textBoxes
            page.textBoxes = req.body.textBoxes;
            // Also sync to content.textBoxes for consistency
            if (!page.content) page.content = {};
            page.content.textBoxes = req.body.textBoxes;
            // Remove textBoxes from req.body to avoid Object.assign overwriting
            delete req.body.textBoxes;
        }

        Object.assign(page, req.body);
        const updatedPage = await page.save();
        res.json(updatedPage);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE delete page
router.delete('/:id', async (req, res) => {
    try {
        const page = await Page.findById(req.params.id);
        if (!page) return res.status(404).json({ message: 'Page not found' });

        await page.deleteOne();
        res.json({ message: 'Page deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
