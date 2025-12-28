const express = require('express');
const router = express.Router();
const PlaylistComment = require('../models/PlaylistComment');

// GET /api/playlist-comments/:playlistId - Fetch all comments for a playlist
router.get('/:playlistId', async (req, res) => {
    try {
        const { playlistId } = req.params;
        const comments = await PlaylistComment.find({ playlistId })
            .sort({ createdAt: -1 })
            .limit(100);
        res.json(comments);
    } catch (error) {
        console.error('Error fetching playlist comments:', error);
        res.status(500).json({ message: 'Failed to fetch comments', error: error.message });
    }
});

// POST /api/playlist-comments - Post a new comment
router.post('/', async (req, res) => {
    try {
        const { playlistId, userId, userName, commentText, emoji, colorTheme } = req.body;

        if (!playlistId || !userId || !commentText || !emoji) {
            return res.status(400).json({ message: 'playlistId, userId, commentText, and emoji are required' });
        }

        const comment = new PlaylistComment({
            playlistId,
            userId,
            userName: userName || 'Anonymous',
            commentText: commentText.substring(0, 100), // Ensure max length
            emoji,
            colorTheme: colorTheme || 'blue',
        });

        await comment.save();
        console.log(`💬 New playlist comment posted on playlist ${playlistId}`);
        res.status(201).json(comment);
    } catch (error) {
        console.error('Error posting playlist comment:', error);
        res.status(500).json({ message: 'Failed to post comment', error: error.message });
    }
});

// DELETE /api/playlist-comments/:commentId - Delete own comment
router.delete('/:commentId', async (req, res) => {
    try {
        const { commentId } = req.params;
        const { userId } = req.body;

        const comment = await PlaylistComment.findById(commentId);
        if (!comment) {
            return res.status(404).json({ message: 'Comment not found' });
        }

        // Only allow owner to delete
        if (comment.userId !== userId) {
            return res.status(403).json({ message: 'Not authorized to delete this comment' });
        }

        await PlaylistComment.findByIdAndDelete(commentId);
        res.json({ message: 'Comment deleted successfully' });
    } catch (error) {
        console.error('Error deleting playlist comment:', error);
        res.status(500).json({ message: 'Failed to delete comment', error: error.message });
    }
});

module.exports = router;

