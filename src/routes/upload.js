const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { bucket } = require('../config/storage');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const axios = require('axios');
const Book = require('../models/Book');

// Configure ffmpeg binary (bundled via @ffmpeg-installer/ffmpeg)
try {
    if (ffmpegInstaller?.path) {
        ffmpeg.setFfmpegPath(ffmpegInstaller.path);
    }
} catch (e) {
    console.warn('⚠️ ffmpeg binary not configured:', e);
}

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// --- Audio processing helpers (volume attenuation) ---
const clamp01 = (n) => Math.min(1, Math.max(0, n));

const extractGcsPathFromUrl = (url) => {
    try {
        const u = String(url || '');
        const marker = `https://storage.googleapis.com/${bucket?.name}/`;
        if (bucket?.name && u.startsWith(marker)) {
            return u.slice(marker.length);
        }
        // Also support storage.googleapis.com/<bucket>/<path> without https prefix variations
        const m = u.match(/storage\.googleapis\.com\/([^/]+)\/(.+)$/i);
        if (m && bucket?.name && m[1] === bucket.name) {
            return m[2];
        }
    } catch { }
    return null;
};

// Compress video using FFmpeg
// Returns a Promise that resolves to the compressed video buffer
const compressVideo = (videoBuffer, originalFilename, options = {}) => {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const tempInputPath = path.join(tempDir, `temp_input_${Date.now()}${path.extname(originalFilename)}`);
        const tempOutputPath = path.join(tempDir, `temp_compressed_${Date.now()}.mp4`);
        
        // Write video buffer to temp file
        fs.writeFileSync(tempInputPath, videoBuffer);
        
        const originalSize = videoBuffer.length;
        console.log(`🎬 Compressing video: ${originalFilename} (${(originalSize / 1024 / 1024).toFixed(2)} MB)`);
        
        // Compression settings - balanced quality vs size
        const {
            maxWidth = 1280,        // Max width (1280p)
            videoBitrate = '1500k', // Target video bitrate (1.5 Mbps)
            audioBitrate = '128k',  // Audio bitrate
            crf = 28,               // Constant Rate Factor (18-28 is good, higher = smaller)
        } = options;
        
        ffmpeg(tempInputPath)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                `-crf ${crf}`,
                '-preset fast',           // Encoding speed (faster = larger file, slower = smaller)
                `-maxrate ${videoBitrate}`,
                `-bufsize ${parseInt(videoBitrate) * 2}k`,
                `-vf scale='min(${maxWidth},iw)':-2`, // Scale down if larger than maxWidth, keep aspect ratio
                '-movflags +faststart',   // Enable fast start for web streaming
                '-pix_fmt yuv420p',       // Ensure compatibility
            ])
            .audioBitrate(audioBitrate)
            .format('mp4')
            .on('start', (cmd) => {
                console.log('🎬 FFmpeg compress command:', cmd);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`🎬 Compression progress: ${Math.round(progress.percent)}%`);
                }
            })
            .on('end', () => {
                try {
                    const compressedBuffer = fs.readFileSync(tempOutputPath);
                    const compressedSize = compressedBuffer.length;
                    const savings = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);
                    
                    console.log(`🎬 Compression complete: ${(compressedSize / 1024 / 1024).toFixed(2)} MB (saved ${savings}%)`);
                    
                    // Cleanup temp files
                    fs.unlinkSync(tempInputPath);
                    fs.unlinkSync(tempOutputPath);
                    
                    resolve({
                        buffer: compressedBuffer,
                        originalSize,
                        compressedSize,
                        savings: parseFloat(savings)
                    });
                } catch (err) {
                    console.error('🎬 Error reading compressed video:', err);
                    // Cleanup
                    try { fs.unlinkSync(tempInputPath); } catch (e) {}
                    try { fs.unlinkSync(tempOutputPath); } catch (e) {}
                    // Return original if compression fails
                    resolve({ buffer: videoBuffer, originalSize, compressedSize: originalSize, savings: 0 });
                }
            })
            .on('error', (err) => {
                console.error('🎬 FFmpeg compression error:', err.message);
                // Cleanup
                try { fs.unlinkSync(tempInputPath); } catch (e) {}
                try { fs.unlinkSync(tempOutputPath); } catch (e) {}
                // Return original if compression fails
                resolve({ buffer: videoBuffer, originalSize, compressedSize: originalSize, savings: 0 });
            })
            .save(tempOutputPath);
    });
};

