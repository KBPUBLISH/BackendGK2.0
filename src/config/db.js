const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI || process.env.MONGO_URI.includes('<username>')) {
            console.warn('⚠️  MONGO_URI not configured or using placeholder value');
            console.warn('⚠️  Please set MONGO_URI in .env file with your MongoDB connection string');
            console.warn('⚠️  Server will start but database operations will fail');
            return;
        }
        
        // Try connecting with explicit options
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 10000, // 10 second timeout
        });
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    } catch (error) {
        console.error(`❌ MongoDB Connection Error: ${error.message}`);
        console.error('💡 Please check:');
        console.error('   1. MONGO_URI is set correctly in .env file');
        console.error('   2. MongoDB server is running and accessible');
        console.error('   3. Network connection is working');
        // Don't exit process in dev, just log error
        if (process.env.NODE_ENV === 'production') {
            process.exit(1);
        }
    }
};

module.exports = connectDB;
