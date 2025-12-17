require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

let storage;

// Try multiple methods to load GCS credentials
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const credentialsJson = process.env.GCS_CREDENTIALS_JSON || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

if (credentialsJson) {
    // Method 1: Credentials provided as JSON string (for Render/cloud deployments)
    try {
        const credentials = JSON.parse(credentialsJson);
        storage = new Storage({ credentials });
        console.log('✅ GCS: Loaded credentials from GCS_CREDENTIALS_JSON env var');
    } catch (e) {
        console.error('❌ GCS: Failed to parse GCS_CREDENTIALS_JSON:', e.message);
        storage = new Storage();
    }
} else if (credentialsPath && fs.existsSync(credentialsPath)) {
    // Method 2: Credentials file path (for local development)
    storage = new Storage({
        keyFilename: path.resolve(credentialsPath),
    });
    console.log('✅ GCS: Loaded credentials from file:', credentialsPath);
} else if (credentialsPath) {
    // Path specified but file doesn't exist - try as JSON string
    try {
        const credentials = JSON.parse(credentialsPath);
        storage = new Storage({ credentials });
        console.log('✅ GCS: Loaded credentials from GOOGLE_APPLICATION_CREDENTIALS as JSON');
    } catch (e) {
        console.error('❌ GCS: GOOGLE_APPLICATION_CREDENTIALS is neither a valid file nor valid JSON');
        storage = new Storage();
    }
} else {
    // Method 3: Default credentials (Google Cloud environment)
    console.log('⚠️ GCS: No credentials configured, using default (will fail outside Google Cloud)');
    storage = new Storage();
}

const bucketName = process.env.GCS_BUCKET_NAME;

if (!bucketName) {
    console.error('❌ GCS_BUCKET_NAME is not set in environment');
} else {
    console.log('✅ GCS bucket configured:', bucketName);
}

const bucket = bucketName ? storage.bucket(bucketName) : null;

module.exports = { storage, bucket };
