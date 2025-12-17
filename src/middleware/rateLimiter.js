const rateLimit = require('express-rate-limit');

/**
 * Centralized API rate limiters
 * Used by `src/index.js`.
 *
 * Notes:
 * - On Render/behind proxies, make sure Express trust proxy is set if needed.
 * - `express-rate-limit` v7 uses `limit` instead of `max`.
 */

const common = {
  standardHeaders: true,
  legacyHeaders: false,
};

// General limiter for all API routes
const generalLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 600, // generous; covers app boot bursts
});

// Auth endpoints (login/reset) should be stricter
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 60,
});

// Text-to-speech endpoints (expensive)
const ttsLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 120,
});

// Quiz generation endpoints (AI-intensive)
const quizLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 240,
});

// Upload endpoints
const uploadLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: 120,
});

// Analytics endpoints (high volume but lightweight)
const analyticsLimiter = rateLimit({
  ...common,
  windowMs: 5 * 60 * 1000, // 5 minutes
  limit: 1000,
});

module.exports = {
  generalLimiter,
  authLimiter,
  ttsLimiter,
  quizLimiter,
  uploadLimiter,
  analyticsLimiter,
};


