const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Game = require('../models/Game');

// GET all games
router.get('/', async (req, res) => {
    try {
        // Check database connection
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        const games = await Game.find().sort({ gameId: 1 });
        res.json(games);
    } catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET enabled games only
router.get('/enabled', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        const games = await Game.find({ enabled: true }).sort({ gameId: 1 });
        res.json(games);
    } catch (error) {
        console.error('Error fetching enabled games:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET games for Daily Tasks & IQ Games section
router.get('/daily-tasks', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        // Get games that are enabled AND marked for daily tasks display
        const games = await Game.find({ 
            enabled: true, 
            showInDailyTasks: true 
        }).sort({ createdAt: -1 });
        
        res.json(games);
    } catch (error) {
        console.error('Error fetching daily task games:', error);
        res.status(500).json({ message: error.message });
    }
});

// GET single game by ID
router.get('/:gameId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        const game = await Game.findOne({ gameId: req.params.gameId });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }
        res.json(game);
    } catch (error) {
        console.error('Error fetching game:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST create or update game
router.post('/', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        const { gameId, name, enabled, description, settings, rewards, url, coverImage, gameType, showInDailyTasks, isPurchasable, goldCoinPrice } = req.body;

        if (!gameId || !name) {
            return res.status(400).json({ message: 'gameId and name are required' });
        }

        // Check if game exists
        const existingGame = await Game.findOne({ gameId });
        
        if (existingGame) {
            // Update existing game
            existingGame.name = name;
            existingGame.enabled = enabled !== undefined ? enabled : existingGame.enabled;
            existingGame.description = description || existingGame.description;
            existingGame.url = url !== undefined ? url : existingGame.url;
            existingGame.coverImage = coverImage !== undefined ? coverImage : existingGame.coverImage;
            existingGame.gameType = gameType !== undefined ? gameType : existingGame.gameType;
            existingGame.showInDailyTasks = showInDailyTasks !== undefined ? showInDailyTasks : existingGame.showInDailyTasks;
            existingGame.isPurchasable = isPurchasable !== undefined ? isPurchasable : existingGame.isPurchasable;
            existingGame.goldCoinPrice = goldCoinPrice !== undefined ? goldCoinPrice : existingGame.goldCoinPrice;
            if (settings) existingGame.settings = { ...existingGame.settings, ...settings };
            if (rewards) existingGame.rewards = { ...existingGame.rewards, ...rewards };
            
            const updatedGame = await existingGame.save();
            res.json(updatedGame);
        } else {
            // Create new game
            const game = new Game({
                gameId,
                name,
                enabled: enabled !== undefined ? enabled : true,
                description,
                url,
                coverImage,
                gameType: gameType || 'modal',
                showInDailyTasks: showInDailyTasks !== undefined ? showInDailyTasks : true,
                isPurchasable: isPurchasable || false,
                goldCoinPrice: goldCoinPrice || 0,
                settings: settings || {},
                rewards: rewards || {
                    threeStars: 50,
                    twoStars: 25,
                    oneStar: 10,
                },
            });
            
            const newGame = await game.save();
            res.status(201).json(newGame);
        }
    } catch (error) {
        console.error('Error saving game:', error);
        if (error.code === 11000) {
            return res.status(400).json({ 
                message: 'Game with this ID already exists',
                error: 'DUPLICATE_GAME_ID'
            });
        }
        res.status(400).json({ message: error.message });
    }
});

// PUT update game
router.put('/:gameId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        const game = await Game.findOne({ gameId: req.params.gameId });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }

        // Update fields
        if (req.body.name !== undefined) game.name = req.body.name;
        if (req.body.enabled !== undefined) game.enabled = req.body.enabled;
        if (req.body.description !== undefined) game.description = req.body.description;
        if (req.body.url !== undefined) game.url = req.body.url;
        if (req.body.coverImage !== undefined) game.coverImage = req.body.coverImage;
        if (req.body.gameType !== undefined) game.gameType = req.body.gameType;
        if (req.body.showInDailyTasks !== undefined) game.showInDailyTasks = req.body.showInDailyTasks;
        if (req.body.isPurchasable !== undefined) game.isPurchasable = req.body.isPurchasable;
        if (req.body.goldCoinPrice !== undefined) game.goldCoinPrice = req.body.goldCoinPrice;
        if (req.body.settings) {
            game.settings = { ...game.settings, ...req.body.settings };
        }
        if (req.body.rewards) {
            game.rewards = { ...game.rewards, ...req.body.rewards };
        }

        const updatedGame = await game.save();
        res.json(updatedGame);
    } catch (error) {
        console.error('Error updating game:', error);
        res.status(400).json({ message: error.message });
    }
});

// PUT toggle enabled/disabled
router.put('/:gameId/toggle', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        const game = await Game.findOne({ gameId: req.params.gameId });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }

        game.enabled = !game.enabled;
        const updatedGame = await game.save();
        res.json(updatedGame);
    } catch (error) {
        console.error('Error toggling game:', error);
        res.status(400).json({ message: error.message });
    }
});

// DELETE game
router.delete('/:gameId', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.status(500).json({ 
                message: 'Database not connected. Please check MONGO_URI in .env file.',
                error: 'Database connection not established'
            });
        }

        const game = await Game.findOne({ gameId: req.params.gameId });
        if (!game) {
            return res.status(404).json({ message: 'Game not found' });
        }

        await game.deleteOne();
        res.json({ message: 'Game deleted' });
    } catch (error) {
        console.error('Error deleting game:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
