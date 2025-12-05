const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI || process.env.MONGO_URI.includes('<username>')) {
            console.warn('⚠️  MONGO_URI not configured or using placeholder value');
            console.warn('⚠️  Please set MONGO_URI in .env file with your MongoDB connection string');
            console.warn('⚠️  Server will start but database operations will fail');
            return;
        }
        
        // Production-optimized connection settings for high traffic (100K+ daily users)
        const conn = await mongoose.connect(process.env.MONGO_URI, {
            // Connection Pool Settings
            maxPoolSize: 50,              // Max connections in pool (default: 5)
            minPoolSize: 10,              // Keep minimum connections warm
            maxIdleTimeMS: 30000,         // Close idle connections after 30s
            
            // Timeout Settings
            serverSelectionTimeoutMS: 5000,   // Fail fast if no server available
            socketTimeoutMS: 45000,           // Close sockets after 45s inactivity
            connectTimeoutMS: 10000,          // Connection timeout
            
            // Write Concern (balance between speed and durability)
            w: 'majority',                    // Wait for majority acknowledgment
            wtimeoutMS: 2500,                 // Write timeout
            
            // Read Preference (for read replicas in future)
            readPreference: 'primaryPreferred',
            
            // Compression for network efficiency
            compressors: ['zlib'],
        });
        
        console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
        console.log(`   Pool Size: ${conn.connection.getClient().options.maxPoolSize}`);
        
        // Monitor connection pool events in production
        if (process.env.NODE_ENV === 'production') {
            mongoose.connection.on('connected', () => console.log('MongoDB pool connected'));
            mongoose.connection.on('disconnected', () => console.warn('MongoDB pool disconnected'));
            mongoose.connection.on('error', (err) => console.error('MongoDB pool error:', err.message));
        }
        
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
