const express = require('express');
const router = express.Router();
const Book = require('../models/Book');
const mongoose = require('mongoose');
const { notifyNewBook } = require('../services/notificationService');

// GET all books
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
        
        const books = await Book.find().sort({ createdAt: -1 });
        
        // Map books to include coverImage for backward compatibility
        const booksWithCoverImage = books.map(book => {
            const bookObj = book.toObject();
            // Add coverImage at root level from files.coverImage for backward compatibility
            if (bookObj.files && bookObj.files.coverImage) {
                bookObj.coverImage = bookObj.files.coverImage;
            } else if (!bookObj.files) {
                // If files doesn't exist (old data), keep coverImage as is
                bookObj.files = { coverImage: bookObj.coverImage || null, images: [], videos: [], audio: [] };
            }
            return bookObj;
        });
        
        res.json(booksWithCoverImage);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

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

module.exports = router;
