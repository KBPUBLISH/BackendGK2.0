const express = require('express');
const router = express.Router();
const Page = require('../models/Page');

// GET all pages for a book
router.get('/book/:bookId', async (req, res) => {
    try {
        const pages = await Page.find({ bookId: req.params.bookId }).sort({ pageNumber: 1 });
        
        // Map pages to include textBoxes at root level for backward compatibility
        const pagesWithTextBoxes = pages.map(page => {
            const pageObj = page.toObject();
            // Map content.textBoxes to textBoxes for backward compatibility
            if (pageObj.content && pageObj.content.textBoxes) {
                pageObj.textBoxes = pageObj.content.textBoxes;
            }
            return pageObj;
        });
        
        res.json(pagesWithTextBoxes);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST create page
router.post('/', async (req, res) => {
    const pageData = {
        bookId: req.body.bookId,
        pageNumber: req.body.pageNumber,
    };
    
    // New organized structure - always initialize content
    pageData.content = {
        text: req.body.content?.text || req.body.content || req.body.text || '',
        textBoxes: req.body.content?.textBoxes || req.body.textBoxes || [],
    };
    
    // Files structure
    if (req.body.files) {
        pageData.files = req.body.files;
    } else {
        // Map legacy fields to new structure for backward compatibility
        pageData.files = {
            background: {
                url: req.body.backgroundUrl,
                type: req.body.backgroundType,
            },
            scroll: {
                url: req.body.scrollUrl,
                height: req.body.scrollHeight,
            },
            images: [],
            videos: [],
            audio: {
                url: req.body.audioUrl,
            },
        };
    }
    
    // Legacy fields (for backward compatibility)
    pageData.imageUrl = req.body.imageUrl;
    pageData.audioUrl = req.body.audioUrl;
    pageData.backgroundUrl = req.body.backgroundUrl;
    pageData.backgroundType = req.body.backgroundType;
    pageData.scrollUrl = req.body.scrollUrl;
    pageData.scrollHeight = req.body.scrollHeight;
    pageData.textBoxes = req.body.textBoxes; // Legacy

    // Check if page with this pageNumber already exists for this book
    const existingPage = await Page.findOne({ 
        bookId: pageData.bookId, 
        pageNumber: pageData.pageNumber 
    });
    
    if (existingPage) {
        return res.status(400).json({ 
            message: `Page number ${pageData.pageNumber} already exists for this book. Please choose a different page number or update the existing page.`,
            error: 'DUPLICATE_PAGE_NUMBER',
            existingPageId: existingPage._id
        });
    }

    const page = new Page(pageData);

    try {
        const newPage = await page.save();
        
        // Map response for backward compatibility
        const pageObj = newPage.toObject();
        if (pageObj.content) {
            if (pageObj.content.textBoxes) {
                pageObj.textBoxes = pageObj.content.textBoxes;
            }
            // Also ensure textBoxes is always present in response
            if (!pageObj.textBoxes) {
                pageObj.textBoxes = pageObj.content.textBoxes || [];
            }
        }
        
        res.status(201).json(pageObj);
    } catch (error) {
        console.error('Error saving page:', error);
        if (error.code === 11000) {
            // Duplicate key error
            return res.status(400).json({ 
                message: `Page number ${pageData.pageNumber} already exists for this book. Please choose a different page number.`,
                error: 'DUPLICATE_PAGE_NUMBER'
            });
        }
        res.status(400).json({ message: error.message });
    }
});

// PUT update page
router.put('/:id', async (req, res) => {
    try {
        const page = await Page.findById(req.params.id);
        if (!page) return res.status(404).json({ message: 'Page not found' });

        // Check if pageNumber is being changed and if it would create a duplicate
        if (req.body.pageNumber !== undefined && req.body.pageNumber !== page.pageNumber) {
            const existingPage = await Page.findOne({ 
                bookId: page.bookId, 
                pageNumber: req.body.pageNumber,
                _id: { $ne: page._id } // Exclude current page
            });
            if (existingPage) {
                return res.status(400).json({ 
                    message: `Page number ${req.body.pageNumber} already exists for this book. Please choose a different page number.` 
                });
            }
        }

        // Map legacy fields to new structure if needed
        if (req.body.backgroundUrl && !req.body.files) {
            if (!page.files) {
                page.files = { images: [], videos: [], audio: {} };
            }
            if (!page.files.background) {
                page.files.background = {};
            }
            page.files.background.url = req.body.backgroundUrl;
            page.files.background.type = req.body.backgroundType;
        }
        
        if (req.body.scrollUrl && !req.body.files) {
            if (!page.files) {
                page.files = { images: [], videos: [], audio: {} };
            }
            if (!page.files.scroll) {
                page.files.scroll = {};
            }
            page.files.scroll.url = req.body.scrollUrl;
            page.files.scroll.height = req.body.scrollHeight;
        }

        // Handle textBoxes - map to content.textBoxes in new structure
        if (req.body.textBoxes !== undefined) {
            if (!page.content) {
                page.content = { text: '', textBoxes: [] };
            }
            page.content.textBoxes = req.body.textBoxes;
            // Also keep legacy field for backward compatibility
            page.textBoxes = req.body.textBoxes;
        }

        // Handle content.textBoxes if provided directly
        if (req.body.content && req.body.content.textBoxes !== undefined) {
            if (!page.content) {
                page.content = { text: '', textBoxes: [] };
            }
            page.content.textBoxes = req.body.content.textBoxes;
            page.textBoxes = req.body.content.textBoxes; // Legacy
        }

        // Handle files.soundEffect if provided
        if (req.body.files && req.body.files.soundEffect !== undefined) {
            if (!page.files) {
                page.files = { images: [], videos: [], audio: {} };
            }
            page.files.soundEffect = req.body.files.soundEffect;
        }

        // Update all other fields (but don't overwrite what we just set)
        const { textBoxes, content, ...otherFields } = req.body;
        Object.assign(page, otherFields);
        
        // Handle content.text if provided
        if (content && content.text !== undefined) {
            if (!page.content) {
                page.content = { text: '', textBoxes: page.content?.textBoxes || [] };
            }
            page.content.text = content.text;
        }

        const updatedPage = await page.save();
        
        // Map response for backward compatibility
        const pageObj = updatedPage.toObject();
        if (pageObj.content && pageObj.content.textBoxes) {
            pageObj.textBoxes = pageObj.content.textBoxes;
        }
        
        res.json(pageObj);
    } catch (error) {
        console.error('Error updating page:', error);
        if (error.code === 11000) {
            // Duplicate key error
            return res.status(400).json({ 
                message: `Page number ${req.body.pageNumber} already exists for this book. Please choose a different page number.`,
                error: 'DUPLICATE_PAGE_NUMBER'
            });
        }
        res.status(400).json({ message: error.message });
    }
});

// DELETE delete page
router.delete('/:id', async (req, res) => {
    try {
        const page = await Page.findById(req.params.id);
        if (!page) return res.status(404).json({ message: 'Page not found' });

        await page.deleteOne();
        res.json({ message: 'Page deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
