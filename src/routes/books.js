const express = require('express');
const router = express.Router();
const Book = require('../models/Book');
const mongoose = require('mongoose');
const { notifyNewBook } = require('../services/notificationService');

// GET all books (with pagination support)
router.get('/', async (req, res) => {
    try {
        // Wait for MongoDB connection if it's still connecting
        if (mongoose.connection.readyState === 0) {
            // Not connected yet, wait a bit
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        
        // Check connection state: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
        if (mongoose.connection.readyState !== 1) {
            // If still not connected, try to connect
            if (mongoose.connection.readyState === 0) {
                try {
                    await mongoose.connect(process.env.MONGO_URI);
                } catch (connectError) {
                    return res.status(503).json({ 
                        message: 'Database connection failed. Please check MONGO_URI in .env file.',
                        error: connectError.message
                    });
                }
            } else {
                return res.status(503).json({ 
                    message: 'Database is connecting. Please try again in a moment.',
                    error: 'Database connection in progress'
                });
            }
        }
        
        // Pagination parameters
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Max 100 per page
        const skip = (page - 1) * limit;
        
        // Filter parameters
        const filter = {};
        // Default to published books only, unless explicitly requesting all statuses
        // Portal can pass status=all to get everything, or status=draft for drafts only
        if (req.query.status === 'all') {
            // Don't filter by status - show all
        } else if (req.query.status) {
            filter.status = req.query.status;
        } else {
            // Default: only show published books in the main app
            filter.status = 'published';
        }
        if (req.query.categoryId) filter.categoryId = req.query.categoryId;
        
        // Get total count for pagination metadata
        const total = await Book.countDocuments(filter);
        
        // Fetch books with pagination
        const books = await Book.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(); // Use lean() for better performance - returns plain JS objects
        
        // Map books to include coverImage for backward compatibility
        const booksWithCoverImage = books.map(book => {
            // Add coverImage at root level from files.coverImage for backward compatibility
            if (book.files && book.files.coverImage) {
                book.coverImage = book.files.coverImage;
            } else if (!book.files) {
                // If files doesn't exist (old data), keep coverImage as is
                book.files = { coverImage: book.coverImage || null, images: [], videos: [], audio: [] };
            }
            return book;
        });
        
        // Return with pagination metadata
        res.json({
            data: booksWithCoverImage,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
                hasMore: page * limit < total
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET featured books for carousel
router.get('/featured', async (req, res) => {
    try {
        const books = await Book.find({ 
            isFeatured: true, 
            status: 'published' 
        }).sort({ featuredOrder: 1, createdAt: -1 });
        
        // Map books to include coverImage for backward compatibility
        const booksWithCoverImage = books.map(book => {
            const bookObj = book.toObject();
            if (bookObj.files && bookObj.files.coverImage) {
                bookObj.coverImage = bookObj.files.coverImage;
            } else if (!bookObj.files) {
                bookObj.files = { coverImage: bookObj.coverImage || null, images: [], videos: [], audio: [] };
            }
            return bookObj;
        });
        
        res.json(booksWithCoverImage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET top-rated books (15% or more likes/favorites to reads ratio)
router.get('/top-rated', async (req, res) => {
    try {
        const minRatio = parseFloat(req.query.minRatio) || 0.15; // Default 15%
        const minReads = parseInt(req.query.minReads) || 5; // Minimum reads to qualify
        
        const books = await Book.find({ 
            status: 'published',
            readCount: { $gte: minReads } // At least minReads to be considered
        });
        
        // Calculate rating ratio and filter
        const topRatedBooks = books
            .map(book => {
                const bookObj = book.toObject();
                const totalEngagement = (bookObj.likeCount || 0) + (bookObj.favoriteCount || 0);
                const ratio = bookObj.readCount > 0 ? totalEngagement / bookObj.readCount : 0;
                bookObj.ratingRatio = ratio;
                
                // Add coverImage for backward compatibility
                if (bookObj.files && bookObj.files.coverImage) {
                    bookObj.coverImage = bookObj.files.coverImage;
                }
                return bookObj;
            })
            .filter(book => book.ratingRatio >= minRatio)
            .sort((a, b) => b.ratingRatio - a.ratingRatio); // Sort by highest ratio first
        
        res.json(topRatedBooks);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// GET trending books (top books by recent play count within time window)
router.get('/trending', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const timeWindow = req.query.timeWindow || '7d'; // Default 7 days
        
        // Parse time window to milliseconds
        const windowMs = parseTimeWindow(timeWindow);
        const since = new Date(Date.now() - windowMs);
        
        // Import PlayEvent model
        const PlayEvent = require('../models/PlayEvent');
        
        // Get trending books based on recent play events
        const trendingCounts = await PlayEvent.aggregate([
            { 
                $match: { 
                    contentType: 'book',
                    playedAt: { $gte: since }
                } 
            },
            { 
                $group: { 
                    _id: '$contentId',
                    recentPlays: { $sum: 1 },
                    lastPlayed: { $max: '$playedAt' }
                } 
            },
            // Sort by plays (desc), then by lastPlayed (desc), then by _id for consistent ordering
            { $sort: { recentPlays: -1, lastPlayed: -1, _id: 1 } },
            { $limit: limit }
        ]);
        
        // If we have trending data, fetch the book details
        if (trendingCounts.length > 0) {
            const bookIds = trendingCounts.map(t => t._id);
            const books = await Book.find({ 
                _id: { $in: bookIds },
                status: 'published'
            }).lean();
            
            // Create a map for quick lookup
            const bookMap = {};
            books.forEach(book => {
                if (book.files && book.files.coverImage) {
                    book.coverImage = book.files.coverImage;
                }
                bookMap[book._id.toString()] = book;
            });
            
            // Sort by trending count and format
            const formattedBooks = trendingCounts
                .map(t => {
                    const book = bookMap[t._id.toString()];
                    if (book) {
                        return { ...book, recentPlays: t.recentPlays, lastPlayed: t.lastPlayed };
                    }
                    return null;
                })
                .filter(Boolean);
            
            console.log(`📚 Trending books (${timeWindow}): ${formattedBooks.length} items`);
            return res.json(formattedBooks);
        }
        
        // Fallback: If no recent play events, use readCount
        const books = await Book.find({ 
            status: 'published',
            readCount: { $gt: 0 }
        })
        .sort({ readCount: -1 })
        .limit(limit)
        .lean();
        
        const formattedBooks = books.map(book => {
            if (book.files && book.files.coverImage) {
                book.coverImage = book.files.coverImage;
            }
            return book;
        });
        
        console.log(`📚 Trending books (fallback): ${formattedBooks.length} items`);
        res.json(formattedBooks);
    } catch (error) {
        console.error('Error fetching trending books:', error);
        res.status(500).json({ message: error.message });
    }
});

// Helper to parse time window string to milliseconds
function parseTimeWindow(window) {
    const match = window.match(/^(\d+)(h|d|w|m)$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000; // Default 7 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'w': return value * 7 * 24 * 60 * 60 * 1000;
        case 'm': return value * 30 * 24 * 60 * 60 * 1000;
        default: return 7 * 24 * 60 * 60 * 1000;
    }
}

// GET single book
router.get('/:id', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });
        
        const bookObj = book.toObject();
        // Add coverImage at root level from files.coverImage for backward compatibility
        if (bookObj.files && bookObj.files.coverImage) {
            bookObj.coverImage = bookObj.files.coverImage;
        } else if (!bookObj.files) {
            // If files doesn't exist (old data), keep coverImage as is
            bookObj.files = { coverImage: bookObj.coverImage || null, images: [], videos: [], audio: [] };
        }
        
        res.json(bookObj);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST create book
router.post('/', async (req, res) => {
    try {
        console.log('Creating book with data:', JSON.stringify(req.body, null, 2));
        
        // Validate required fields
        if (!req.body.title) {
            return res.status(400).json({ message: 'Title is required' });
        }
        if (!req.body.author) {
            return res.status(400).json({ message: 'Author is required' });
        }
        
        const bookData = {
            title: req.body.title,
            author: req.body.author,
            description: req.body.description || '',
            minAge: req.body.minAge ? Number(req.body.minAge) : undefined,
            category: req.body.category || 'Other',
            status: req.body.status || 'draft',
            text: req.body.text || '',
            games: req.body.games || [],
            bookGames: req.body.bookGames || [],
            pages: req.body.pages || [],
        };
        
        // Always initialize files structure
        bookData.files = {
            coverImage: null,
            images: [],
            videos: [],
            audio: [],
        };
        
        // Handle coverImage - support both old and new structure
        if (req.body.coverImage) {
            bookData.files.coverImage = req.body.coverImage;
        }
        
        // If files object is provided, merge it (but keep arrays initialized)
        if (req.body.files) {
            if (req.body.files.coverImage) {
                bookData.files.coverImage = req.body.files.coverImage;
            }
            if (req.body.files.images) {
                bookData.files.images = req.body.files.images;
            }
            if (req.body.files.videos) {
                bookData.files.videos = req.body.files.videos;
            }
            if (req.body.files.audio) {
                bookData.files.audio = req.body.files.audio;
            }
        }

        console.log('Book data to save:', JSON.stringify(bookData, null, 2));
        const book = new Book(bookData);
        const newBook = await book.save();
        console.log('Book created successfully:', newBook._id);
        
        // Send notification if book is published
        if (newBook.status === 'published') {
            notifyNewBook(newBook).catch(err => console.error('Notification error:', err));
        }
        
        // Map coverImage for backward compatibility in response
        const bookObj = newBook.toObject();
        if (bookObj.files && bookObj.files.coverImage) {
            bookObj.coverImage = bookObj.files.coverImage;
        }
        
        res.status(201).json(bookObj);
    } catch (error) {
        console.error('Error creating book:', error);
        console.error('Error details:', error.name, error.message);
        if (error.errors) {
            console.error('Validation errors:', JSON.stringify(error.errors, null, 2));
        }
        res.status(400).json({ 
            message: error.message, 
            error: error.name,
            details: error.errors || error
        });
    }
});

// PUT update book
router.put('/:id', async (req, res) => {
    try {
        console.log('PUT /api/books/:id - Updating book:', req.params.id);
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        // Initialize files object if it doesn't exist
        if (!book.files) {
            book.files = { coverImage: null, images: [], videos: [], audio: [] };
        }

        // Handle files object - ensure proper structure
        if (req.body.files) {
            // If files.coverImage is explicitly provided, use it
            if (req.body.files.coverImage !== undefined) {
                book.files.coverImage = req.body.files.coverImage || null;
                console.log('Updated coverImage from files.coverImage:', book.files.coverImage);
            }
            // Otherwise, if root coverImage is provided, use it
            else if (req.body.coverImage !== undefined) {
                book.files.coverImage = req.body.coverImage || null;
                console.log('Updated coverImage from root coverImage:', book.files.coverImage);
            }
            
            if (req.body.files.images !== undefined) {
                book.files.images = req.body.files.images;
            }
            if (req.body.files.videos !== undefined) {
                book.files.videos = req.body.files.videos;
            }
            if (req.body.files.audio !== undefined) {
                book.files.audio = req.body.files.audio;
            }
            delete req.body.files; // Remove from body to avoid duplicate assignment
        }
        // Handle coverImage at root level if files object was not provided
        else if (req.body.coverImage !== undefined) {
            book.files.coverImage = req.body.coverImage || null;
            console.log('Updated coverImage from root (no files object):', book.files.coverImage);
        }
        
        // Remove coverImage from body to avoid duplicate assignment
        delete req.body.coverImage;

        // Handle pages array
        if (req.body.pages !== undefined) {
            book.pages = req.body.pages || [];
            delete req.body.pages; // Remove from body to avoid duplicate assignment
        }

        // Handle bookVideos separately
        if (req.body.bookVideos !== undefined) {
            book.bookVideos = req.body.bookVideos;
            delete req.body.bookVideos;
        }
        
        // Handle bookGames separately
        if (req.body.bookGames !== undefined) {
            book.bookGames = req.body.bookGames;
            delete req.body.bookGames;
        }
        
        // Update all other fields
        Object.assign(book, req.body);
        
        // Check if status is changing to published
        const wasPublished = book.status === 'published';
        
        console.log('Book before save - files.coverImage:', book.files?.coverImage);
        const updatedBook = await book.save();
        console.log('Book after save - files.coverImage:', updatedBook.files?.coverImage);
        
        // Send notification if book was just published (status changed to published)
        if (!wasPublished && updatedBook.status === 'published') {
            notifyNewBook(updatedBook).catch(err => console.error('Notification error:', err));
        }
        
        // Map coverImage for backward compatibility in response
        const bookObj = updatedBook.toObject();
        if (bookObj.files && bookObj.files.coverImage) {
            bookObj.coverImage = bookObj.files.coverImage;
        }
        
        console.log('Sending response - coverImage:', bookObj.coverImage);
        res.json(bookObj);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE delete book
router.delete('/:id', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        await book.deleteOne();
        res.json({ message: 'Book deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST increment view count (called when a user OPENS a book)
router.post('/:id/view', async (req, res) => {
    try {
        const book = await Book.findByIdAndUpdate(
            req.params.id,
            { $inc: { viewCount: 1, totalReadSessions: 1 } },
            { new: true }
        );
        
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        
        console.log(`👁️ Book "${book.title}" viewed - viewCount: ${book.viewCount}`);
        res.json({ 
            viewCount: book.viewCount,
            readCount: book.readCount,
            likeCount: book.likeCount,
            favoriteCount: book.favoriteCount
        });
    } catch (error) {
        console.error('Error incrementing view count:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST increment read count (called when a user COMPLETES reading a book)
router.post('/:id/read', async (req, res) => {
    try {
        const book = await Book.findByIdAndUpdate(
            req.params.id,
            { $inc: { readCount: 1 } },
            { new: true }
        );
        
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        
        console.log(`📖 Book "${book.title}" read completed - readCount: ${book.readCount}`);
        res.json({ readCount: book.readCount });
    } catch (error) {
        console.error('Error incrementing read count:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST increment like count
router.post('/:id/like', async (req, res) => {
    try {
        const { action } = req.body; // 'add' or 'remove'
        const increment = action === 'remove' ? -1 : 1;
        
        const book = await Book.findByIdAndUpdate(
            req.params.id,
            { $inc: { likeCount: increment } },
            { new: true }
        );
        
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        
        // Ensure count doesn't go negative
        if (book.likeCount < 0) {
            book.likeCount = 0;
            await book.save();
        }
        
        console.log(`👍 Book "${book.title}" like count: ${book.likeCount}`);
        res.json({ likeCount: book.likeCount });
    } catch (error) {
        console.error('Error updating like count:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST increment favorite count
router.post('/:id/favorite', async (req, res) => {
    try {
        const { action } = req.body; // 'add' or 'remove'
        const increment = action === 'remove' ? -1 : 1;
        
        const book = await Book.findByIdAndUpdate(
            req.params.id,
            { $inc: { favoriteCount: increment } },
            { new: true }
        );
        
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        
        // Ensure count doesn't go negative
        if (book.favoriteCount < 0) {
            book.favoriteCount = 0;
            await book.save();
        }
        
        console.log(`❤️ Book "${book.title}" favorite count: ${book.favoriteCount}`);
        res.json({ favoriteCount: book.favoriteCount });
    } catch (error) {
        console.error('Error updating favorite count:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
