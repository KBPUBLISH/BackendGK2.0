const express = require('express');
const router = express.Router();
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

require('dotenv').config();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Helper function to convert audio to MP3
const convertToMP3 = (inputBuffer, inputFormat) => {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const tempInputPath = path.join(uploadsDir, `temp_input_${timestamp}_${random}.${inputFormat}`);
        const tempOutputPath = path.join(uploadsDir, `temp_output_${timestamp}_${random}.mp3`);

        // Write input buffer to temp file
        fs.writeFileSync(tempInputPath, inputBuffer);

        ffmpeg(tempInputPath)
            .toFormat('mp3')
            .audioCodec('libmp3lame')
            .audioBitrate(128)
            .audioChannels(1)
            .audioFrequency(22050)
            .on('end', () => {
                // Read converted file
                const convertedBuffer = fs.readFileSync(tempOutputPath);
                
                // Clean up temp files
                try {
                    fs.unlinkSync(tempInputPath);
                    fs.unlinkSync(tempOutputPath);
                } catch (err) {
                    console.warn('Failed to clean up temp files:', err);
                }
                
                resolve(convertedBuffer);
            })
            .on('error', (err) => {
                // Clean up temp files on error
                try {
                    if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
                    if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
                } catch (cleanupErr) {
                    console.warn('Failed to clean up temp files:', cleanupErr);
                }
                
                reject(err);
            })
            .save(tempOutputPath);
    });
};

// Check if format needs conversion (ElevenLabs supports: mp3, wav, ogg)
const needsConversion = (mimetype, filename) => {
    if (!mimetype && !filename) return true; // Unknown format, convert to be safe
    
    const supportedFormats = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/wave', 'audio/ogg', 'audio/oga'];
    const supportedExtensions = ['.mp3', '.wav', '.ogg'];
    
    if (mimetype) {
        if (supportedFormats.some(f => mimetype.includes(f))) {
            return false;
        }
    }
    
    if (filename) {
        const ext = path.extname(filename).toLowerCase();
        if (supportedExtensions.includes(ext)) {
            return false;
        }
    }
    
    return true; // Needs conversion
};

