require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Database Connection
connectDB();

// Serve uploaded files statically
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/books', require('./routes/books'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/playlists', require('./routes/playlists'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/authentication', require('./routes/authentication'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/tts', require('./routes/tts'));
app.use('/api/voices', require('./routes/voices'));
app.use('/api/voice-cloning', require('./routes/voiceCloning'));
app.use('/api/games', require('./routes/games'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/music', require('./routes/music'));
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/migration', require('./routes/migration'));
app.use('/api/jobs', require('./routes/jobs'));

app.get('/', (req, res) => {
  res.send('Godly Kids Backend API is running');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