// Extract audio from video buffer using FFmpeg
// Returns a Promise that resolves to the audio buffer or null if extraction fails
const extractAudioFromVideo = (videoBuffer, originalFilename) => {
    return new Promise((resolve, reject) => {
        const tempDir = os.tmpdir();
        const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}${path.extname(originalFilename)}`);
        const tempAudioPath = path.join(tempDir, `temp_audio_${Date.now()}.mp3`);
        
        // Write video buffer to temp file
        fs.writeFileSync(tempVideoPath, videoBuffer);
        
        console.log('🎬 Extracting audio from video:', originalFilename);
        
        ffmpeg(tempVideoPath)
            .noVideo()
            .audioCodec('libmp3lame')
            .audioBitrate('128k')
            .audioChannels(2)
            .audioFrequency(44100)
            .output(tempAudioPath)
            .on('start', (cmd) => {
                console.log('🎬 FFmpeg command:', cmd);
            })
            .on('progress', (progress) => {
                if (progress.percent) {
                    console.log(`🎬 Audio extraction progress: ${Math.round(progress.percent)}%`);
                }
            })
            .on('end', () => {
                console.log('🎬 Audio extraction complete');
                try {
                    const audioBuffer = fs.readFileSync(tempAudioPath);
                    // Cleanup temp files
                    fs.unlinkSync(tempVideoPath);
                    fs.unlinkSync(tempAudioPath);
                    resolve(audioBuffer);
                } catch (err) {
                    console.error('🎬 Error reading extracted audio:', err);
                    // Cleanup
                    try { fs.unlinkSync(tempVideoPath); } catch (e) {}
                    try { fs.unlinkSync(tempAudioPath); } catch (e) {}
                    resolve(null); // Return null instead of rejecting - audio extraction is optional
                }
            })
            .on('error', (err) => {
                console.error('🎬 FFmpeg error:', err.message);
                // Cleanup
                try { fs.unlinkSync(tempVideoPath); } catch (e) {}
                try { fs.unlinkSync(tempAudioPath); } catch (e) {}
                resolve(null); // Return null instead of rejecting - video might not have audio
            })
            .run();
    });
};

// Upload buffer to GCS and return public URL
const uploadBufferToGCS = (buffer, filePath, contentType) => {
    return new Promise((resolve, reject) => {
        if (!bucket) {
            reject(new Error('GCS not configured'));
            return;
        }
        
        const blob = bucket.file(filePath);
        const blobStream = blob.createWriteStream({
            metadata: { contentType },
            resumable: false
        });
        
        blobStream.on('error', (err) => {
            console.error('GCS upload error for', filePath, ':', err);
            reject(err);
        });
        
        blobStream.on('finish', () => {
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
            console.log('✅ Uploaded to GCS:', publicUrl);
            resolve(publicUrl);
        });
        
        blobStream.end(buffer);
    });
};

const extractLocalUploadsPathFromUrl = (url) => {
    try {
        const u = String(url || '');
        const idx = u.indexOf('/uploads/');
        if (idx >= 0) return u.slice(idx + '/uploads/'.length);
    } catch { }
    return null;
};

const fetchAudioBufferByUrl = async (url) => {
    // Prefer GCS download when possible (fast + no external fetch)
    const gcsPath = extractGcsPathFromUrl(url);
    if (gcsPath && bucket) {
        const [buf] = await bucket.file(gcsPath).download();
        return { buffer: buf, source: 'gcs', sourcePath: gcsPath };
    }

    // Local uploads folder (backend serves /uploads/*)
    const localRel = extractLocalUploadsPathFromUrl(url);
    if (localRel) {
        const localPath = path.join(uploadsDir, localRel);
        const buf = await fs.promises.readFile(localPath);
        return { buffer: buf, source: 'local', sourcePath: localRel };
    }

    // Fallback: HTTP fetch
    const resp = await axios.get(url, { responseType: 'arraybuffer' });
    return { buffer: Buffer.from(resp.data), source: 'http', sourcePath: null };
};

/**
 * Reduce (or increase) audio volume by re-encoding to mp3 using ffmpeg.
 * Returns { buffer, mimetype, ext }.
 * NOTE: We re-encode to mp3 for consistent playback and tooling.
 */
const processAudioVolumeToMp3 = async ({ inputBuffer, inputExt, volume }) => {
    const vol = clamp01(volume);
    if (!Number.isFinite(vol) || vol <= 0) {
        throw new Error('Invalid volume');
    }

    // If volume is ~1.0, skip processing
    if (Math.abs(vol - 1) < 0.0001) {
        return { buffer: inputBuffer, mimetype: 'audio/mpeg', ext: inputExt || '.mp3', processed: false };
    }

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gk-audio-'));
    const id = crypto.randomBytes(8).toString('hex');
    const inPath = path.join(tmpDir, `in-${id}${inputExt || '.bin'}`);
    const outPath = path.join(tmpDir, `out-${id}.mp3`);

    try {
        await fs.promises.writeFile(inPath, inputBuffer);

        await new Promise((resolve, reject) => {
            ffmpeg(inPath)
                .noVideo()
                .audioFilters([`volume=${vol}`])
                .audioCodec('libmp3lame')
                .outputOptions([
                    '-q:a 4', // VBR quality (good balance)
                    '-map_metadata -1', // strip metadata
                ])
                .format('mp3')
                .on('error', (err) => reject(err))
                .on('end', () => resolve())
                .save(outPath);
        });

        const outBuffer = await fs.promises.readFile(outPath);
        return { buffer: outBuffer, mimetype: 'audio/mpeg', ext: '.mp3', processed: true };
    } finally {
        // Best-effort cleanup
        try { await fs.promises.unlink(inPath); } catch { }
        try { await fs.promises.unlink(outPath); } catch { }
        try { await fs.promises.rmdir(tmpDir); } catch { }
    }
};

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
        const voiceId = req.query.voiceId;

        // Check if using organized structure
        if (bookId && type) {
            // Validate type
            if (!['cover', 'pages', 'scroll', 'audio', 'game-cover', 'thumbnail', 'character', 'image-sequence'].includes(type)) {
                return res.status(400).json({ message: 'type must be one of: cover, pages, scroll, audio, game-cover, thumbnail, character, image-sequence' });
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
        } else if (type === 'voices' && voiceId) {
            // Special handling for voice character images
            const safeFilename = req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
            filePath = `voices/${voiceId}/${Date.now()}_${safeFilename}`;
            console.log('Using voice structure:', filePath);
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
                
                // For lessons, allow 'video', 'thumbnail', and 'episodes' types
                if (!['video', 'thumbnail', 'episodes'].includes(type)) {
                    return res.status(400).json({ message: 'For lessons, type must be one of: "video", "thumbnail", or "episodes"' });
                }
                
                try {
                    // For episodes, include episode number in filename
                    const episodeNumber = req.query.episodeNumber;
                    let filename = req.file.originalname;
                    if (type === 'episodes' && episodeNumber) {
                        const ext = path.extname(req.file.originalname);
                        filename = `episode-${episodeNumber}${ext}`;
                    }
                    filePath = generateFilePath(`lessons/${extractedLessonId}`, type, filename);
                    console.log('Generated file path for lesson:', filePath);
                } catch (pathError) {
                    console.error('Error generating file path:', pathError);
                    throw pathError;
                }
            } else {
                // Validate type for books
                if (!['pages', 'scroll', 'video', 'sequence', 'intro'].includes(type)) {
                    return res.status(400).json({ message: 'type must be one of: pages, scroll, video, sequence, intro' });
                }
                // Generate organized file path for books
                // For sequence videos, use 'video-sequence' folder; for intro videos, use 'intro' folder
                let folderType = type;
                if (type === 'sequence') folderType = 'video-sequence';
                else if (type === 'intro') folderType = 'intro';
                filePath = generateFilePath(bookId, folderType, req.file.originalname, pageNumber);
            }
        } else {
            // Fallback to simple structure for backward compatibility
            filePath = `videos/${Date.now()}_${req.file.originalname}`;
        }

        console.log('Final file path:', filePath);
        console.log('GCS configured:', !!(bucket && process.env.GCS_BUCKET_NAME));

        // Determine if we should compress this video
        // Compress sequence videos and page background videos (not lesson videos which may need full quality)
        const shouldCompress = type === 'sequence' || type === 'pages' || type === 'video';
        let videoBuffer = req.file.buffer;
        let compressionInfo = null;
        
        if (shouldCompress && videoBuffer.length > 1024 * 1024) { // Only compress if > 1MB
            console.log('🎬 Auto-compressing video before upload...');
            try {
                const result = await compressVideo(videoBuffer, req.file.originalname, {
                    maxWidth: 1280,      // Max 720p for sequences
                    videoBitrate: '1500k', // 1.5 Mbps
                    crf: 28,              // Good quality/size balance
                });
                videoBuffer = result.buffer;
                compressionInfo = {
                    originalSize: result.originalSize,
                    compressedSize: result.compressedSize,
                    savings: result.savings
                };
                // Update file path to always be .mp4 after compression
                if (!filePath.toLowerCase().endsWith('.mp4')) {
                    filePath = filePath.replace(/\.[^.]+$/, '.mp4');
                }
            } catch (compressErr) {
                console.warn('🎬 Video compression failed, uploading original:', compressErr.message);
            }
        }

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            console.log('Uploading video to GCS:', filePath);
            // Use Google Cloud Storage
            const blob = bucket.file(filePath);
            let responded = false; // Track if we've already sent a response
            
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: 'video/mp4', // Always mp4 after compression
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
                saveFileLocally({ ...req.file, buffer: videoBuffer }, filePath, req)
                    .then(url => {
                        console.log('Saved to local storage as fallback:', url);
                        if (!responded) {
                            res.status(200).json({ url, path: filePath, compression: compressionInfo });
                        }
                    })
                    .catch(err => {
                        console.error('Local storage fallback failed:', err);
                        if (!responded) {
                            res.status(500).json({ message: 'Upload failed', error: err.message });
                        }
                    });
            });

            blobStream.on('finish', async () => {
                if (responded) {
                    console.log('GCS upload finished but response already sent');
                    return;
                }
                responded = true;
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                console.log('Video uploaded successfully to GCS:', publicUrl);
                
                // Auto-extract audio for page background videos AND video sequences
                // This allows video sound effects to play alongside TTS on iOS
                const shouldExtractAudio = bookId && (type === 'pages' || type === 'video' || type === 'sequence');
                let backgroundAudioUrl = null;
                
                if (shouldExtractAudio) {
                    console.log('🎬 Auto-extracting audio from page background video...');
                    try {
                        const audioBuffer = await extractAudioFromVideo(videoBuffer, req.file.originalname);
                        if (audioBuffer && audioBuffer.length > 1000) { // Only if audio is substantial (> 1KB)
                            // Generate audio file path
                            const audioFilename = path.basename(filePath, path.extname(filePath)) + '.mp3';
                            const audioFilePath = `books/${bookId}/background-audio/${audioFilename}`;
                            
                            backgroundAudioUrl = await uploadBufferToGCS(audioBuffer, audioFilePath, 'audio/mpeg');
                            console.log('🎬 Background audio extracted and uploaded:', backgroundAudioUrl);
                        } else {
                            console.log('🎬 No audio track in video or audio too short, skipping');
                        }
                    } catch (audioErr) {
                        console.warn('🎬 Audio extraction failed (video will work without separate audio):', audioErr.message);
                        // Don't fail the request - video upload was successful
                    }
                }
                
                // Return response with both URLs and compression info
                res.status(200).json({ 
                    url: publicUrl, 
                    path: filePath,
                    backgroundAudioUrl, // Will be null if not extracted or extraction failed
                    compression: compressionInfo // Will be null if not compressed
                });
            });

            try {
                blobStream.end(videoBuffer); // Use compressed buffer
            } catch (streamError) {
                if (!responded) {
                    responded = true;
                    console.error('Error writing to GCS stream:', streamError);
                    // Fallback to local storage
                    saveFileLocally({ ...req.file, buffer: videoBuffer }, filePath, req)
                        .then(url => {
                            res.status(200).json({ url, path: filePath, compression: compressionInfo });
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
                const url = await saveFileLocally({ ...req.file, buffer: videoBuffer }, filePath, req);
                console.log('Video saved to local storage:', url);
                res.status(200).json({ url, path: filePath, compression: compressionInfo });
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
        const requestedVolumeRaw = req.query.volume ?? req.body?.volume;
        const requestedVolume = requestedVolumeRaw !== undefined ? parseFloat(String(requestedVolumeRaw)) : undefined;
        const volume = Number.isFinite(requestedVolume) ? clamp01(requestedVolume) : undefined;

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
        if (volume !== undefined) {
            console.log('🔉 Audio upload volume requested:', volume);
        }

        // If volume is provided and < 1, attenuate by re-encoding to mp3.
        // This makes the resulting file quieter everywhere (including iOS builds).
        let finalBuffer = req.file.buffer;
        let finalMimetype = req.file.mimetype || 'audio/mpeg';
        let finalFilename = req.file.originalname;
        let finalFilePath = filePath;

        if (volume !== undefined && volume > 0 && volume < 1) {
            try {
                const processed = await processAudioVolumeToMp3({
                    inputBuffer: req.file.buffer,
                    inputExt: fileExtension,
                    volume,
                });
                finalBuffer = processed.buffer;
                finalMimetype = processed.mimetype;
                // rename to mp3 for consistency
                const baseName = path.basename(finalFilename, fileExtension);
                finalFilename = `${baseName}_vol${Math.round(volume * 100)}.mp3`;
                // ensure storage path ends with .mp3
                if (finalFilePath.toLowerCase().endsWith(fileExtension)) {
                    finalFilePath = finalFilePath.slice(0, -fileExtension.length) + '.mp3';
                } else if (!finalFilePath.toLowerCase().endsWith('.mp3')) {
                    finalFilePath = `${finalFilePath}.mp3`;
                }
                console.log('✅ Audio volume processed:', { from: filePath, to: finalFilePath, filename: finalFilename });
            } catch (e) {
                console.warn('⚠️ Audio volume processing failed; uploading original:', e?.message || e);
            }
        }

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            console.log('Uploading audio to GCS:', finalFilePath);
            // Use Google Cloud Storage
            const blob = bucket.file(finalFilePath);
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: finalMimetype,
                },
            });

            blobStream.on('error', (error) => {
                console.error('GCS Upload error:', error);
                // Fallback to local storage on GCS error
                saveFileLocally({ ...req.file, buffer: finalBuffer, mimetype: finalMimetype, originalname: finalFilename }, finalFilePath, req)
                    .then(url => res.status(200).json({ url, path: finalFilePath, filename: finalFilename }))
                    .catch(err => res.status(500).json({ message: 'Upload failed', error: err.message }));
            });

            blobStream.on('finish', () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${finalFilePath}`;
                res.status(200).json({ url: publicUrl, path: finalFilePath, filename: finalFilename });
            });

            blobStream.end(finalBuffer);
        } else {
            // Use local storage
            console.log('GCS not configured, using local storage for audio');
            const url = await saveFileLocally({ ...req.file, buffer: finalBuffer, mimetype: finalMimetype, originalname: finalFilename }, finalFilePath, req);
            res.status(200).json({ url, path: finalFilePath, filename: finalFilename });
        }
    } catch (error) {
        console.error('Audio upload error:', error);
        res.status(500).json({ message: error.message });
    }
});

