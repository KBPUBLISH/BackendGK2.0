require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./config/db');
const { 
  generalLimiter, 
  authLimiter, 
  ttsLimiter, 
  quizLimiter, 
  uploadLimiter,
  analyticsLimiter 
} = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5001;

// ===========================================
// SECURITY MIDDLEWARE
// ===========================================

// Helmet - Security headers (XSS protection, etc.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow cross-origin for assets
  contentSecurityPolicy: false, // Disable CSP for API
}));

// CORS - Allow all origins for flexibility (mobile apps, web, etc.)
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow any godlykids or netlify subdomain - no logging spam
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
}));

// ===========================================
// BODY PARSING & RATE LIMITING
// ===========================================

// Body parsing with size limits
app.use(express.json({ limit: '10mb' })); // Reduced from 50mb
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Apply general rate limiter to all routes
app.use(generalLimiter);

// ===========================================
// DATABASE CONNECTION
// ===========================================
connectDB();

// ===========================================
// STATIC FILES
// ===========================================
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ===========================================
// API ROUTES (with specific rate limiters)
// ===========================================

// Auth routes - stricter rate limiting
app.use('/api/authentication', authLimiter, require('./routes/authentication'));
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/password-reset', authLimiter, require('./routes/passwordReset'));

// TTS routes - expensive operation
app.use('/api/tts', ttsLimiter, require('./routes/tts'));

// Quiz routes - AI-intensive
app.use('/api/quiz', quizLimiter, require('./routes/quiz'));

// Upload routes
app.use('/api/upload', uploadLimiter, require('./routes/upload'));

// Analytics routes
app.use('/api/analytics', analyticsLimiter, require('./routes/analytics'));

// Standard routes (use general limiter already applied)
app.use('/api/books', require('./routes/books'));
app.use('/api/book-series', require('./routes/bookSeries'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/playlists', require('./routes/playlists'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/voices', require('./routes/voices'));
app.use('/api/voice-cloning', require('./routes/voiceCloning'));
app.use('/api/games', require('./routes/games'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/music', require('./routes/music'));
app.use('/api/migration', require('./routes/migration'));
app.use('/api/jobs', require('./routes/jobs'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/translate', require('./routes/translate'));
app.use('/api/influencers', require('./routes/influencers'));
app.use('/api/stripe', require('./routes/stripe'));
app.use('/api/referrals', require('./routes/referrals'));

// ===========================================
// HEALTH & STATUS ENDPOINTS
// ===========================================

app.get('/', (req, res) => {
  res.send('Godly Kids Backend API is running');
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ===========================================
// ERROR HANDLING
// ===========================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message 
  });
});

// ===========================================
// START SERVER
// ===========================================
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
});
