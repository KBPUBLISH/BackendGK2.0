const express = require('express');
const router = express.Router();
const Page = require('../models/Page');

// GET all pages for a book
router.get('/book/:bookId', async (req, res) => {
    try {
        const pages = await Page.find({ bookId: req.params.bookId }).sort({ pageNumber: 1 });
        res.json(pages);
    } catch (error) {
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
    });

    try {
        const newPage = await page.save();
        res.status(201).json(newPage);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT update page
router.put('/:id', async (req, res) => {
    try {
        const page = await Page.findById(req.params.id);
        if (!page) return res.status(404).json({ message: 'Page not found' });

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
