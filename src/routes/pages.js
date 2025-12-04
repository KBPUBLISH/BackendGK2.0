const express = require('express');
const router = express.Router();
const Page = require('../models/Page');

// GET all pages for a book
router.get('/book/:bookId', async (req, res) => {
    try {
        const pages = await Page.find({ bookId: req.params.bookId }).sort({ pageNumber: 1 });

        // Map pages to include textBoxes and legacy fields at root level for backward compatibility
        const pagesWithTextBoxes = pages.map(page => {
            const pageObj = page.toObject();
            // Map content.textBoxes to textBoxes for backward compatibility
            if (pageObj.content && pageObj.content.textBoxes) {
                pageObj.textBoxes = pageObj.content.textBoxes;
            }

            // Map files.background to legacy backgroundUrl and backgroundType
            if (pageObj.files && pageObj.files.background) {
                if (pageObj.files.background.url !== undefined) {
                    pageObj.backgroundUrl = pageObj.files.background.url;
                }
                if (pageObj.files.background.type !== undefined) {
                    pageObj.backgroundType = pageObj.files.background.type;
                }
            }

            // Map files.scroll to legacy scrollUrl and scrollHeight
            if (pageObj.files && pageObj.files.scroll) {
                if (pageObj.files.scroll.url !== undefined) {
                    pageObj.scrollUrl = pageObj.files.scroll.url;
                }
                if (pageObj.files.scroll.height !== undefined) {
                    pageObj.scrollHeight = pageObj.files.scroll.height;
                }
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

        // Ensure background is set if provided at top level
        if (req.body.backgroundUrl && (!pageData.files.background || !pageData.files.background.url)) {
            pageData.files.background = {
                url: req.body.backgroundUrl,
                type: req.body.backgroundType
            };
        }

        // Ensure scroll is set if provided at top level
        if (req.body.scrollUrl && (!pageData.files.scroll || !pageData.files.scroll.url)) {
            pageData.files.scroll = {
                url: req.body.scrollUrl,
                height: req.body.scrollHeight
            };
        }
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

    // Coloring page flags
    if (req.body.isColoringPage !== undefined) {
        pageData.isColoringPage = req.body.isColoringPage;
    }
    if (req.body.coloringEndModalOnly !== undefined) {
        pageData.coloringEndModalOnly = req.body.coloringEndModalOnly;
    }

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
        console.log('PUT /api/pages/:id - Updating page:', req.params.id);
        console.log('PUT /api/pages/:id - Full request body:', JSON.stringify(req.body, null, 2));
        
        const page = await Page.findById(req.params.id);
        if (!page) {
            console.error('PUT /api/pages/:id - Page not found:', req.params.id);
            return res.status(404).json({ message: 'Page not found' });
        }
        
        console.log('PUT /api/pages/:id - Found existing page:', {
            id: page._id,
            bookId: page.bookId,
            pageNumber: page.pageNumber
        });

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
        // Handle backgroundUrl - check if it's explicitly provided (even if empty)
        console.log('PUT /api/pages/:id - Request body:', {
            backgroundUrl: req.body.backgroundUrl,
            backgroundType: req.body.backgroundType,
            hasFiles: !!req.body.files,
            pageId: req.params.id
        });

        if (req.body.backgroundUrl !== undefined) {
            if (!page.files) {
                page.files = { images: [], videos: [], audio: {} };
            }
            if (!page.files.background) {
                page.files.background = {};
            }
            const newBackgroundUrl = req.body.backgroundUrl || null;
            page.files.background.url = newBackgroundUrl;
            if (req.body.backgroundType !== undefined) {
                page.files.background.type = req.body.backgroundType;
            }
            // Also update legacy field for backward compatibility
            page.backgroundUrl = newBackgroundUrl;
            if (req.body.backgroundType !== undefined) {
                page.backgroundType = req.body.backgroundType;
            }
            console.log('Updated background:', {
                url: page.files.background.url,
                type: page.files.background.type,
                legacyUrl: page.backgroundUrl,
                legacyType: page.backgroundType
            });
        }

        // Handle scrollUrl - check if it's explicitly provided (even if empty)
        if (req.body.scrollUrl !== undefined) {
            if (!page.files) {
                page.files = { images: [], videos: [], audio: {} };
            }
            if (!page.files.scroll) {
                page.files.scroll = {};
            }
            page.files.scroll.url = req.body.scrollUrl || null;
            if (req.body.scrollHeight !== undefined) {
                page.files.scroll.height = req.body.scrollHeight;
            }
            // Also update legacy field for backward compatibility
            page.scrollUrl = req.body.scrollUrl || null;
            if (req.body.scrollHeight !== undefined) {
                page.scrollHeight = req.body.scrollHeight;
            }
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

        // Handle coloring page flags explicitly
        if (req.body.isColoringPage !== undefined) {
            page.isColoringPage = req.body.isColoringPage;
            console.log('Updated isColoringPage:', page.isColoringPage);
        }
        if (req.body.coloringEndModalOnly !== undefined) {
            page.coloringEndModalOnly = req.body.coloringEndModalOnly;
            console.log('Updated coloringEndModalOnly:', page.coloringEndModalOnly);
        }

        // Update all other fields (but don't overwrite what we just set)
        // Exclude backgroundUrl, backgroundType, scrollUrl, scrollHeight, files, and coloring flags from otherFields
        const { textBoxes, content, backgroundUrl, backgroundType, scrollUrl, scrollHeight, files, isColoringPage, coloringEndModalOnly, ...otherFields } = req.body;
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

        // Map files.background to legacy backgroundUrl and backgroundType
        if (pageObj.files && pageObj.files.background) {
            if (pageObj.files.background.url !== undefined) {
                pageObj.backgroundUrl = pageObj.files.background.url;
            }
            if (pageObj.files.background.type !== undefined) {
                pageObj.backgroundType = pageObj.files.background.type;
            }
        }

        // Map files.scroll to legacy scrollUrl and scrollHeight
        if (pageObj.files && pageObj.files.scroll) {
            if (pageObj.files.scroll.url !== undefined) {
                pageObj.scrollUrl = pageObj.files.scroll.url;
            }
            if (pageObj.files.scroll.height !== undefined) {
                pageObj.scrollHeight = pageObj.files.scroll.height;
            }
        }

        console.log('Sending updated page response:', {
            id: pageObj._id,
            backgroundUrl: pageObj.backgroundUrl,
            backgroundType: pageObj.backgroundType,
            filesBackground: pageObj.files?.background?.url
        });

        res.json(pageObj);
    } catch (error) {
        console.error('Error updating page:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        
        if (error.code === 11000) {
            // Duplicate key error
            return res.status(400).json({
                message: `Page number ${req.body.pageNumber} already exists for this book. Please choose a different page number.`,
                error: 'DUPLICATE_PAGE_NUMBER'
            });
        }
        
        // Check for validation errors
        if (error.name === 'ValidationError') {
            const validationErrors = Object.keys(error.errors).map(key => ({
                field: key,
                message: error.errors[key].message,
                value: error.errors[key].value
            }));
            console.error('Validation errors:', validationErrors);
            return res.status(400).json({ 
                message: 'Validation error', 
                errors: validationErrors,
                details: error.message 
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