// Reprocess an existing book background music file (no re-upload)
// POST /api/upload/audio/reprocess?bookId=...&index=0&volume=0.2
router.post('/audio/reprocess', async (req, res) => {
    console.log('🎵 Audio reprocess request received:', { bookId: req.query.bookId, index: req.query.index, volume: req.query.volume });
    try {
        const { bookId } = req.query;
        const indexRaw = req.query.index;
        const volumeRaw = req.query.volume ?? req.body?.volume;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required' });
        }
        const index = parseInt(String(indexRaw), 10);
        if (!Number.isFinite(index) || index < 0) {
            return res.status(400).json({ message: 'index must be a non-negative integer' });
        }
        const volumeParsed = parseFloat(String(volumeRaw));
        if (!Number.isFinite(volumeParsed) || volumeParsed <= 0 || volumeParsed > 1) {
            return res.status(400).json({ message: 'volume must be a number between 0 and 1' });
        }
        const volume = clamp01(volumeParsed);

        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        if (!book.files) {
            book.files = { coverImage: book.coverImage || null, images: [], videos: [], audio: [] };
        }
        if (!Array.isArray(book.files.audio) || !book.files.audio[index]) {
            return res.status(404).json({ message: 'Audio file not found at given index' });
        }

        const current = book.files.audio[index];
        const currentUrl = current.url;
        if (!currentUrl) {
            return res.status(400).json({ message: 'Selected audio has no url' });
        }

        // Fetch source audio
        console.log('🎵 Fetching audio from:', currentUrl);
        const fetched = await fetchAudioBufferByUrl(currentUrl);
        console.log('🎵 Fetched audio:', fetched.buffer.length, 'bytes from', fetched.source);
        const currentFilename = current.filename || `book-audio-${index}.mp3`;
        const currentExt = path.extname(currentFilename).toLowerCase() || '.mp3';

        // Process volume to mp3
        console.log('🎵 Processing audio with volume:', volume, '(', Math.round(volume * 100), '%)');
        const processed = await processAudioVolumeToMp3({
            inputBuffer: fetched.buffer,
            inputExt: currentExt,
            volume,
        });
        console.log('🎵 Processed audio:', processed.buffer.length, 'bytes');

        const baseName = path.basename(currentFilename, currentExt);
        const newFilename = `${baseName}_vol${Math.round(volume * 100)}.mp3`;
        const newPath = generateFilePath(String(bookId), 'audio', newFilename);

        let newUrl;
        if (bucket && process.env.GCS_BUCKET_NAME) {
            const blob = bucket.file(newPath);
            await new Promise((resolve, reject) => {
                const blobStream = blob.createWriteStream({
                    metadata: { contentType: processed.mimetype || 'audio/mpeg' },
                });
                blobStream.on('error', reject);
                blobStream.on('finish', resolve);
                blobStream.end(processed.buffer);
            });
            newUrl = `https://storage.googleapis.com/${bucket.name}/${newPath}`;
        } else {
            newUrl = await saveFileLocally(
                { buffer: processed.buffer, mimetype: processed.mimetype || 'audio/mpeg', originalname: newFilename },
                newPath,
                req
            );
        }

        // Update book record
        book.files.audio[index] = {
            url: newUrl,
            filename: newFilename,
            uploadedAt: new Date(),
        };
        await book.save();

        console.log('🎵 Audio reprocess COMPLETE:', { newUrl, newFilename, volume: Math.round(volume * 100) + '%' });
        
        res.status(200).json({
            url: newUrl,
            path: newPath,
            filename: newFilename,
            index,
            volume,
        });
    } catch (error) {
        console.error('Audio reprocess error:', error);
        res.status(500).json({ message: 'Reprocess failed', error: error.message });
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

// Upload background audio - extracted video audio or ambient sound that loops with the page
// This plays as separate <audio> element so it can layer with TTS (unlike video audio on iOS)
// Query params: bookId (required), pageNumber (optional)
router.post('/background-audio', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { bookId, pageNumber } = req.query;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required for background audio uploads' });
        }

        // Validate file type (audio only)
        const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac'];
        if (!allowedTypes.includes(req.file.mimetype) && !req.file.originalname.match(/\.(mp3|wav|ogg|m4a|aac)$/i)) {
            return res.status(400).json({ 
                message: 'Invalid file type. Only MP3, WAV, OGG, M4A, and AAC audio files are allowed.' 
            });
        }

        // Validate file size (max 20MB for longer ambient loops)
        const maxSize = 20 * 1024 * 1024; // 20MB
        if (req.file.size > maxSize) {
            return res.status(400).json({ 
                message: 'Background audio file is too large. Maximum size is 20MB.' 
            });
        }

        const fileExtension = path.extname(req.file.originalname).toLowerCase() || '.mp3';
        
        // Generate organized file path: books/{bookId}/background-audio/filename
        const filename = pageNumber 
            ? `page-${pageNumber}-${Date.now()}${fileExtension}`
            : `${Date.now()}-${req.file.originalname}`;
        const filePath = `books/${bookId}/background-audio/${filename}`;

        console.log('Uploading background audio to:', filePath);

        // Check if GCS is configured
        if (bucket && process.env.GCS_BUCKET_NAME) {
            console.log('Uploading background audio to GCS:', filePath);
            const blob = bucket.file(filePath);
            const blobStream = blob.createWriteStream({
                metadata: {
                    contentType: req.file.mimetype,
                },
                resumable: false,
            });

            blobStream.on('error', (error) => {
                console.error('GCS background audio upload error:', error);
                res.status(500).json({ message: 'Failed to upload background audio to storage' });
            });

            blobStream.on('finish', async () => {
                const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
                console.log('Background audio uploaded successfully:', publicUrl);
                res.status(200).json({ url: publicUrl, path: filePath, filename });
            });

            blobStream.end(req.file.buffer);
        } else {
            // Use local storage
            console.log('GCS not configured, using local storage for background audio');
            const url = await saveFileLocally(req.file, filePath, req);
            res.status(200).json({ url, path: filePath, filename });
        }
    } catch (error) {
        console.error('Background audio upload error:', error);
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
