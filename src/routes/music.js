const express = require('express');
const router = express.Router();
const Music = require('../models/Music');
const multer = require('multer');
const { bucket } = require('../config/storage');
const path = require('path');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size for audio
  },
  fileFilter: (req, file, cb) => {
    // Accept audio files only
    const allowedMimes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/aac'];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|ogg|m4a|aac)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// Health check for music routes
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    route: 'music',
    bucketConfigured: !!bucket,
    bucketName: bucket ? bucket.name : 'not configured'
  });
});

// Get all music entries
router.get('/', async (req, res) => {
  try {
    const music = await Music.find().sort({ target: 1 });
    res.json(music);
  } catch (error) {
    console.error('Error fetching music:', error);
    res.status(500).json({ error: 'Failed to fetch music' });
  }
});

// Get music by target (for the app to fetch specific music)
router.get('/target/:target', async (req, res) => {
  try {
    const music = await Music.findOne({ 
      target: req.params.target,
      isActive: true 
    });
    
    if (!music) {
      return res.status(404).json({ error: 'Music not found for this target' });
    }
    
    res.json(music);
  } catch (error) {
    console.error('Error fetching music by target:', error);
    res.status(500).json({ error: 'Failed to fetch music' });
  }
});

// Get all active music (for the app to fetch all music at once)
router.get('/active', async (req, res) => {
  try {
    const music = await Music.find({ isActive: true });
    
    // Return as a map of target -> music data for easy lookup
    const musicMap = {};
    music.forEach(m => {
      musicMap[m.target] = {
        audioUrl: m.audioUrl,
        defaultVolume: m.defaultVolume,
        loop: m.loop,
        name: m.name
      };
    });
    
    res.json(musicMap);
  } catch (error) {
    console.error('Error fetching active music:', error);
    res.status(500).json({ error: 'Failed to fetch active music' });
  }
});

// Create or update music entry with file upload
router.post('/upload', upload.single('audio'), async (req, res) => {
  try {
    console.log('📤 Music upload request received');
    console.log('Body:', req.body);
    console.log('File:', req.file ? { name: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : 'No file');
    
    const { target, name, description, defaultVolume, loop } = req.body;
    
    if (!target || !name) {
      console.log('❌ Missing target or name');
      return res.status(400).json({ error: 'Target and name are required' });
    }
    
    if (!req.file) {
      console.log('❌ No audio file provided');
      return res.status(400).json({ error: 'Audio file is required' });
    }
    
    // Check if bucket is configured
    if (!bucket) {
      console.error('❌ GCS bucket not configured');
      return res.status(500).json({ error: 'Storage not configured. Please check GCS credentials.' });
    }
    
    // Generate unique filename
    const timestamp = Date.now();
    const ext = path.extname(req.file.originalname) || '.mp3';
    const filename = `music/${target}-${timestamp}${ext}`;
    
    console.log(`📁 Uploading to GCS: ${filename}`);
    
    // Upload to GCS
    const blob = bucket.file(filename);
    const blobStream = blob.createWriteStream({
      resumable: false,
      contentType: req.file.mimetype,
      metadata: {
        cacheControl: 'public, max-age=31536000',
      }
    });
    
    blobStream.on('error', (error) => {
      console.error('❌ GCS Upload error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to upload file to storage', details: error.message });
      }
    });
    
    blobStream.on('finish', async () => {
      try {
        // Make the file publicly accessible
        await blob.makePublic();
        
        const audioUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
        
        // Create or update the music entry
        const musicData = {
          target,
          name,
          description: description || '',
          audioUrl,
          originalFilename: req.file.originalname,
          fileSize: req.file.size,
          defaultVolume: parseFloat(defaultVolume) || 0.5,
          loop: loop === 'true' || loop === true,
          isActive: true
        };
        
        const music = await Music.findOneAndUpdate(
          { target },
          musicData,
          { upsert: true, new: true }
        );
        
        console.log(`✅ Music uploaded for target "${target}": ${audioUrl}`);
        res.json(music);
      } catch (dbError) {
        console.error('❌ Database error:', dbError);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to save music data', details: dbError.message });
        }
      }
    });
    
    blobStream.end(req.file.buffer);
    
  } catch (error) {
    console.error('Error uploading music:', error);
    res.status(500).json({ error: 'Failed to upload music' });
  }
});

// Update music settings (without re-uploading file)
router.put('/:id', async (req, res) => {
  try {
    const { name, description, defaultVolume, loop, isActive } = req.body;
    
    const music = await Music.findByIdAndUpdate(
      req.params.id,
      {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(defaultVolume !== undefined && { defaultVolume: parseFloat(defaultVolume) }),
        ...(loop !== undefined && { loop }),
        ...(isActive !== undefined && { isActive })
      },
      { new: true }
    );
    
    if (!music) {
      return res.status(404).json({ error: 'Music not found' });
    }
    
    res.json(music);
  } catch (error) {
    console.error('Error updating music:', error);
    res.status(500).json({ error: 'Failed to update music' });
  }
});

// Delete music entry
router.delete('/:id', async (req, res) => {
  try {
    const music = await Music.findByIdAndDelete(req.params.id);
    
    if (!music) {
      return res.status(404).json({ error: 'Music not found' });
    }
    
    // Optionally delete the file from GCS
    if (music.audioUrl) {
      try {
        const filename = music.audioUrl.split(`${bucket.name}/`)[1];
        if (filename) {
          await bucket.file(filename).delete();
          console.log(`🗑️ Deleted music file: ${filename}`);
        }
      } catch (deleteError) {
        console.warn('Could not delete file from GCS:', deleteError.message);
      }
    }
    
    res.json({ message: 'Music deleted successfully' });
  } catch (error) {
    console.error('Error deleting music:', error);
    res.status(500).json({ error: 'Failed to delete music' });
  }
});

// Get available targets (for dropdown in portal)
router.get('/targets', async (req, res) => {
  const targets = [
    { value: 'app-background', label: 'App Background Music', description: 'Main background music that plays throughout the app' },
    { value: 'game-strength', label: 'Game Strength Modal', description: 'Music for the game strength/power-up modal' },
    { value: 'onboarding', label: 'Onboarding Flow', description: 'Music during the onboarding experience' },
    { value: 'lesson-complete', label: 'Lesson Complete', description: 'Celebration music when a lesson is completed' },
    { value: 'achievement', label: 'Achievement Unlocked', description: 'Sound effect when an achievement is unlocked' },
    { value: 'coin-reward', label: 'Coin Reward', description: 'Sound effect when coins are awarded' },
    { value: 'level-up', label: 'Level Up', description: 'Celebration music for leveling up' },
    { value: 'menu', label: 'Menu Music', description: 'Background music for menus and navigation' },
  ];
  
  res.json(targets);
});

module.exports = router;

