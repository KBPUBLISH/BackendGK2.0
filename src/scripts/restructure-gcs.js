require('dotenv').config();
const { Storage } = require('@google-cloud/storage');
const mongoose = require('mongoose');
const path = require('path');

// Initialize GCS
const storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account-key.json'
});
const bucketName = process.env.GCS_BUCKET_NAME || 'developmentgk';
const bucket = storage.bucket(bucketName);

// MongoDB Models
const Book = require('../models/Book');
const Page = require('../models/Page');
const Category = require('../models/Category');

/**
 * GCS Folder Structure Reorganization Script
 * 
 * New Structure:
 * books/{bookId}/cover.jpg
 * books/{bookId}/pages/page-{pageNumber}-background.{ext}
 * books/{bookId}/pages/page-{pageNumber}-scroll.{ext}
 * books/{bookId}/audio/{timestamp}_{hash}.mp3
 * categories/{categoryId}-icon.{ext}
 */

// Helper: Extract file extension
function getExtension(filename) {
    return path.extname(filename).toLowerCase();
}

// Helper: Get file type from URL
function getFileType(url) {
    const ext = getExtension(url);
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) return 'image';
    if (['.mp4', '.webm', '.mov'].includes(ext)) return 'video';
    if (['.mp3', '.wav', '.ogg'].includes(ext)) return 'audio';
    return 'unknown';
}

// Helper: Copy file in GCS
async function copyFile(sourcePath, destPath) {
    try {
        const sourceFile = bucket.file(sourcePath);
        const [exists] = await sourceFile.exists();

        if (!exists) {
            console.log(`⚠️  Source file not found: ${sourcePath}`);
            return null;
        }

        const destFile = bucket.file(destPath);
        await sourceFile.copy(destFile);

        // Skip makePublic() because Uniform Bucket-Level Access is enabled
        // await destFile.makePublic();

        const publicUrl = `https://storage.googleapis.com/${bucketName}/${destPath}`;
        console.log(`✅ Copied: ${sourcePath} → ${destPath}`);
        return publicUrl;
    } catch (error) {
        console.error(`❌ Error copying ${sourcePath}:`, error.message);
        return null;
    }
}

// Helper: Extract GCS path from URL
function extractGCSPath(url) {
    if (!url) return null;

    // Handle GCS URLs
    if (url.includes('storage.googleapis.com')) {
        const match = url.match(/storage\.googleapis\.com\/[^\/]+\/(.+)/);
        return match ? match[1] : null;
    }

    // Handle relative paths (local uploads)
    if (url.startsWith('/uploads/')) {
        return url.replace('/uploads/', '');
    }

    return null;
}

// Main restructuring function
async function restructureGCS() {
    console.log('🔄 Starting GCS restructuring...\n');

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get all books
        const books = await Book.find({});
        console.log(`📚 Found ${books.length} books to process\n`);

        for (const book of books) {
            console.log(`\n📖 Processing book: ${book.title} (${book._id})`);
            const bookId = book._id.toString();
            let bookUpdated = false;

            // 1. Reorganize book cover
            if (book.coverUrl) {
                const oldPath = extractGCSPath(book.coverUrl);
                if (oldPath) {
                    const ext = getExtension(oldPath);
                    const newPath = `books/${bookId}/cover${ext}`;

                    if (oldPath !== newPath) {
                        const newUrl = await copyFile(oldPath, newPath);
                        if (newUrl) {
                            book.coverUrl = newUrl;
                            bookUpdated = true;
                        }
                    }
                }
            }

            // 2. Get all pages for this book
            const pages = await Page.find({ bookId: book._id });
            console.log(`  📄 Found ${pages.length} pages`);

            for (const page of pages) {
                let pageUpdated = false;
                const pageNum = page.pageNumber;

                // 2a. Reorganize background
                if (page.backgroundUrl) {
                    const oldPath = extractGCSPath(page.backgroundUrl);
                    if (oldPath) {
                        const ext = getExtension(oldPath);
                        const fileType = getFileType(oldPath);
                        const newPath = `books/${bookId}/pages/page-${pageNum}-background${ext}`;

                        if (oldPath !== newPath) {
                            const newUrl = await copyFile(oldPath, newPath);
                            if (newUrl) {
                                page.backgroundUrl = newUrl;
                                pageUpdated = true;
                            }
                        }
                    }
                }

                // 2b. Reorganize scroll
                if (page.scrollUrl) {
                    const oldPath = extractGCSPath(page.scrollUrl);
                    if (oldPath) {
                        const ext = getExtension(oldPath);
                        const newPath = `books/${bookId}/pages/page-${pageNum}-scroll${ext}`;

                        if (oldPath !== newPath) {
                            const newUrl = await copyFile(oldPath, newPath);
                            if (newUrl) {
                                page.scrollUrl = newUrl;
                                pageUpdated = true;
                            }
                        }
                    }
                }

                // Save page if updated
                if (pageUpdated) {
                    await page.save();
                    console.log(`  ✅ Updated page ${pageNum}`);
                }
            }

            // Save book if updated
            if (bookUpdated) {
                await book.save();
                console.log(`  ✅ Updated book metadata`);
            }
        }

        // 3. Reorganize categories
        console.log('\n\n📂 Processing categories...');
        const categories = await Category.find({});
        console.log(`Found ${categories.length} categories`);

        for (const category of categories) {
            if (category.icon) {
                const oldPath = extractGCSPath(category.icon);
                if (oldPath) {
                    const ext = getExtension(oldPath);
                    const categorySlug = category.name.toLowerCase().replace(/\s+/g, '-');
                    const newPath = `categories/${categorySlug}-icon${ext}`;

                    if (oldPath !== newPath) {
                        const newUrl = await copyFile(oldPath, newPath);
                        if (newUrl) {
                            category.icon = newUrl;
                            await category.save();
                            console.log(`✅ Updated category: ${category.name}`);
                        }
                    }
                }
            }
        }

        console.log('\n\n✅ GCS restructuring complete!');
        console.log('\n📊 Summary:');
        console.log(`   - Processed ${books.length} books`);
        console.log(`   - Processed ${categories.length} categories`);
        console.log('\n💡 Note: Audio files are already organized by book in books/{bookId}/audio/');
        console.log('   This was done automatically by the TTS system.');

    } catch (error) {
        console.error('\n❌ Error during restructuring:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    restructureGCS()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { restructureGCS };
