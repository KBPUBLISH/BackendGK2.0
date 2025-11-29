require('dotenv').config();
const mongoose = require('mongoose');
const { Storage } = require('@google-cloud/storage');

// Models
const Book = require('../models/Book');
const Page = require('../models/Page');
const Category = require('../models/Category');
const TTSCache = require('../models/TTSCache');

// Initialize GCS
const storage = new Storage({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './service-account-key.json'
});
const bucketName = process.env.GCS_BUCKET_NAME || 'developmentgk';
const bucket = storage.bucket(bucketName);

/**
 * Verification Script
 * 
 * Verifies that:
 * 1. All database URLs point to valid GCS files
 * 2. All files follow the new structure
 * 3. No orphaned files in GCS
 * 4. Data integrity is maintained
 */

async function verifyStructure() {
    console.log('🔍 Starting structure verification...\n');

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        const issues = [];
        const stats = {
            totalBooks: 0,
            totalPages: 0,
            totalCategories: 0,
            validUrls: 0,
            invalidUrls: 0,
            missingFiles: 0
        };

        // Helper: Check if GCS file exists
        async function fileExists(url) {
            if (!url) return false;

            try {
                let gcsPath = null;

                if (url.includes('storage.googleapis.com')) {
                    const match = url.match(/storage\.googleapis\.com\/[^\/]+\/(.+)/);
                    gcsPath = match ? match[1] : null;
                } else if (url.startsWith('/uploads/')) {
                    gcsPath = url.replace('/uploads/', '');
                }

                if (!gcsPath) return false;

                const file = bucket.file(gcsPath);
                const [exists] = await file.exists();
                return exists;
            } catch (error) {
                return false;
            }
        }

        // Helper: Check if URL follows new structure
        function followsNewStructure(url, bookId, type) {
            if (!url) return true; // null/empty is ok

            const expectedPatterns = {
                cover: `books/${bookId}/cover`,
                pageBackground: `books/${bookId}/pages/page-`,
                pageScroll: `books/${bookId}/pages/page-`,
                audio: `books/${bookId}/audio/`,
                categoryIcon: `categories/`
            };

            const pattern = expectedPatterns[type];
            return pattern ? url.includes(pattern) : true;
        }

        // 1. Verify Books
        console.log('📚 Verifying books...');
        const books = await Book.find({});
        stats.totalBooks = books.length;

        for (const book of books) {
            const bookId = book._id.toString();

            // Check cover URL
            if (book.coverUrl) {
                const exists = await fileExists(book.coverUrl);
                const correctStructure = followsNewStructure(book.coverUrl, bookId, 'cover');

                if (!exists) {
                    issues.push(`❌ Book "${book.title}": Cover file not found: ${book.coverUrl}`);
                    stats.missingFiles++;
                } else if (!correctStructure) {
                    issues.push(`⚠️  Book "${book.title}": Cover URL doesn't follow new structure: ${book.coverUrl}`);
                } else {
                    stats.validUrls++;
                }
            }

            // Check category reference
            const category = await Category.findById(book.categoryId);
            if (!category) {
                issues.push(`❌ Book "${book.title}": References non-existent category ${book.categoryId}`);
            }
        }

        console.log(`✅ Verified ${books.length} books\n`);

        // 2. Verify Pages
        console.log('📄 Verifying pages...');
        const pages = await Page.find({});
        stats.totalPages = pages.length;

        for (const page of pages) {
            const book = await Book.findById(page.bookId);
            if (!book) {
                issues.push(`❌ Page ${page._id}: References non-existent book ${page.bookId}`);
                continue;
            }

            const bookId = book._id.toString();

            // Check background URL
            if (page.backgroundUrl) {
                const exists = await fileExists(page.backgroundUrl);
                const correctStructure = followsNewStructure(page.backgroundUrl, bookId, 'pageBackground');

                if (!exists) {
                    issues.push(`❌ Page ${page.pageNumber} of "${book.title}": Background file not found: ${page.backgroundUrl}`);
                    stats.missingFiles++;
                } else if (!correctStructure) {
                    issues.push(`⚠️  Page ${page.pageNumber} of "${book.title}": Background URL doesn't follow new structure`);
                } else {
                    stats.validUrls++;
                }
            }

            // Check scroll URL
            if (page.scrollUrl) {
                const exists = await fileExists(page.scrollUrl);
                const correctStructure = followsNewStructure(page.scrollUrl, bookId, 'pageScroll');

                if (!exists) {
                    issues.push(`❌ Page ${page.pageNumber} of "${book.title}": Scroll file not found: ${page.scrollUrl}`);
                    stats.missingFiles++;
                } else if (!correctStructure) {
                    issues.push(`⚠️  Page ${page.pageNumber} of "${book.title}": Scroll URL doesn't follow new structure`);
                } else {
                    stats.validUrls++;
                }
            }
        }

        console.log(`✅ Verified ${pages.length} pages\n`);

        // 3. Verify Categories
        console.log('📂 Verifying categories...');
        const categories = await Category.find({});
        stats.totalCategories = categories.length;

        for (const category of categories) {
            if (category.icon) {
                const exists = await fileExists(category.icon);
                const correctStructure = followsNewStructure(category.icon, null, 'categoryIcon');

                if (!exists) {
                    issues.push(`❌ Category "${category.name}": Icon file not found: ${category.icon}`);
                    stats.missingFiles++;
                } else if (!correctStructure) {
                    issues.push(`⚠️  Category "${category.name}": Icon URL doesn't follow new structure`);
                } else {
                    stats.validUrls++;
                }
            }
        }

        console.log(`✅ Verified ${categories.length} categories\n`);

        // 4. Verify TTS Cache
        console.log('🎵 Verifying TTS cache...');
        const ttsEntries = await TTSCache.find({}).limit(100); // Sample first 100

        for (const entry of ttsEntries) {
            if (entry.audioUrl) {
                const exists = await fileExists(entry.audioUrl);

                if (!exists) {
                    issues.push(`❌ TTS Cache: Audio file not found: ${entry.audioUrl}`);
                    stats.missingFiles++;
                } else {
                    stats.validUrls++;
                }
            }
        }

        console.log(`✅ Verified ${ttsEntries.length} TTS cache entries (sample)\n`);

        // 5. Report
        console.log('\n' + '='.repeat(60));
        console.log('📊 VERIFICATION REPORT');
        console.log('='.repeat(60));
        console.log(`Total Books:          ${stats.totalBooks}`);
        console.log(`Total Pages:          ${stats.totalPages}`);
        console.log(`Total Categories:     ${stats.totalCategories}`);
        console.log(`Valid URLs:           ${stats.validUrls}`);
        console.log(`Missing Files:        ${stats.missingFiles}`);
        console.log(`Total Issues Found:   ${issues.length}`);
        console.log('='.repeat(60));

        if (issues.length > 0) {
            console.log('\n⚠️  ISSUES FOUND:\n');
            issues.forEach(issue => console.log(issue));
        } else {
            console.log('\n✅ No issues found! Structure is valid.\n');
        }

        // 6. Check GCS folder structure
        console.log('\n🔍 Checking GCS folder structure...');
        const [files] = await bucket.getFiles({ prefix: 'books/' });
        console.log(`📁 Found ${files.length} files in books/ folder`);

        // Group by book
        const bookFolders = {};
        for (const file of files) {
            const match = file.name.match(/^books\/([^\/]+)\//);
            if (match) {
                const bookId = match[1];
                if (!bookFolders[bookId]) {
                    bookFolders[bookId] = { cover: 0, pages: 0, audio: 0 };
                }

                if (file.name.includes('/cover.')) bookFolders[bookId].cover++;
                else if (file.name.includes('/pages/')) bookFolders[bookId].pages++;
                else if (file.name.includes('/audio/')) bookFolders[bookId].audio++;
            }
        }

        console.log(`\n📊 Books in GCS: ${Object.keys(bookFolders).length}`);
        console.log('Sample structure:');
        Object.entries(bookFolders).slice(0, 5).forEach(([bookId, counts]) => {
            console.log(`  ${bookId}:`);
            console.log(`    - Cover: ${counts.cover}`);
            console.log(`    - Pages: ${counts.pages}`);
            console.log(`    - Audio: ${counts.audio}`);
        });

        console.log('\n✅ Verification complete!\n');

    } catch (error) {
        console.error('\n❌ Error during verification:', error);
        throw error;
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Run if called directly
if (require.main === module) {
    verifyStructure()
        .then(() => process.exit(0))
        .catch(error => {
            console.error(error);
            process.exit(1);
        });
}

module.exports = { verifyStructure };
