const express = require('express');
const router = express.Router();
const BookSeries = require('../models/BookSeries');
const Book = require('../models/Book');

/**
 * GET /api/book-series
 * Get all book series (optionally filter by status)
 */
router.get('/', async (req, res) => {
    try {
        const { status, category, featured } = req.query;
        
        // Build query
        const query = {};
        
        // Default to published for app, allow 'all' for portal
        if (status === 'all') {
            // No filter - return all
        } else if (status) {
            query.status = status;
        } else {
            query.status = 'published';
        }
        
        if (category) {
            query.category = category;
        }
        
        if (featured === 'true') {
            query.isFeatured = true;
        }
        
        const series = await BookSeries.find(query)
            .populate('category', 'name')
            .populate({
                path: 'books.book',
                select: 'title coverImage files author description minAge maxAge isMembersOnly status',
            })
            .sort({ displayOrder: 1, createdAt: -1 });
        
        res.json(series);
    } catch (error) {
        console.error('Error fetching book series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/book-series/featured
 * Get featured book series
 */
router.get('/featured', async (req, res) => {
    try {
        const series = await BookSeries.find({ 
            status: 'published',
            isFeatured: true 
        })
            .populate('category', 'name')
            .populate({
                path: 'books.book',
                select: 'title coverImage files author description minAge maxAge isMembersOnly',
            })
            .sort({ displayOrder: 1 })
            .limit(10);
        
        res.json(series);
    } catch (error) {
        console.error('Error fetching featured book series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/book-series/:id
 * Get a single book series by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const series = await BookSeries.findById(req.params.id)
            .populate('category', 'name')
            .populate({
                path: 'books.book',
                select: 'title coverImage files author description minAge maxAge isMembersOnly status pages',
                populate: {
                    path: 'pages',
                    select: 'pageNumber',
                }
            });
        
        if (!series) {
            return res.status(404).json({ error: 'Book series not found' });
        }
        
        // Increment view count
        await BookSeries.findByIdAndUpdate(req.params.id, { $inc: { viewCount: 1 } });
        
        res.json(series);
    } catch (error) {
        console.error('Error fetching book series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/book-series
 * Create a new book series
 */
router.post('/', async (req, res) => {
    try {
        const {
            title,
            description,
            coverImage,
            books,
            minAge,
            maxAge,
            level,
            category,
            status,
            isMembersOnly,
            isFeatured,
            displayOrder,
            author,
        } = req.body;
        
        if (!title || !coverImage) {
            return res.status(400).json({ error: 'Title and cover image are required' });
        }
        
        // Format books array with order
        const formattedBooks = (books || []).map((bookId, index) => ({
            book: bookId,
            order: index,
        }));
        
        const series = new BookSeries({
            title,
            description,
            coverImage,
            books: formattedBooks,
            minAge: minAge || 0,
            maxAge: maxAge || 12,
            level: level || 'all',
            category,
            status: status || 'draft',
            isMembersOnly: isMembersOnly || false,
            isFeatured: isFeatured || false,
            displayOrder: displayOrder || 0,
            author,
        });
        
        await series.save();
        
        // Populate the response
        const populatedSeries = await BookSeries.findById(series._id)
            .populate('category', 'name')
            .populate({
                path: 'books.book',
                select: 'title coverImage files author',
            });
        
        res.status(201).json(populatedSeries);
    } catch (error) {
        console.error('Error creating book series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /api/book-series/:id
 * Update a book series
 */
router.put('/:id', async (req, res) => {
    try {
        const {
            title,
            description,
            coverImage,
            books,
            minAge,
            maxAge,
            level,
            category,
            status,
            isMembersOnly,
            isFeatured,
            displayOrder,
            author,
        } = req.body;
        
        const series = await BookSeries.findById(req.params.id);
        
        if (!series) {
            return res.status(404).json({ error: 'Book series not found' });
        }
        
        // Update fields
        if (title !== undefined) series.title = title;
        if (description !== undefined) series.description = description;
        if (coverImage !== undefined) series.coverImage = coverImage;
        if (minAge !== undefined) series.minAge = minAge;
        if (maxAge !== undefined) series.maxAge = maxAge;
        if (level !== undefined) series.level = level;
        if (category !== undefined) series.category = category;
        if (status !== undefined) series.status = status;
        if (isMembersOnly !== undefined) series.isMembersOnly = isMembersOnly;
        if (isFeatured !== undefined) series.isFeatured = isFeatured;
        if (displayOrder !== undefined) series.displayOrder = displayOrder;
        if (author !== undefined) series.author = author;
        
        // Update books array with order
        if (books !== undefined) {
            series.books = books.map((bookId, index) => ({
                book: typeof bookId === 'object' ? bookId.book || bookId._id : bookId,
                order: index,
            }));
            series.markModified('books');
        }
        
        await series.save();
        
        // Populate the response
        const populatedSeries = await BookSeries.findById(series._id)
            .populate('category', 'name')
            .populate({
                path: 'books.book',
                select: 'title coverImage files author description minAge maxAge isMembersOnly',
            });
        
        res.json(populatedSeries);
    } catch (error) {
        console.error('Error updating book series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/book-series/:id
 * Delete a book series
 */
router.delete('/:id', async (req, res) => {
    try {
        const series = await BookSeries.findByIdAndDelete(req.params.id);
        
        if (!series) {
            return res.status(404).json({ error: 'Book series not found' });
        }
        
        res.json({ message: 'Book series deleted successfully' });
    } catch (error) {
        console.error('Error deleting book series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/book-series/:id/add-book
 * Add a book to a series
 */
router.post('/:id/add-book', async (req, res) => {
    try {
        const { bookId } = req.body;
        
        if (!bookId) {
            return res.status(400).json({ error: 'Book ID is required' });
        }
        
        const series = await BookSeries.findById(req.params.id);
        
        if (!series) {
            return res.status(404).json({ error: 'Book series not found' });
        }
        
        // Check if book exists
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ error: 'Book not found' });
        }
        
        // Check if book already in series
        const existingBook = series.books.find(b => b.book.toString() === bookId);
        if (existingBook) {
            return res.status(400).json({ error: 'Book already in series' });
        }
        
        // Add book at the end
        const newOrder = series.books.length;
        series.books.push({ book: bookId, order: newOrder });
        
        await series.save();
        
        const populatedSeries = await BookSeries.findById(series._id)
            .populate({
                path: 'books.book',
                select: 'title coverImage files author',
            });
        
        res.json(populatedSeries);
    } catch (error) {
        console.error('Error adding book to series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/book-series/:id/remove-book
 * Remove a book from a series
 */
router.post('/:id/remove-book', async (req, res) => {
    try {
        const { bookId } = req.body;
        
        if (!bookId) {
            return res.status(400).json({ error: 'Book ID is required' });
        }
        
        const series = await BookSeries.findById(req.params.id);
        
        if (!series) {
            return res.status(404).json({ error: 'Book series not found' });
        }
        
        // Remove book
        series.books = series.books.filter(b => b.book.toString() !== bookId);
        
        // Re-order remaining books
        series.books = series.books.map((b, index) => ({
            book: b.book,
            order: index,
        }));
        
        await series.save();
        
        const populatedSeries = await BookSeries.findById(series._id)
            .populate({
                path: 'books.book',
                select: 'title coverImage files author',
            });
        
        res.json(populatedSeries);
    } catch (error) {
        console.error('Error removing book from series:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/book-series/:id/reorder
 * Reorder books in a series
 */
router.post('/:id/reorder', async (req, res) => {
    try {
        const { bookIds } = req.body;
        
        if (!bookIds || !Array.isArray(bookIds)) {
            return res.status(400).json({ error: 'bookIds array is required' });
        }
        
        const series = await BookSeries.findById(req.params.id);
        
        if (!series) {
            return res.status(404).json({ error: 'Book series not found' });
        }
        
        // Reorder books based on the new order
        series.books = bookIds.map((bookId, index) => ({
            book: bookId,
            order: index,
        }));
        
        await series.save();
        
        const populatedSeries = await BookSeries.findById(series._id)
            .populate({
                path: 'books.book',
                select: 'title coverImage files author',
            });
        
        res.json(populatedSeries);
    } catch (error) {
        console.error('Error reordering books in series:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

