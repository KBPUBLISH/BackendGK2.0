const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

// Get all categories
// Optional query params:
// - type: 'Book' or 'Audio' to filter by contentType
router.get('/', async (req, res) => {
    try {
        const { type } = req.query;
        
        // Build filter based on query params
        const filter = {};
        if (type) {
            // Map type query param to contentType field
            // Accept both 'book'/'audio' (lowercase) and 'Book'/'Audio' (proper case)
            const normalizedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
            if (normalizedType === 'Book') {
                // For 'Book' type, include categories with contentType='Book' OR no contentType (legacy)
                filter.$or = [
                    { contentType: 'Book' },
                    { contentType: { $exists: false } },
                    { contentType: null }
                ];
            } else if (normalizedType === 'Audio') {
                filter.contentType = 'Audio';
            }
        }
        
        const categories = await Category.find(filter).sort({ name: 1 });
        res.json(categories);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single category
router.get('/:id', async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json(category);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create category
router.post('/', async (req, res) => {
    try {
        const { name, description, color, icon, contentType } = req.body;
        
        // Check if category already exists
        const existing = await Category.findOne({ name: name.trim() });
        if (existing) {
            return res.status(400).json({ error: 'Category already exists' });
        }

        const category = new Category({
            name: name.trim(),
            description,
            color: color || '#6366f1',
            icon,
            contentType: contentType || 'Book', // Default to Book if not specified
        });

        await category.save();
        res.status(201).json(category);
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ error: 'Category name must be unique' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Update category
router.put('/:id', async (req, res) => {
    try {
        const { name, description, color, icon, contentType } = req.body;
        
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }

        // Check if new name conflicts with existing category
        if (name && name.trim() !== category.name) {
            const existing = await Category.findOne({ name: name.trim() });
            if (existing) {
                return res.status(400).json({ error: 'Category name already exists' });
            }
        }

        category.name = name ? name.trim() : category.name;
        category.description = description !== undefined ? description : category.description;
        category.color = color || category.color;
        category.icon = icon !== undefined ? icon : category.icon;
        category.contentType = contentType || category.contentType;
        category.updatedAt = Date.now();

        await category.save();
        res.json(category);
    } catch (error) {
        if (error.code === 11000) {
            res.status(400).json({ error: 'Category name must be unique' });
        } else {
            res.status(500).json({ error: error.message });
        }
    }
});

// Delete category
router.delete('/:id', async (req, res) => {
    try {
        const category = await Category.findByIdAndDelete(req.params.id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json({ message: 'Category deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

