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
const saveFileLocally = (file, gcsPath, req = null) => {
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
                // Return absolute URL pointing to backend server
                let backendUrl;
                if (req) {
                    // Use request protocol and host
                    const protocol = req.protocol || 'http';
                    const host = req.get('host') || `localhost:${process.env.PORT || 5001}`;
                    backendUrl = `${protocol}://${host}`;
                } else {
                    // Fallback to environment variable or default
                    backendUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5001}`;
                }
                const url = `${backendUrl}/uploads/${gcsPath}`;
                resolve(url);
            }
        });
    });
};

// Helper function to generate organized file path
const generateFilePath = (bookId, type, filename, pageNumber = null) => {
    // Structure: books/{bookId}/{type}/filename
    // type can be: cover, pages, scroll, audio
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

        console.log('Upload request:', { 
            bookId, 
            type, 
            pageNumber, 
            filename: req.file.originalname,
            hasBucket: !!bucket,
            bucketName: process.env.GCS_BUCKET_NAME
        });

        let filePath;

        // Check if using organized structure
        if (bookId && type) {
            // Validate type
            if (!['cover', 'pages', 'scroll', 'audio'].includes(type)) {
                return res.status(400).json({ message: 'type must be one of: cover, pages, scroll, audio' });
            }

            // Generate organized file path
            filePath = generateFilePath(bookId, type, req.file.originalname, pageNumber);
            console.log('Using organized structure:', filePath);
        } else {
            // Fallback to simple structure for backward compatibility
            filePath = `images/${Date.now()}_${req.file.originalname}`;
            console.log('Using fallback structure (no bookId/type):', filePath);
        }

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            console.log('Uploading to GCS:', filePath);
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
                saveFileLocally(req.file, filePath, req)
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
            console.log('GCS not configured, using local storage. Bucket:', !!bucket, 'BucketName:', process.env.GCS_BUCKET_NAME);
            const url = await saveFileLocally(req.file, filePath, req);
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
                saveFileLocally(req.file, filePath, req)
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
            console.log('GCS not configured, using local storage. Bucket:', !!bucket, 'BucketName:', process.env.GCS_BUCKET_NAME);
            const url = await saveFileLocally(req.file, filePath, req);
            res.status(200).json({ url, path: filePath });
        }
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Upload audio endpoint with organized structure
// Query params: bookId (required), type=audio
router.post('/audio', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { bookId } = req.query;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required for audio uploads' });
        }

        // Validate audio file type (more lenient - check extension if mimetype fails)
        const isAudioMimeType = req.file.mimetype.startsWith('audio/');
        const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.webm'];
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        const isAudioExtension = audioExtensions.includes(fileExtension);
        
        if (!isAudioMimeType && !isAudioExtension) {
            return res.status(400).json({ 
                message: `File must be an audio file. Received: ${req.file.mimetype}, extension: ${fileExtension}` 
            });
        }

        // Generate organized file path: books/{bookId}/audio/filename
        const filePath = generateFilePath(bookId, 'audio', req.file.originalname);

        console.log('Uploading audio to:', filePath);

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            console.log('Uploading audio to GCS:', filePath);
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
                saveFileLocally(req.file, filePath, req)
                    .then(url => res.status(200).json({ url, path: filePath, filename: req.file.originalname }))
                    .catch(err => res.status(500).json({ message: 'Upload failed', error: err.message }));
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                res.status(200).json({ url: publicUrl, path: filePath, filename: req.file.originalname });
            });

            blobStream.end(req.file.buffer);
        } else {
            // Use local storage
            console.log('GCS not configured, using local storage for audio');
            const url = await saveFileLocally(req.file, filePath, req);
            res.status(200).json({ url, path: filePath, filename: req.file.originalname });
        }
    } catch (error) {
        console.error('Audio upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Upload sound effect endpoint with organized structure
// Query params: bookId (required), pageNumber (optional)
router.post('/sound-effect', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { bookId, pageNumber } = req.query;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required for sound effect uploads' });
        }

        // Validate audio file type
        const isAudioMimeType = req.file.mimetype.startsWith('audio/');
        const audioExtensions = ['.mp3', '.wav', '.m4a', '.aac', '.ogg'];
        const fileExtension = path.extname(req.file.originalname).toLowerCase();
        const isAudioExtension = audioExtensions.includes(fileExtension);
        
        if (!isAudioMimeType && !isAudioExtension) {
            return res.status(400).json({ 
                message: `File must be an audio file. Received: ${req.file.mimetype}, extension: ${fileExtension}` 
            });
        }

        // Validate file size (should be small for sound effects - max 5MB)
        const maxSize = 5 * 1024 * 1024; // 5MB
        if (req.file.size > maxSize) {
            return res.status(400).json({ 
                message: 'Sound effect file is too large. Maximum size is 5MB.' 
            });
        }

        // Generate organized file path: books/{bookId}/sound-effects/filename
        const filename = pageNumber 
            ? `page-${pageNumber}-${Date.now()}${fileExtension}`
            : `${Date.now()}-${req.file.originalname}`;
        const filePath = `books/${bookId}/sound-effects/${filename}`;

        console.log('Uploading sound effect to:', filePath);

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            console.log('Uploading sound effect to GCS:', filePath);
            const blob = bucket.file(filePath);
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: req.file.mimetype,
                },
            });

            blobStream.on('error', (error) => {
                console.error('GCS Upload error:', error);
                saveFileLocally(req.file, filePath, req)
                    .then(url => res.status(200).json({ url, path: filePath, filename }))
                    .catch(err => res.status(500).json({ message: 'Upload failed', error: err.message }));
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                res.status(200).json({ url: publicUrl, path: filePath, filename });
            });

            blobStream.end(req.file.buffer);
        } else {
            // Use local storage
            console.log('GCS not configured, using local storage for sound effect');
            const url = await saveFileLocally(req.file, filePath, req);
            res.status(200).json({ url, path: filePath, filename });
        }
    } catch (error) {
        console.error('Sound effect upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
