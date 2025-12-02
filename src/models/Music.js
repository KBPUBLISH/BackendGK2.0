const mongoose = require('mongoose');

const musicSchema = new mongoose.Schema({
  // Unique identifier for where this music is used
  target: {
    type: String,
    required: true,
    unique: true,
    enum: [
      'app-background',      // Main app background music (plays throughout the app)
      'game-strength',       // Game strength modal music
      'onboarding',          // Onboarding flow music
      'lesson-complete',     // Lesson completion celebration
      'achievement',         // Achievement unlocked sound
      'coin-reward',         // Coin reward sound effect
      'level-up',            // Level up celebration
      'menu',                // Menu/navigation music
      // Add more targets as needed
    ]
  },
  
  // Display name for the portal
  name: {
    type: String,
    required: true
  },
  
  // Description of where/when this music plays
  description: {
    type: String
  },
  
  // The audio file URL (stored in GCS)
  audioUrl: {
    type: String,
    required: true
  },
  
  // Original filename
  originalFilename: {
    type: String
  },
  
  // File size in bytes
  fileSize: {
    type: Number
  },
  
  // Duration in seconds (if known)
  duration: {
    type: Number
  },
  
  // Volume level (0.0 to 1.0) - default playback volume
  defaultVolume: {
    type: Number,
    default: 0.5,
    min: 0,
    max: 1
  },
  
  // Whether this music should loop
  loop: {
    type: Boolean,
    default: true
  },
  
  // Whether this music is currently active/enabled
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index for quick lookups by target
musicSchema.index({ target: 1 });

module.exports = mongoose.model('Music', musicSchema);

