require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

let storageConfig = {};

// Option 1: Check for JSON credentials in environment variable
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
        const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
        storageConfig = { credentials };
        console.log('✅ Using GCS credentials from GOOGLE_SERVICE_ACCOUNT_JSON environment variable');
    } catch (error) {
        console.error('❌ Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', error.message);
    }
}
// Option 2: Try to find service account key file
else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const possiblePaths = [
        process.env.GOOGLE_APPLICATION_CREDENTIALS, // Exact path from env
        path.resolve(__dirname, '../../', process.env.GOOGLE_APPLICATION_CREDENTIALS), // Relative to backend
        path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS), // Absolute path
        path.resolve(__dirname, '../../backend/', process.env.GOOGLE_APPLICATION_CREDENTIALS), // From backend root
    ];
    
    let keyFilename = null;
    for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
            keyFilename = possiblePath;
            console.log('✅ Found service account key at:', keyFilename);
            break;
        }
    }
    
    if (keyFilename) {
        // Try loading the key file directly as credentials object
        try {
            const keyContent = JSON.parse(fs.readFileSync(keyFilename, 'utf8'));
            storageConfig = { credentials: keyContent };
            console.log('✅ Loaded service account key as credentials object');
        } catch (err) {
            // Fallback to keyFilename if parsing fails
            console.log('⚠️ Could not parse key file, using keyFilename:', err.message);
            storageConfig = { keyFilename };
        }
    } else {
        console.warn('⚠️ Service account key not found at any of these locations:');
        possiblePaths.forEach(p => console.warn('  -', p));
        console.log('💡 Tip: You can also set GOOGLE_SERVICE_ACCOUNT_JSON with the full JSON content');
    }
}

// Option 3: Use Application Default Credentials (if running on GCP or with gcloud auth)
if (Object.keys(storageConfig).length === 0) {
    console.log('ℹ️ No explicit credentials found, trying Application Default Credentials');
}

const storage = new Storage(storageConfig);

const bucketName = process.env.GCS_BUCKET_NAME;

if (!bucketName) {
    console.error('GCS_BUCKET_NAME is not set in .env file');
} else {
    console.log('GCS Bucket configured:', bucketName);
}

const bucket = bucketName ? storage.bucket(bucketName) : null;

if (bucket) {
    console.log('GCS bucket initialized successfully');
} else {
    console.warn('GCS bucket is null - check credentials and bucket name');
}

module.exports = { storage, bucket };
