const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Translation = require('../models/Translation');
const Page = require('../models/Page');

// Supported languages
const SUPPORTED_LANGUAGES = {
    'en': 'English',
    'es': 'Spanish',
    'pt': 'Portuguese',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'nl': 'Dutch',
    'pl': 'Polish',
    'ru': 'Russian',
    'zh': 'Chinese',
    'ja': 'Japanese',
    'ko': 'Korean',
    'tl': 'Filipino',
};

// Generate hash of text for change detection
const generateHash = (text) => {
    return crypto.createHash('md5').update(text || '').digest('hex');
};

// Decode HTML entities returned by Google Translate API
const decodeHtmlEntities = (text) => {
    if (!text) return '';
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#x2F;/g, '/')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
};

// Translate text using Google Cloud Translation API
const translateText = async (text, targetLanguage) => {
    if (!text || text.trim() === '') return '';
    if (targetLanguage === 'en') return text; // No translation needed for English
    
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    
    if (!apiKey) {
        console.warn('⚠️ GOOGLE_TRANSLATE_API_KEY not set, using mock translation');
        // Return mock translation for testing (just adds language prefix)
        return `[${targetLanguage.toUpperCase()}] ${text}`;
    }
    
    try {
        const response = await fetch(
            `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    q: text,
                    source: 'en',
                    target: targetLanguage,
                    format: 'text',
                }),
            }
        );
        
        if (!response.ok) {
            const error = await response.text();
            console.error('Translation API error:', error);
            throw new Error(`Translation failed: ${response.status}`);
        }
        
        const data = await response.json();
        // Decode HTML entities that Google Translate returns
        return decodeHtmlEntities(data.data.translations[0].translatedText);
    } catch (error) {
        console.error('Translation error:', error);
        throw error;
    }
};

// GET /api/translate/languages - Get list of supported languages
router.get('/languages', (req, res) => {
    res.json(SUPPORTED_LANGUAGES);
});

// GET /api/translate/page/:pageId - Get or create translation for a page
router.get('/page/:pageId', async (req, res) => {
    try {
        const { pageId } = req.params;
        const { lang } = req.query;
        
        if (!lang) {
            return res.status(400).json({ message: 'Language code (lang) is required' });
        }
        
        if (!SUPPORTED_LANGUAGES[lang]) {
            return res.status(400).json({ 
                message: `Unsupported language: ${lang}`,
                supportedLanguages: Object.keys(SUPPORTED_LANGUAGES)
            });
        }
        
        // If English, just return the original page
        if (lang === 'en') {
            const page = await Page.findById(pageId);
            if (!page) {
                return res.status(404).json({ message: 'Page not found' });
            }
            return res.json({
                pageId,
                languageCode: 'en',
                translatedText: page.content?.text || '',
                translatedTextBoxes: page.content?.textBoxes?.map((tb, i) => ({
                    textBoxIndex: i,
                    originalText: tb.text,
                    translatedText: tb.text,
                })) || [],
                isOriginal: true,
            });
        }
        
        // Check if translation already exists
        let translation = await Translation.findOne({ pageId, languageCode: lang });
        
        // Get the original page
        const page = await Page.findById(pageId);
        if (!page) {
            return res.status(404).json({ message: 'Page not found' });
        }
        
        // Generate hash of current original content
        const currentHash = generateHash(
            (page.content?.text || '') + 
            (page.content?.textBoxes?.map(tb => tb.text).join('') || '')
        );
        
        // If translation exists and original hasn't changed, return cached
        if (translation && translation.originalHash === currentHash) {
            console.log(`📚 Returning cached ${lang} translation for page ${pageId}`);
            return res.json(translation);
        }
        
        // Need to translate (either new or original changed)
        console.log(`🌐 Translating page ${pageId} to ${lang}...`);
        
        // Translate main text
        const translatedText = await translateText(page.content?.text || '', lang);
        
        // Translate text boxes
        const translatedTextBoxes = [];
        if (page.content?.textBoxes && page.content.textBoxes.length > 0) {
            for (let i = 0; i < page.content.textBoxes.length; i++) {
                const tb = page.content.textBoxes[i];
                const translatedTbText = await translateText(tb.text || '', lang);
                translatedTextBoxes.push({
                    textBoxIndex: i,
                    originalText: tb.text,
                    translatedText: translatedTbText,
                });
            }
        }
        
        // Save or update translation cache
        if (translation) {
            translation.translatedText = translatedText;
            translation.translatedTextBoxes = translatedTextBoxes;
            translation.originalText = page.content?.text || '';
            translation.originalHash = currentHash;
            translation.translatedAt = new Date();
            await translation.save();
        } else {
            translation = await Translation.create({
                pageId,
                languageCode: lang,
                originalText: page.content?.text || '',
                translatedText,
                translatedTextBoxes,
                originalHash: currentHash,
            });
        }
        
        console.log(`✅ Translation cached for page ${pageId} in ${lang}`);
        res.json(translation);
        
    } catch (error) {
        console.error('Translation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /api/translate/bulk - Translate multiple pages at once (for preloading)
router.post('/bulk', async (req, res) => {
    try {
        const { pageIds, lang } = req.body;
        
        if (!pageIds || !Array.isArray(pageIds) || pageIds.length === 0) {
            return res.status(400).json({ message: 'pageIds array is required' });
        }
        
        if (!lang || !SUPPORTED_LANGUAGES[lang]) {
            return res.status(400).json({ message: 'Valid language code (lang) is required' });
        }
        
        const results = [];
        
        for (const pageId of pageIds) {
            try {
                // Check cache first
                let translation = await Translation.findOne({ pageId, languageCode: lang });
                
                if (translation) {
                    results.push({ pageId, status: 'cached', translation });
                } else {
                    // Get original page
                    const page = await Page.findById(pageId);
                    if (!page) {
                        results.push({ pageId, status: 'not_found' });
                        continue;
                    }
                    
                    // Translate
                    const translatedText = await translateText(page.content?.text || '', lang);
                    const translatedTextBoxes = [];
                    
                    if (page.content?.textBoxes) {
                        for (let i = 0; i < page.content.textBoxes.length; i++) {
                            const tb = page.content.textBoxes[i];
                            const translatedTbText = await translateText(tb.text || '', lang);
                            translatedTextBoxes.push({
                                textBoxIndex: i,
                                originalText: tb.text,
                                translatedText: translatedTbText,
                            });
                        }
                    }
                    
                    // Save to cache
                    const currentHash = generateHash(
                        (page.content?.text || '') + 
                        (page.content?.textBoxes?.map(tb => tb.text).join('') || '')
                    );
                    
                    translation = await Translation.create({
                        pageId,
                        languageCode: lang,
                        originalText: page.content?.text || '',
                        translatedText,
                        translatedTextBoxes,
                        originalHash: currentHash,
                    });
                    
                    results.push({ pageId, status: 'translated', translation });
                }
            } catch (err) {
                results.push({ pageId, status: 'error', error: err.message });
            }
        }
        
        res.json({ results, language: lang });
        
    } catch (error) {
        console.error('Bulk translation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /api/translate/ui - Translate UI strings (batch)
router.post('/ui', async (req, res) => {
    try {
        const { texts, lang } = req.body;

        if (!texts || !Array.isArray(texts)) {
            return res.status(400).json({ message: 'texts array is required' });
        }

        if (!lang || !SUPPORTED_LANGUAGES[lang]) {
            return res.status(400).json({ message: 'Valid language code (lang) is required' });
        }

        if (lang === 'en') {
            return res.json({ translations: texts });
        }

        const translations = [];
        for (const text of texts) {
            const translated = await translateText(text, lang);
            translations.push(translated);
        }

        res.json({ translations, language: lang });
    } catch (error) {
        console.error('UI translation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /api/translate/text - Translate a single text string
router.post('/text', async (req, res) => {
    try {
        const { text } = req.body;
        const { lang } = req.query;

        if (!text) {
            return res.status(400).json({ message: 'text is required' });
        }

        if (!lang || !SUPPORTED_LANGUAGES[lang]) {
            return res.status(400).json({ message: 'Valid language code (lang) is required' });
        }

        if (lang === 'en') {
            return res.json({ translatedText: text, language: lang });
        }

        const translatedText = await translateText(text, lang);
        res.json({ translatedText, language: lang });
    } catch (error) {
        console.error('Text translation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// POST /api/translate/texts - Translate multiple text strings (batch)
router.post('/texts', async (req, res) => {
    try {
        const { texts } = req.body;
        const { lang } = req.query;

        if (!texts || !Array.isArray(texts)) {
            return res.status(400).json({ message: 'texts array is required' });
        }

        if (!lang || !SUPPORTED_LANGUAGES[lang]) {
            return res.status(400).json({ message: 'Valid language code (lang) is required' });
        }

        if (lang === 'en') {
            return res.json({ translations: texts, language: lang });
        }

        const translations = [];
        for (const text of texts) {
            const translated = await translateText(text, lang);
            translations.push(translated);
        }

        res.json({ translations, language: lang });
    } catch (error) {
        console.error('Texts translation error:', error);
        res.status(500).json({ message: error.message });
    }
});

// DELETE /api/translate/cache - Clear all translation cache (or specific language)
router.delete('/cache', async (req, res) => {
    try {
        const { lang } = req.query;
        
        let result;
        if (lang && lang !== 'en') {
            // Clear cache for specific language
            result = await Translation.deleteMany({ languageCode: lang });
            console.log(`🗑️ Cleared ${result.deletedCount} cached translations for ${lang}`);
            res.json({ 
                message: `Cleared ${result.deletedCount} cached translations for ${lang}`,
                deletedCount: result.deletedCount,
                language: lang
            });
        } else {
            // Clear all non-English translations
            result = await Translation.deleteMany({});
            console.log(`🗑️ Cleared all ${result.deletedCount} cached translations`);
            res.json({ 
                message: `Cleared all ${result.deletedCount} cached translations`,
                deletedCount: result.deletedCount
            });
        }
    } catch (error) {
        console.error('Cache clear error:', error);
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;

