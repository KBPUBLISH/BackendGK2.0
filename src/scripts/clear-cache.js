require('dotenv').config();
const mongoose = require('mongoose');
const TTSCache = require('../models/TTSCache');

async function clearCache() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const result = await TTSCache.deleteMany({});
        console.log(`🗑️  Cleared ${result.deletedCount} entries from TTS cache`);

    } catch (error) {
        console.error('❌ Error clearing cache:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected');
    }
}

clearCache();
