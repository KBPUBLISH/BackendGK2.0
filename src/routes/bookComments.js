const express = require('express');
const router = express.Router();
const BookComment = require('../models/BookComment');
const Book = require('../models/Book');

// GET /api/book-comments/:bookId - Get all comments for a book
router.get('/:bookId', async (req, res) => {
    try {
        const { bookId } = req.params;
        const { limit = 50 } = req.query;
        
        const comments = await BookComment.find({ bookId })
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();
        
        res.json(comments);
    } catch (error) {
        console.error('Error fetching book comments:', error);
        res.status(500).json({ message: 'Failed to fetch comments', error: error.message });
    }
});

// POST /api/book-comments - Post a new comment
router.post('/', async (req, res) => {
    try {
        const { bookId, userId, userName, commentText, emoji, colorTheme } = req.body;
        
        if (!bookId || !userId || !commentText || !emoji) {
            return res.status(400).json({ message: 'bookId, userId, commentText, and emoji are required' });
        }
        
        const comment = new BookComment({
            bookId,
            userId,
            userName: userName || 'Anonymous',
            commentText,
            emoji,
            colorTheme: colorTheme || 'blue',
        });
        
        await comment.save();
        
        console.log(`💬 New comment on book ${bookId}: "${commentText}" by ${userName || 'Anonymous'}`);
        
        res.status(201).json(comment);
    } catch (error) {
        console.error('Error posting comment:', error);
        res.status(500).json({ message: 'Failed to post comment', error: error.message });
    }
});

// DELETE /api/book-comments/:id - Delete own comment
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { userId } = req.body;
        
        const comment = await BookComment.findById(id);
        
        if (!comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }
        
        // Only allow deletion by the comment owner
        if (comment.userId !== userId) {
            return res.status(403).json({ message: 'Not authorized to delete this comment' });
        }
        
        await BookComment.findByIdAndDelete(id);
        
        res.json({ message: 'Comment deleted successfully' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ message: 'Failed to delete comment', error: error.message });
    }
});

// GET /api/book-comments/:bookId/generated - Get AI-generated comment options for a book
router.get('/:bookId/generated', async (req, res) => {
    try {
        const { bookId } = req.params;
        
        const book = await Book.findById(bookId).lean();
        
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        
        // Return cached comments if available
        if (book.generatedComments && book.generatedComments.length > 0) {
            return res.json(book.generatedComments);
        }
        
        // Return null to signal frontend to generate comments
        res.json(null);
    } catch (error) {
        console.error('Error fetching generated comments:', error);
        res.status(500).json({ message: 'Failed to fetch generated comments', error: error.message });
    }
});

// PUT /api/book-comments/:bookId/generated - Cache AI-generated comments for a book
router.put('/:bookId/generated', async (req, res) => {
    try {
        const { bookId } = req.params;
        const { comments } = req.body;
        
        if (!comments || !Array.isArray(comments)) {
            return res.status(400).json({ message: 'comments array is required' });
        }
        
        await Book.findByIdAndUpdate(bookId, {
            generatedComments: comments,
        });
        
        console.log(`✨ Cached ${comments.length} AI-generated comments for book ${bookId}`);
        
        res.json({ message: 'Comments cached successfully', count: comments.length });
    } catch (error) {
        console.error('Error caching generated comments:', error);
        res.status(500).json({ message: 'Failed to cache comments', error: error.message });
    }
});

module.exports = router;

