require('dotenv').config();
const mongoose = require('mongoose');

console.log('Testing MongoDB connection...');
console.log('URI:', process.env.MONGO_URI?.replace(/:[^:]*@/, ':****@'));

mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
})
    .then(() => {
        console.log('✅ MongoDB Connected Successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ MongoDB Connection Failed:');
        console.error(error.message);
        process.exit(1);
    });
