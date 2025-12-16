const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
    // Basic book information
    title: {
        type: String,
        required: true,
    },
    author: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    minAge: {
        type: Number,
        min: 0,
        max: 18,
    },
    category: {
        type: String,
        default: 'Other',
    },
    categories: {
        type: [String],
        default: [],
    },
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft',
    },
    
    // Book orientation - portrait (default) or landscape
    orientation: {
        type: String,
        enum: ['portrait', 'landscape'],
        default: 'portrait',
    },
    
    // Access control - whether content requires membership
    isMembersOnly: {
        type: Boolean,
        default: false,
    },
    
    // Featured on explore page carousel
    isFeatured: {
        type: Boolean,
        default: false,
    },
    
    // Order in the featured carousel (lower = first)
    featuredOrder: {
        type: Number,
        default: 0,
    },
    
    // Global read count (incremented when any user completes the book)
    readCount: {
        type: Number,
        default: 0,
    },
    
    // Global favorite count
    favoriteCount: {
        type: Number,
        default: 0,
    },
    
    // Global like count (for top rated calculation)
    likeCount: {
        type: Number,
        default: 0,
    },
    
    // Organized file structure per book
    files: {
        type: {
            // Cover image (single)
            coverImage: {
                type: String, // URL to GCS: books/{bookId}/cover/filename
                default: null,
            },
            
            // Images collection (for book-level images)
            images: {
                type: [{
                    url: { type: String }, // URL to GCS: books/{bookId}/images/filename
                    filename: { type: String },
                    uploadedAt: { type: Date, default: Date.now },
                }],
                default: [],
            },
            
            // Videos collection (for book-level videos)
            videos: {
                type: [{
                    url: { type: String }, // URL to GCS: books/{bookId}/videos/filename
                    filename: { type: String },
                    uploadedAt: { type: Date, default: Date.now },
                }],
                default: [],
            },
            
            // Audio files collection (for book-level audio)
            audio: {
                type: [{
                    url: { type: String }, // URL to GCS: books/{bookId}/audio/filename
                    filename: { type: String },
                    uploadedAt: { type: Date, default: Date.now },
                }],
                default: [],
            },
        },
        default: () => ({
            coverImage: null,
            images: [],
            videos: [],
            audio: [],
        }),
    },
    
    // Pages array - embedded pages for this book
    pages: {
        type: [{
            pageNumber: {
                type: Number,
                required: true,
            },
            
            // Page content - organized structure
            content: {
                // Text content on the page
                text: {
                    type: String,
                },
                
                // Text boxes with styling
                textBoxes: [{
                    text: String,
                    x: Number, // percentage (0-100)
                    y: Number, // percentage (0-100)
                    width: { type: Number, default: 30 }, // percentage (0-100)
                    alignment: { type: String, enum: ['left', 'center', 'right'], default: 'left' },
                    fontFamily: { type: String, default: 'Comic Sans MS' },
                    fontSize: { type: Number, default: 24 },
                    color: { type: String, default: '#4a3b2a' },
                }],
            },
            
            // Page files - organized per page
            files: {
                // Background (image or video)
                background: {
                    url: { type: String }, // URL to GCS: books/{bookId}/pages/page-{pageNumber}.{ext}
                    type: { type: String, enum: ['image', 'video'] },
                },
                
                // Scroll overlay image
                scroll: {
                    url: { type: String }, // URL to GCS: books/{bookId}/scroll/filename
                    height: { type: Number }, // Height in px for scroll overlay
                },
                
                // Page-specific images
                images: [{
                    url: { type: String }, // URL to GCS: books/{bookId}/pages/images/filename
                    filename: { type: String },
                    uploadedAt: { type: Date, default: Date.now },
                }],
                
                // Page-specific videos
                videos: [{
                    url: { type: String }, // URL to GCS: books/{bookId}/pages/videos/filename
                    filename: { type: String },
                    uploadedAt: { type: Date, default: Date.now },
                }],
                
                // Audio narration for this page
                audio: {
                    url: { type: String }, // URL to GCS: books/{bookId}/audio/page-{pageNumber}.mp3
                    filename: { type: String },
                    uploadedAt: { type: Date, default: Date.now },
                },
                
                // Sound effect for this page (1-3 seconds, plays on bubble tap)
                soundEffect: {
                    url: { type: String }, // URL to GCS: books/{bookId}/sound-effects/page-{pageNumber}.mp3
                    filename: { type: String },
                    uploadedAt: { type: Date, default: Date.now },
                },
            },
            
            // Legacy fields (for backward compatibility)
            imageUrl: { type: String },
            audioUrl: { type: String },
            backgroundUrl: { type: String },
            backgroundType: { type: String, enum: ['image', 'video'] },
            scrollUrl: { type: String },
            scrollHeight: { type: Number },
            
            createdAt: {
                type: Date,
                default: Date.now,
            },
            updatedAt: {
                type: Date,
                default: Date.now,
            },
        }],
        default: [],
    },
    
    // Book-level text content
    text: {
        type: String, // Any book-level text content
    },
    
    // Associated games (array of game IDs)
    games: {
        type: [String], // Array of gameId values (e.g., ['prayer', 'challenge', 'strength'])
        default: [],
    },
    
    // Book-specific games (webview-based games that unlock after reading)
    bookGames: {
        type: [{
            _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
            title: { type: String, required: true },
            url: { type: String, required: true },
            coverImage: { type: String }, // URL to cover image
            description: { type: String },
            createdAt: { type: Date, default: Date.now },
        }],
        default: [],
    },
    
    // Book-specific videos (MP4 videos that unlock after reading)
    bookVideos: {
        type: [{
            _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
            title: { type: String, required: true },
            videoUrl: { type: String, required: true }, // URL to MP4 video file
            thumbnailUrl: { type: String }, // URL to thumbnail image
            description: { type: String },
            createdAt: { type: Date, default: Date.now },
        }],
        default: [],
    },
    
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Update updatedAt on save
bookSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    if (typeof next === 'function') {
        next();
    }
});

module.exports = mongoose.model('Book', bookSchema);
