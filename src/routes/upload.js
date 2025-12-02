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
        fileSize: 500 * 1024 * 1024, // 500MB limit (increased for videos)
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
    // Special case: if bookId is "games", use games/{type}/filename
    // Special case: if bookId is "lessons", use lessons/{lessonId}/{type}/filename
    // type can be: cover, pages, scroll, audio, game-cover, video, thumbnail
    const timestamp = Date.now();
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');

    let finalFilename;
    if (type === 'pages' && pageNumber !== null) {
        // For pages, include page number AND timestamp for cache busting: page-1-1234567890.mp4
        const ext = path.extname(sanitizedFilename);
        finalFilename = `page-${pageNumber}-${timestamp}${ext}`;
    } else {
        finalFilename = `${timestamp}_${sanitizedFilename}`;
    }

    // Special handling for games folder
    if (bookId === 'games') {
        return `games/${type}/${finalFilename}`;
    }

    // Special handling for playlists folder
    if (bookId === 'playlists') {
        return `playlists/${type}/${finalFilename}`;
    }

    // Special handling for voices folder
    if (bookId === 'voices') {
        return `voices/${type}/${finalFilename}`;
    }

    // Special handling for lessons folder
    if (bookId === 'lessons' || bookId?.startsWith('lessons/')) {
        const lessonId = bookId.replace('lessons/', '').replace('lessons', '') || 'temp';
        return `lessons/${lessonId}/${type}/${finalFilename}`;
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
            if (!['cover', 'pages', 'scroll', 'audio', 'game-cover', 'thumbnail', 'character'].includes(type)) {
                return res.status(400).json({ message: 'type must be one of: cover, pages, scroll, audio, game-cover, thumbnail, character' });
            }
            
            // Special handling for lessons
            if (bookId === 'lessons' || bookId.startsWith('lessons/')) {
                const lessonId = req.query.lessonId || bookId.replace('lessons/', '').replace('lessons', '') || 'temp';
                filePath = generateFilePath(`lessons/${lessonId}`, type, req.file.originalname);
            } else {
                // Generate organized file path for books
                filePath = generateFilePath(bookId, type, req.file.originalname, pageNumber);
            }
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
router.post('/video', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            console.error('Multer error (file upload):', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ 
                    message: 'File too large. Maximum size is 500MB.',
                    error: err.message 
                });
            }
            return res.status(400).json({ 
                message: 'File upload error',
                error: err.message 
            });
        }
        next();
    });
}, async (req, res) => {
    try {
        console.log('Video upload request received:', {
            hasFile: !!req.file,
            fileName: req.file?.originalname,
            fileSize: req.file?.size,
            mimetype: req.file?.mimetype,
            query: req.query
        });

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { bookId, type, pageNumber, lessonId } = req.query;
        console.log('Video upload params:', { bookId, type, pageNumber, lessonId });

        let filePath;

        // Check if using organized structure
        if (bookId && type) {
            // Special handling for lessons - allow video and thumbnail types
            if (bookId === 'lessons' || bookId.startsWith('lessons/')) {
                const extractedLessonId = lessonId || bookId.replace('lessons/', '').replace('lessons', '') || 'temp';
                console.log('Processing lesson video upload, lessonId:', extractedLessonId);
                
                // For lessons, allow 'video' and 'thumbnail' types
                if (!['video', 'thumbnail'].includes(type)) {
                    return res.status(400).json({ message: 'For lessons, type must be either "video" or "thumbnail"' });
                }
                
                try {
                    filePath = generateFilePath(`lessons/${extractedLessonId}`, type, req.file.originalname);
                    console.log('Generated file path for lesson:', filePath);
                } catch (pathError) {
                    console.error('Error generating file path:', pathError);
                    throw pathError;
                }
            } else {
                // Validate type for books
                if (!['pages', 'scroll', 'video'].includes(type)) {
                    return res.status(400).json({ message: 'type must be one of: pages, scroll, video' });
                }
                // Generate organized file path for books
                filePath = generateFilePath(bookId, type, req.file.originalname, pageNumber);
            }
        } else {
            // Fallback to simple structure for backward compatibility
            filePath = `videos/${Date.now()}_${req.file.originalname}`;
        }

        console.log('Final file path:', filePath);
        console.log('GCS configured:', !!(bucket && process.env.GCS_BUCKET_NAME));

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            console.log('Uploading video to GCS:', filePath);
            // Use Google Cloud Storage
            const blob = bucket.file(filePath);
            let responded = false; // Track if we've already sent a response
            
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: req.file.mimetype,
                },
            });

            blobStream.on('error', (error) => {
                if (responded) {
                    console.error('GCS Upload error after response sent:', error);
                    return;
                }
                responded = true;
                console.error('GCS Upload error:', error);
                console.error('Error details:', error.message, error.stack);
                // Fallback to local storage on GCS error
                saveFileLocally(req.file, filePath, req)
                    .then(url => {
                        console.log('Saved to local storage as fallback:', url);
                        if (!responded) {
                            res.status(200).json({ url, path: filePath });
                        }
                    })
                    .catch(err => {
                        console.error('Local storage fallback failed:', err);
                        if (!responded) {
                            res.status(500).json({ message: 'Upload failed', error: err.message });
                        }
                    });
            });

            blobStream.on('finish', () => {
                if (responded) {
                    console.log('GCS upload finished but response already sent');
                    return;
                }
                responded = true;
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                console.log('Video uploaded successfully to GCS:', publicUrl);
                res.status(200).json({ url: publicUrl, path: filePath });
            });

            try {
                blobStream.end(req.file.buffer);
            } catch (streamError) {
                if (!responded) {
                    responded = true;
                    console.error('Error writing to GCS stream:', streamError);
                    // Fallback to local storage
                    saveFileLocally(req.file, filePath, req)
                        .then(url => {
                            res.status(200).json({ url, path: filePath });
                        })
                        .catch(err => {
                            res.status(500).json({ message: 'Upload failed', error: err.message });
                        });
                }
            }
        } else {
            // Use local storage
            console.log('GCS not configured, using local storage. Bucket:', !!bucket, 'BucketName:', process.env.GCS_BUCKET_NAME);
            try {
                const url = await saveFileLocally(req.file, filePath, req);
                console.log('Video saved to local storage:', url);
                res.status(200).json({ url, path: filePath });
            } catch (localError) {
                console.error('Local storage error:', localError);
                throw localError;
            }
        }
    } catch (error) {
        console.error('Video upload error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ 
            message: 'Upload failed', 
            error: error.message,
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Upload audio endpoint with organized structure
// Query params: bookId (required), type=audio
router.post('/audio', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { bookId, type } = req.query;

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

        let filePath;
        
        // Check if using organized structure
        if (bookId && type) {
            // Special handling for playlists
            if (bookId === 'playlists') {
                filePath = `playlists/audio/${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            } else {
                // Generate organized file path for books
                filePath = generateFilePath(bookId, 'audio', req.file.originalname);
            }
        } else if (bookId) {
            // Fallback: if only bookId provided, use it
            filePath = generateFilePath(bookId, 'audio', req.file.originalname);
        } else {
            // Fallback to simple structure
            filePath = `audio/${Date.now()}_${req.file.originalname}`;
        }

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

// Simple MP3 upload - just upload and return URL (for hardcoding in app)
router.post('/mp3', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No audio file provided' });
        }

        console.log('📤 Simple MP3 upload:', req.file.originalname, req.file.size, 'bytes');

        const timestamp = Date.now();
        const ext = path.extname(req.file.originalname) || '.mp3';
        const sanitizedName = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const filename = `${timestamp}_${sanitizedName}`;
        const filePath = `music/${filename}`;

        if (bucket) {
            // Upload to GCS
            const blob = bucket.file(filePath);
            const blobStream = blob.createWriteStream({
                resumable: false,
                contentType: req.file.mimetype || 'audio/mpeg',
                metadata: {
                    cacheControl: 'public, max-age=31536000',
                }
            });

            blobStream.on('error', (error) => {
                console.error('❌ GCS upload error:', error);
                res.status(500).json({ message: 'Failed to upload to storage', error: error.message });
            });

            blobStream.on('finish', async () => {
                // Note: With uniform bucket-level access, we don't need to call makePublic()
                // The bucket is already configured for public access
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                console.log('✅ MP3 uploaded:', publicUrl);
                res.status(200).json({ 
                    url: publicUrl, 
                    filename: req.file.originalname,
                    size: req.file.size,
                    message: 'Copy this URL and use it in the app!'
                });
            });

            blobStream.end(req.file.buffer);
        } else {
            // Fallback to local storage
            console.log('GCS not configured, using local storage');
            const url = await saveFileLocally(req.file, filePath, req);
            res.status(200).json({ 
                url, 
                filename: req.file.originalname,
                size: req.file.size,
                message: 'Copy this URL and use it in the app!'
            });
        }
    } catch (error) {
        console.error('❌ MP3 upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
