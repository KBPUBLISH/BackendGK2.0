const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { bucket } = require('../config/storage');

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
});

// Helper function to save file locally with organized structure
const saveFileLocally = (file, gcsPath) => {
    return new Promise((resolve, reject) => {
        // Convert GCS path to local path
        const localPath = path.join(uploadsDir, gcsPath);
        const dir = path.dirname(localPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFile(localPath, file.buffer, (err) => {
            if (err) {
                reject(err);
            } else {
                // Return URL relative to backend server
                const url = `/uploads/${gcsPath}`;
                resolve(url);
            }
        });
    });
};

// Helper function to generate organized file path
const generateFilePath = (bookId, type, filename, pageNumber = null) => {
    // Structure: books/{bookId}/{type}/filename
    // type can be: cover, pages, scroll
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

    let finalFilename;
    if (type === 'pages' && pageNumber !== null) {
        // For pages, include page number: page-1.jpg, page-2.jpg, etc.
        const ext = path.extname(sanitizedFilename);
        finalFilename = `page-${pageNumber}${ext}`;
    } else {
        finalFilename = `${timestamp}_${sanitizedFilename}`;
    }

    return `books/${bookId}/${type}/${finalFilename}`;
};

// Upload image endpoint with organized structure
// Query params: bookId (optional), type (optional: cover|pages|scroll), pageNumber (optional, for pages)
// If bookId/type not provided, falls back to simple images/ folder
router.post('/image', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { bookId, type, pageNumber } = req.query;

        let filePath;

        // Check if using organized structure
        if (bookId && type) {
            // Validate type
            if (!['cover', 'pages', 'scroll'].includes(type)) {
                return res.status(400).json({ message: 'type must be one of: cover, pages, scroll' });
            }

            // Generate organized file path
            filePath = generateFilePath(bookId, type, req.file.originalname, pageNumber);
        } else {
            // Fallback to simple structure for backward compatibility
            filePath = `images/${Date.now()}_${req.file.originalname}`;
        }

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            // Use Google Cloud Storage
            const blob = bucket.file(filePath);
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: req.file.mimetype,
                },
            });

            blobStream.on('error', (error) => {
                console.error('GCS Upload error:', error);
                // Fallback to local storage on GCS error
                saveFileLocally(req.file, filePath)
                    .then(url => res.status(200).json({ url, path: filePath }))
                    .catch(err => res.status(500).json({ message: 'Upload failed', error: err.message }));
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                res.status(200).json({ url: publicUrl, path: filePath });
            });

            blobStream.end(req.file.buffer);
        } else {
            // Use local storage
            console.log('GCS not configured, using local storage');
            const url = await saveFileLocally(req.file, filePath);
            res.status(200).json({ url, path: filePath });
        }
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Upload video endpoint with organized structure
// Query params: bookId (optional), type (optional: pages|scroll), pageNumber (optional, for pages)
// If bookId/type not provided, falls back to simple videos/ folder
router.post('/video', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { bookId, type, pageNumber } = req.query;

        let filePath;

        // Check if using organized structure
        if (bookId && type) {
            // Validate type
            if (!['pages', 'scroll'].includes(type)) {
                return res.status(400).json({ message: 'type must be one of: pages, scroll' });
            }

            // Generate organized file path
            filePath = generateFilePath(bookId, type, req.file.originalname, pageNumber);
        } else {
            // Fallback to simple structure for backward compatibility
            filePath = `videos/${Date.now()}_${req.file.originalname}`;
        }

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            // Use Google Cloud Storage
            const blob = bucket.file(filePath);
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: req.file.mimetype,
                },
            });

            blobStream.on('error', (error) => {
                console.error('GCS Upload error:', error);
                // Fallback to local storage on GCS error
                saveFileLocally(req.file, filePath)
                    .then(url => res.status(200).json({ url, path: filePath }))
                    .catch(err => res.status(500).json({ message: 'Upload failed', error: err.message }));
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                res.status(200).json({ url: publicUrl, path: filePath });
            });

            blobStream.end(req.file.buffer);
        } else {
            // Use local storage
            console.log('GCS not configured, using local storage');
            const url = await saveFileLocally(req.file, filePath);
            res.status(200).json({ url, path: filePath });
        }
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
