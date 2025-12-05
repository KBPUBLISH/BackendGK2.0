/**
 * Production-ready logger using Winston
 * Replaces console.log for better performance and log management
 */

const winston = require('winston');

// Define log levels
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

// Determine log level based on environment
const level = () => {
    const env = process.env.NODE_ENV || 'development';
    return env === 'production' ? 'warn' : 'debug';
};

// Custom format for production (JSON for log aggregation)
const productionFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Custom format for development (readable console output)
const developmentFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
        return `${timestamp} [${level}]: ${message} ${metaStr}`;
    })
);

// Create transports based on environment
const transports = [];

// Always add console transport
transports.push(
    new winston.transports.Console({
        format: process.env.NODE_ENV === 'production' ? productionFormat : developmentFormat,
    })
);

// In production, also log errors to a file (optional - comment out if not needed)
// transports.push(
//     new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
//     new winston.transports.File({ filename: 'logs/combined.log' })
// );

// Create the logger
const logger = winston.createLogger({
    level: level(),
    levels,
    format: productionFormat,
    transports,
    // Don't exit on uncaught errors
    exitOnError: false,
});

// Create a stream for Morgan HTTP logging (optional)
logger.stream = {
    write: (message) => logger.http(message.trim()),
};

// Helper methods that match console.log API for easy migration
const log = {
    info: (message, meta = {}) => logger.info(message, meta),
    warn: (message, meta = {}) => logger.warn(message, meta),
    error: (message, meta = {}) => logger.error(message, meta),
    debug: (message, meta = {}) => logger.debug(message, meta),
    http: (message, meta = {}) => logger.http(message, meta),
    
    // For backwards compatibility with console.log patterns
    log: (message, meta = {}) => logger.info(message, meta),
};

module.exports = { logger, log };

