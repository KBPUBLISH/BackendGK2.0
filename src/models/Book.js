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
    status: {
        type: String,
        enum: ['draft', 'published', 'archived'],
        default: 'draft',
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
    
    // Pages subfolder - references to Page documents
    // Pages are stored in separate collection but organized by bookId
    // This is handled via the Page model's bookId reference
    
    // Book-level text content
    text: {
        type: String, // Any book-level text content
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