// POST /clone - Clone a voice from audio samples
router.post('/clone', upload.array('samples', 10), async (req, res) => {
    try {
        const { name, description } = req.body;
        const files = req.files;

        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Voice name is required' });
        }

        if (!files || files.length === 0) {
            return res.status(400).json({ message: 'At least one audio sample is required' });
        }

        // ElevenLabs requires at least 1 minute of audio for cloning
        // We'll validate this on the frontend, but check here too
        if (files.length < 1) {
            return res.status(400).json({ message: 'At least one audio sample is required' });
        }

        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ message: 'ElevenLabs API key not configured' });
        }

        // Convert files that need conversion
        console.log('🔄 Checking files for conversion...');
        const convertedFiles = await Promise.all(files.map(async (file, index) => {
            if (needsConversion(file.mimetype, file.originalname)) {
                console.log(`🔄 Converting file ${index + 1}: ${file.originalname || 'unnamed'} (${file.mimetype || 'unknown'}) to MP3...`);
                try {
                    const inputFormat = file.mimetype?.includes('webm') ? 'webm' : 
                                       file.mimetype?.includes('mp4') || file.mimetype?.includes('m4a') ? 'm4a' :
                                       path.extname(file.originalname || '').substring(1) || 'webm';
                    
                    const convertedBuffer = await convertToMP3(file.buffer, inputFormat);
                    console.log(`✅ Converted file ${index + 1} to MP3 (${(convertedBuffer.length / 1024 / 1024).toFixed(2)}MB)`);
                    
                    return {
                        ...file,
                        buffer: convertedBuffer,
                        mimetype: 'audio/mpeg',
                        originalname: file.originalname ? file.originalname.replace(/\.[^.]+$/, '.mp3') : `converted_${index + 1}.mp3`
                    };
                } catch (conversionError) {
                    console.error(`❌ Failed to convert file ${index + 1}:`, conversionError);
                    // If conversion fails, try sending original (might work)
                    console.warn(`⚠️ Sending original file format, may fail if unsupported`);
                    return file;
                }
            } else {
                console.log(`✓ File ${index + 1} already in supported format: ${file.mimetype || file.originalname}`);
                return file;
            }
        }));

        // Prepare form data for ElevenLabs
        const formData = new FormData();
        formData.append('name', name);
        if (description) {
            formData.append('description', description);
        }

        // Add audio files (now all in supported format - MP3, WAV, or OGG)
        convertedFiles.forEach((file, index) => {
            // After conversion, files are MP3, but keep original format if already supported
            const extension = file.originalname?.match(/\.(\w+)$/)?.[1]?.toLowerCase() || 'mp3';
            const contentType = file.mimetype || 'audio/mpeg';
            
            console.log(`📁 File ${index + 1}: ${file.originalname || 'unnamed'}, type: ${contentType}, extension: ${extension}, size: ${(file.buffer.length / 1024 / 1024).toFixed(2)}MB`);
            
            formData.append('files', file.buffer, {
                filename: file.originalname || `sample_${index + 1}.${extension}`,
                contentType: contentType
            });
        });

        console.log(`🎤 Cloning voice "${name}" with ${files.length} audio file(s)`);
        console.log(`📁 Files:`, files.map(f => ({ 
            name: f.originalname, 
            size: `${(f.size / 1024 / 1024).toFixed(2)}MB`, 
            type: f.mimetype,
            bufferSize: f.buffer.length 
        })));
        
        // Log FormData details (form-data package doesn't have entries() method)
        console.log('📦 FormData prepared with:', {
            name: name,
            description: description || 'none',
            fileCount: convertedFiles.length,
            files: convertedFiles.map(f => ({
                name: f.originalname,
                size: `${(f.buffer.length / 1024 / 1024).toFixed(2)}MB`,
                type: f.mimetype
            }))
        });
        
        // Call ElevenLabs voice cloning API
        const response = await axios.post(
            'https://api.elevenlabs.io/v1/voices/add',
            formData,
            {
                headers: {
                    'xi-api-key': apiKey,
                    ...formData.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 120000 // 2 minutes timeout for voice cloning
            }
        );
        
        console.log('✅ ElevenLabs response:', response.status, response.data);

        if (response.data && response.data.voice_id) {
            res.json({
                success: true,
                voice: {
                    voice_id: response.data.voice_id,
                    name: response.data.name || name,
                    description: response.data.description || description,
                    category: 'cloned',
                    preview_url: response.data.preview_url
                }
            });
        } else {
            res.status(500).json({ message: 'Failed to clone voice - invalid response from ElevenLabs' });
        }
    } catch (error) {
        console.error('❌ Voice Cloning Error:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers
            },
            stack: error.stack
        });
        
        // Log full error response for debugging
        if (error.response?.data) {
            console.error('📋 Full ElevenLabs error response:', JSON.stringify(error.response.data, null, 2));
        }
        
        // Provide more specific error messages
        let errorMessage = 'Failed to clone voice';
        if (error.response?.status === 401 || error.response?.status === 403) {
            errorMessage = 'ElevenLabs API authentication failed. Please check your API key.';
        } else if (error.response?.status === 400) {
            // Try to extract more details from ElevenLabs error
            const errorData = error.response?.data;
            if (errorData?.detail) {
                // ElevenLabs often provides detailed error in 'detail' field
                if (Array.isArray(errorData.detail)) {
                    errorMessage = errorData.detail.map((d) => d.msg || d.message || JSON.stringify(d)).join(', ');
                } else if (typeof errorData.detail === 'string') {
                    errorMessage = errorData.detail;
                } else {
                    errorMessage = JSON.stringify(errorData.detail);
                }
            } else if (errorData?.message) {
                errorMessage = errorData.message;
            } else {
                errorMessage = 'Invalid request. Please check your audio files. Supported formats: MP3, WAV, OGG. MPEG-4 may not be supported.';
            }
        } else if (error.response?.status === 429) {
            errorMessage = 'Rate limit exceeded. Please try again later.';
        } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            errorMessage = 'Request timeout. Voice cloning may take time, please try again.';
        } else if (error.response?.data?.message) {
            errorMessage = error.response.data.message;
        } else {
            errorMessage = error.message || 'Unknown error occurred';
        }
        
        res.status(error.response?.status || 500).json({
            message: errorMessage,
            error: error.response?.data || error.message,
            details: error.response?.data?.detail || null
        });
    }
});

// DELETE /clone/:voiceId - Delete a cloned voice
router.delete('/clone/:voiceId', async (req, res) => {
    try {
        const { voiceId } = req.params;
        const apiKey = process.env.ELEVENLABS_API_KEY;

        if (!apiKey) {
            return res.status(500).json({ message: 'ElevenLabs API key not configured' });
        }

        // Delete voice from ElevenLabs
        await axios.delete(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
            headers: {
                'xi-api-key': apiKey
            }
        });

        res.json({ success: true, message: 'Voice deleted successfully' });
    } catch (error) {
        console.error('Delete Voice Error:', error.response?.data || error.message);
        res.status(500).json({
            message: 'Failed to delete voice',
            error: error.response?.data?.message || error.message
        });
    }
});

module.exports = router;

