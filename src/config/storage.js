require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const path = require('path');

const storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
        ? path.resolve(process.env.GOOGLE_APPLICATION_CREDENTIALS)
        : undefined,
});

const bucketName = process.env.GCS_BUCKET_NAME;

if (!bucketName) {
    console.error('GCS_BUCKET_NAME is not set in .env file');
}

const bucket = bucketName ? storage.bucket(bucketName) : null;

module.exports = { storage, bucket };
