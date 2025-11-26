const express = require('express');
const router = express.Router();
const multer = require('multer');
const { bucket } = require('../config/storage');

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
});

// Upload image endpoint
router.post('/image', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const blob = bucket.file(`images/${Date.now()}_${req.file.originalname}`);
        const blobStream = blob.createWriteStream({
            metadata: {
                contentType: req.file.mimetype,
            },
        });

        blobStream.on('error', (error) => {
            console.error('Upload error:', error);
            res.status(500).json({ message: 'Upload failed', error: error.message });
        });

        blobStream.on('finish', () => {
            // File is public via bucket-level access
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
            res.status(200).json({ url: publicUrl });
        });

        blobStream.end(req.file.buffer);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Upload video endpoint
router.post('/video', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const blob = bucket.file(`videos/${Date.now()}_${req.file.originalname}`);
        const blobStream = blob.createWriteStream({
            metadata: {
                contentType: req.file.mimetype,
            },
        });

        blobStream.on('error', (error) => {
            console.error('Upload error:', error);
            res.status(500).json({ message: 'Upload failed', error: error.message });
        });

        blobStream.on('finish', () => {
            // File is public via bucket-level access
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
            res.status(200).json({ url: publicUrl });
        });

        blobStream.end(req.file.buffer);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
