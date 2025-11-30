const express = require('express');
const router = express.Router();
const Category = require('../models/Category');

// Get all categories (optionally filtered by type)
router.get('/', async (req, res) => {
    try {
        const { type } = req.query;
        const query = type ? { type } : {};
        const categories = await Category.find(query).sort({ name: 1 });
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
        const mongoose = require('mongoose');
        
        // Check if MongoDB is connected
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ error: 'Database not connected' });
        }
        
        const { name, type, description, color, icon } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Category name is required' });
        }
        
        if (!type || !['book', 'audio'].includes(type)) {
            return res.status(400).json({ error: 'Category type must be either "book" or "audio"' });
        }
        
        // Check if category already exists for this type
        const existing = await Category.findOne({ name: name.trim(), type });
        if (existing) {
            return res.status(400).json({ error: `Category "${name.trim()}" already exists for ${type} categories` });
        }

        const category = new Category({
            name: name.trim(),
            type: type,
            description: description || '',
            color: color || '#6366f1',
            icon: icon || '',
        });

        await category.save();
        res.status(201).json(category);
    } catch (error) {
        console.error('Category creation error:', error);
        if (error.code === 11000) {
            res.status(400).json({ error: 'Category name must be unique' });
        } else {
            res.status(500).json({ error: error.message || 'Failed to create category' });
        }
    }
});

// Update category
router.put('/:id', async (req, res) => {
    try {
        const { name, type, description, color, icon } = req.body;
        
        const category = await Category.findById(req.params.id);
        if (!category) {
            return res.status(404).json({ error: 'Category not found' });
        }

        // Validate type if provided
        if (type && !['book', 'audio'].includes(type)) {
            return res.status(400).json({ error: 'Category type must be either "book" or "audio"' });
        }

        // Check if new name/type combination conflicts with existing category
        const newName = name ? name.trim() : category.name;
        const newType = type || category.type;
        
        if ((name && name.trim() !== category.name) || (type && type !== category.type)) {
            const existing = await Category.findOne({ name: newName, type: newType, _id: { $ne: category._id } });
            if (existing) {
                return res.status(400).json({ error: `Category "${newName}" already exists for ${newType} categories` });
            }
        }

        category.name = newName;
        category.type = newType;
        category.description = description !== undefined ? description : category.description;
        category.color = color || category.color;
        category.icon = icon !== undefined ? icon : category.icon;
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

