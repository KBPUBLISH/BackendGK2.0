/**
 * Rate Limiting Middleware
 * Protects API from abuse and ensures fair usage
 */

const rateLimit = require('express-rate-limit');

// General API rate limiter (100 requests per minute per IP)
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,            // 100 requests per minute
    message: {
        error: 'Too many requests',
        message: 'Please slow down. You can make 100 requests per minute.',
        retryAfter: 60
    },
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
    // Skip rate limiting for health checks
    skip: (req) => req.path === '/api/health' || req.path === '/',
});

// Strict limiter for authentication endpoints (10 requests per minute)
const authLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,             // 10 requests per minute
    message: {
        error: 'Too many login attempts',
        message: 'Please wait before trying again.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// TTS generation limiter (more expensive operation - 20 per minute)
const ttsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20,             // 20 TTS requests per minute
    message: {
        error: 'TTS rate limit exceeded',
        message: 'Too many audio generation requests. Please wait.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Quiz generation limiter (AI-intensive - 10 per minute)
const quizLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,             // 10 quiz requests per minute
    message: {
        error: 'Quiz generation rate limit exceeded',
        message: 'Please wait before generating another quiz.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Upload limiter (5 per minute to prevent abuse)
const uploadLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,             // 30 uploads per minute
    message: {
        error: 'Upload rate limit exceeded',
        message: 'Too many uploads. Please wait.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Analytics limiter (portal admin feature - 200 per minute)
const analyticsLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 200,            // 200 requests per minute (portal dashboard makes many calls)
    message: {
        error: 'Analytics rate limit exceeded',
        message: 'Too many analytics requests.',
        retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    generalLimiter,
    authLimiter,
    ttsLimiter,
    quizLimiter,
    uploadLimiter,
    analyticsLimiter,
};

