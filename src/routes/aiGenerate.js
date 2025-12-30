const express = require('express');
const router = express.Router();
const { Storage } = require('@google-cloud/storage');
const fetch = require('node-fetch');
const { GoogleGenAI } = require('@google/genai');

// Initialize GCS with flexible credentials
let storage;
let bucket;

try {
    // Try to parse credentials from environment variable (for Render/cloud deployment)
    if (process.env.GCS_CREDENTIALS) {
        const credentials = JSON.parse(process.env.GCS_CREDENTIALS);
        storage = new Storage({
            projectId: credentials.project_id || process.env.GCS_PROJECT_ID,
            credentials: credentials,
        });
        console.log('✅ GCS initialized with credentials from GCS_CREDENTIALS env var');
    } else if (process.env.GCS_KEY_FILE) {
        // Fallback to key file path (for local development)
        storage = new Storage({
            projectId: process.env.GCS_PROJECT_ID,
            keyFilename: process.env.GCS_KEY_FILE,
        });
        console.log('✅ GCS initialized with key file');
    } else {
        // Try default credentials (for GCP environments)
        storage = new Storage({
            projectId: process.env.GCS_PROJECT_ID,
        });
        console.log('⚠️ GCS initialized with default credentials');
    }
    bucket = storage.bucket(process.env.GCS_BUCKET || 'godly-kids-media');
} catch (error) {
    console.error('❌ Failed to initialize GCS:', error.message);
    storage = null;
    bucket = null;
}

// Available art styles for playlist covers
const ART_STYLES = [
    { id: 'cartoon', name: 'Cartoon', description: 'Bright, colorful cartoon style', prompt: 'colorful cartoon illustration style, bold outlines, vibrant colors' },
    { id: 'watercolor', name: 'Watercolor', description: 'Soft watercolor painting', prompt: 'soft watercolor painting style, gentle colors, artistic brush strokes' },
    { id: 'pixel', name: 'Pixel Art', description: 'Retro pixel art style', prompt: 'pixel art style, retro 8-bit aesthetic, cute pixelated' },
    { id: 'storybook', name: 'Storybook', description: 'Classic children\'s book illustration', prompt: 'classic children\'s storybook illustration style, whimsical, magical' },
    { id: 'anime', name: 'Anime', description: 'Japanese anime inspired', prompt: 'cute anime style illustration, big expressive eyes, soft shading' },
    { id: 'paper', name: 'Paper Craft', description: 'Paper cutout collage style', prompt: 'paper craft collage style, layered paper cutouts, textured' },
    { id: 'crayon', name: 'Crayon', description: 'Hand-drawn crayon art', prompt: 'hand-drawn crayon style, childlike artistic, warm colors' },
    { id: 'clay', name: 'Claymation', description: '3D clay figure style', prompt: 'claymation style, 3D clay figures, playful characters' },
];

// GET /api/ai-generate/styles - Get available art styles
router.get('/styles', (req, res) => {
    res.json(ART_STYLES);
});

// POST /api/ai-generate/playlist-cover - Generate a playlist cover image
router.post('/playlist-cover', async (req, res) => {
    try {
        const { prompt, style, playlistName, userId } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ message: 'prompt is required' });
        }
        
        // Find the style or use default
        const selectedStyle = ART_STYLES.find(s => s.id === style) || ART_STYLES[0];
        
        // Build the full prompt for image generation
        const fullPrompt = `Create a music playlist cover image: ${prompt}. 
Style: ${selectedStyle.prompt}. 
Requirements: square format, suitable for children, no text, family-friendly, bright and cheerful.`;
        
        console.log(`🎨 Generating playlist cover for "${playlistName || 'playlist'}" with style "${selectedStyle.name}"`);
        console.log(`🎨 Full prompt: ${fullPrompt}`);
        
        // Check available API keys
        const geminiKey = process.env.GEMINI_API_KEY;
        const openaiKey = process.env.OPENAI_API_KEY;
        const stabilityKey = process.env.STABILITY_API_KEY;
        
        console.log('🔑 API Keys available:', {
            gemini: geminiKey ? `${geminiKey.substring(0, 8)}...` : 'NOT SET',
            openai: openaiKey ? `${openaiKey.substring(0, 8)}...` : 'NOT SET',
            stability: stabilityKey ? 'SET' : 'NOT SET',
        });
        
        let imageUrl = null;
        let generationMethod = 'placeholder';
        
        // Try Google Gemini Nano Banana (image generation) first - using official SDK
        if (!imageUrl && geminiKey) {
            try {
                console.log('🎨 Trying Google Gemini gemini-2.5-flash-image with SDK...');
                
                const ai = new GoogleGenAI({ apiKey: geminiKey });
                
                const response = await ai.models.generateContent({
                    model: "gemini-2.5-flash-image",
                    contents: fullPrompt,
                });
                
                console.log('🎨 Gemini response received');
                
                // Find the image part in the response
                const parts = response.candidates?.[0]?.content?.parts || [];
                
                for (const part of parts) {
                    if (part.inlineData) {
                        const base64Image = part.inlineData.data;
                        const mimeType = part.inlineData.mimeType || 'image/png';
                        const extension = mimeType.includes('jpeg') ? 'jpg' : 'png';
                        
                        console.log('✅ Gemini generated image, uploading to GCS...');
                        
                        if (bucket) {
                            try {
                                const imageBuffer = Buffer.from(base64Image, 'base64');
                                const filename = `playlist-covers/${userId || 'anonymous'}/${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;
                                const file = bucket.file(filename);
                                
                                await file.save(imageBuffer, {
                                    contentType: mimeType,
                                    metadata: {
                                        cacheControl: 'public, max-age=31536000',
                                    },
                                });
                                
                                await file.makePublic();
                                
                                imageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
                                generationMethod = 'gemini-2.5-flash-image';
                                console.log(`✅ Uploaded to GCS: ${imageUrl}`);
                            } catch (gcsError) {
                                console.error('⚠️ GCS upload failed:', gcsError.message);
                                // Return as data URL if GCS fails
                                imageUrl = `data:${mimeType};base64,${base64Image}`;
                                generationMethod = 'gemini-2.5-flash-image-inline';
                                console.log('✅ Using inline data URL');
                            }
                        } else {
                            // No GCS, return as data URL
                            imageUrl = `data:${mimeType};base64,${base64Image}`;
                            generationMethod = 'gemini-2.5-flash-image-inline';
                            console.log('✅ Using inline data URL (no GCS)');
                        }
                        break; // Got image, exit loop
                    }
                }
                
                if (!imageUrl) {
                    console.log('⚠️ Gemini response did not contain an image');
                }
            } catch (error) {
                console.error('❌ Gemini generation failed:', error.message);
            }
        }
        
        // Try OpenAI DALL-E
        if (!imageUrl && openaiKey) {
            try {
                console.log('🎨 Trying OpenAI DALL-E with key:', openaiKey.substring(0, 8) + '...');
                const openaiResponse = await fetch('https://api.openai.com/v1/images/generations', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${openaiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: 'dall-e-3',
                        prompt: fullPrompt,
                        n: 1,
                        size: '1024x1024',
                        quality: 'standard',
                    }),
                });
                
                if (openaiResponse.ok) {
                    const data = await openaiResponse.json();
                    const tempUrl = data.data[0]?.url;
                    
                    if (tempUrl) {
                        console.log('✅ DALL-E generated image, downloading...');
                        
                        // Try to upload to GCS for permanent storage
                        if (bucket) {
                            try {
                                const imageResponse = await fetch(tempUrl);
                                const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
                                
                                const filename = `playlist-covers/${userId || 'anonymous'}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
                                const file = bucket.file(filename);
                                
                                await file.save(imageBuffer, {
                                    contentType: 'image/png',
                                    metadata: {
                                        cacheControl: 'public, max-age=31536000',
                                    },
                                });
                                
                                // Make file public
                                await file.makePublic();
                                
                                imageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
                                generationMethod = 'dall-e-3';
                                console.log(`✅ Uploaded to GCS: ${imageUrl}`);
                            } catch (gcsError) {
                                console.error('⚠️ GCS upload failed, using temp URL:', gcsError.message);
                                // Fall back to temp URL if GCS fails
                                imageUrl = tempUrl;
                                generationMethod = 'dall-e-3-temp';
                                console.log('✅ Using DALL-E temp URL');
                            }
                        } else {
                            // No GCS configured, use temp URL
                            imageUrl = tempUrl;
                            generationMethod = 'dall-e-3-temp';
                            console.log('✅ Using DALL-E temp URL (no GCS configured)');
                        }
                    }
                } else {
                    const errorText = await openaiResponse.text();
                    console.error('❌ OpenAI DALL-E error (status', openaiResponse.status + '):', errorText);
                }
            } catch (error) {
                console.error('❌ DALL-E generation failed:', error.message);
            }
        }
        
        // Try Stability AI as another fallback
        if (!imageUrl && stabilityKey) {
            try {
                console.log('🎨 Trying Stability AI...');
                const stabilityResponse = await fetch('https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${stabilityKey}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({
                        text_prompts: [{ text: fullPrompt, weight: 1 }],
                        cfg_scale: 7,
                        height: 1024,
                        width: 1024,
                        samples: 1,
                        steps: 30,
                    }),
                });
                
                if (stabilityResponse.ok) {
                    const data = await stabilityResponse.json();
                    const base64Image = data.artifacts?.[0]?.base64;
                    
                    if (base64Image) {
                        const imageBuffer = Buffer.from(base64Image, 'base64');
                        
                        const filename = `playlist-covers/${userId || 'anonymous'}/${Date.now()}-${Math.random().toString(36).substring(7)}.png`;
                        const file = bucket.file(filename);
                        
                        await file.save(imageBuffer, {
                            contentType: 'image/png',
                            metadata: {
                                cacheControl: 'public, max-age=31536000',
                            },
                        });
                        
                        imageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
                        generationMethod = 'stability-ai';
                        console.log(`✅ Generated cover with Stability AI: ${imageUrl}`);
                    }
                } else {
                    const errorData = await stabilityResponse.json();
                    console.error('Stability AI error:', errorData);
                }
            } catch (error) {
                console.error('Stability AI generation failed:', error.message);
            }
        }
        
        // If no API available or all failed, generate an SVG placeholder
        if (!imageUrl) {
            // Generate style-specific gradient colors
            const styleColors = {
                cartoon: { from: '#FF6B6B', to: '#4ECDC4' },
                watercolor: { from: '#A8E6CF', to: '#88D8B0' },
                pixel: { from: '#9B59B6', to: '#3498DB' },
                storybook: { from: '#F39C12', to: '#E74C3C' },
                anime: { from: '#FF69B4', to: '#9B59B6' },
                paper: { from: '#E67E22', to: '#D35400' },
                crayon: { from: '#F1C40F', to: '#E74C3C' },
                clay: { from: '#1ABC9C', to: '#16A085' },
            };
            
            const colors = styleColors[style] || { from: '#9333ea', to: '#ec4899' };
            const safeName = (playlistName || 'Playlist').replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 15);
            
            // Create SVG as data URL (works everywhere, no external dependency)
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${colors.from}"/><stop offset="100%" style="stop-color:${colors.to}"/></linearGradient></defs><rect width="512" height="512" fill="url(#g)"/><circle cx="256" cy="200" r="60" fill="rgba(255,255,255,0.25)"/><polygon points="240,175 240,225 290,200" fill="white"/><text x="256" y="320" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="white" text-anchor="middle">${safeName}</text><text x="256" y="360" font-family="Arial,sans-serif" font-size="16" fill="rgba(255,255,255,0.8)" text-anchor="middle">${selectedStyle.name} Style</text></svg>`;
            
            imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
            generationMethod = 'placeholder';
            
            console.log(`⚠️ Using SVG placeholder (no AI API configured)`);
        }
        
        res.json({
            success: true,
            imageUrl,
            generationMethod,
            style: selectedStyle,
            prompt: fullPrompt,
        });
        
    } catch (error) {
        console.error('Generate playlist cover error:', error);
        res.status(500).json({ message: 'Failed to generate cover', error: error.message });
    }
});

// POST /api/ai-generate/enhance-prompt - Use Gemini to enhance user's prompt
router.post('/enhance-prompt', async (req, res) => {
    try {
        const { prompt, style } = req.body;
        
        if (!prompt) {
            return res.status(400).json({ message: 'prompt is required' });
        }
        
        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) {
            // Return original prompt if no Gemini key
            return res.json({ enhancedPrompt: prompt });
        }
        
        const selectedStyle = ART_STYLES.find(s => s.id === style) || ART_STYLES[0];
        
        const geminiPrompt = `You are helping a child create a playlist cover image. 
The child wants: "${prompt}"
The art style is: ${selectedStyle.name} (${selectedStyle.description})

Enhance their idea into a more detailed image description that would create a beautiful, 
child-friendly playlist cover. Keep it fun, colorful, and appropriate for children.
Be concise (max 2 sentences). Only respond with the enhanced description, nothing else.`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: geminiPrompt }] }],
                }),
            }
        );
        
        if (response.ok) {
            const data = await response.json();
            const enhancedPrompt = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || prompt;
            res.json({ enhancedPrompt });
        } else {
            console.error('Gemini API error:', await response.text());
            res.json({ enhancedPrompt: prompt });
        }
        
    } catch (error) {
        console.error('Enhance prompt error:', error);
        res.json({ enhancedPrompt: req.body.prompt });
    }
});

// Color options for comment blocks
const COMMENT_COLORS = ['pink', 'yellow', 'orange', 'gold', 'blue', 'purple', 'green', 'teal', 'indigo', 'amber', 'lime', 'rose', 'cyan', 'emerald'];

// POST /api/ai/generate-book-comments - Generate personalized comments for a book
router.post('/generate-book-comments', async (req, res) => {
    try {
        const { bookTitle, bookDescription, bookContent } = req.body;
        
        if (!bookTitle) {
            return res.status(400).json({ message: 'bookTitle is required' });
        }
        
        const geminiKey = process.env.GEMINI_API_KEY;
        
        if (!geminiKey) {
            console.log('⚠️ No Gemini API key, returning fallback comments');
            return res.json({ comments: getFallbackComments(), source: 'fallback' });
        }
        
        const prompt = `Generate exactly 12 kid-friendly comment options for a children's Christian/faith-based book.

Book Title: "${bookTitle}"
${bookDescription ? `Description: ${bookDescription}` : ''}
${bookContent ? `Story excerpt: ${bookContent.substring(0, 500)}` : ''}

Create a mix of FEEDBACK-ORIENTED comments that help us understand if the content resonates:

PRIORITY COMMENTS (6 total):
- 3 comments about LEARNING something (e.g., "This taught me something!", "I learned about Jesus!", "I learned about God!")
- 3 comments about FAITH CONNECTION (e.g., "The Bible is awesome!", "I want to follow God!", "This helps me pray!")

EMOTIONAL/ENGAGEMENT COMMENTS (4 total):
- 2 comments about emotional impact (e.g., "This touched my heart!", "God bless everyone!")
- 2 comments about wanting more/sharing (e.g., "Read it again please!", "I told my friends!")

FUN/SIMPLE COMMENTS (2 total):
- 2 fun but still meaningful comments (e.g., "I love this story!", "My favorite book!")

Requirements for each comment:
- Be 3-8 words only
- Include exactly ONE relevant emoji at the start
- Be appropriate for children ages 3-10
- Focus on faith, learning, and emotional connection - NOT just surface-level reactions
- Use emojis like: 💡 ✝️ 🙏 📖 ⭐ ❤️ 🌟 ✨ 😊 👫 🔄 📚

Return ONLY a valid JSON array with exactly 12 objects. Each object must have:
- "text": the comment text (without emoji)
- "emoji": single emoji character

Example format:
[{"text":"This taught me something!","emoji":"💡"},{"text":"I learned about Jesus!","emoji":"✝️"}]

Return ONLY the JSON array, no other text.`;

        console.log(`🎯 Generating AI comments for book: "${bookTitle}"`);
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.9,
                        maxOutputTokens: 1024,
                    },
                }),
            }
        );
        
        if (!response.ok) {
            console.error('❌ Gemini API error:', await response.text());
            return res.json({ comments: getFallbackComments(), source: 'fallback' });
        }
        
        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        
        // Parse JSON from response (handle markdown code blocks)
        let jsonString = responseText;
        if (responseText.includes('```')) {
            const match = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match) {
                jsonString = match[1];
            }
        }
        
        try {
            const comments = JSON.parse(jsonString);
            
            // Validate and add colors to each comment
            const validatedComments = comments
                .filter((c) => c && c.text && c.emoji)
                .slice(0, 12)
                .map((c, index) => ({
                    text: c.text.substring(0, 50),
                    emoji: c.emoji,
                    color: COMMENT_COLORS[index % COMMENT_COLORS.length],
                }));
            
            if (validatedComments.length < 6) {
                console.log('⚠️ Not enough valid AI comments, using fallback');
                return res.json({ comments: getFallbackComments(), source: 'fallback' });
            }
            
            console.log(`✅ Generated ${validatedComments.length} AI comments for "${bookTitle}"`);
            res.json({ comments: validatedComments, source: 'ai' });
            
        } catch (parseError) {
            console.error('❌ Failed to parse AI response:', parseError.message);
            console.log('Raw response:', responseText);
            res.json({ comments: getFallbackComments(), source: 'fallback' });
        }
        
    } catch (error) {
        console.error('Generate book comments error:', error);
        res.json({ comments: getFallbackComments(), source: 'fallback' });
    }
});

// Fallback comments when AI generation fails - FEEDBACK-FOCUSED
function getFallbackComments() {
    return [
        // Learning & Faith-based feedback (high value)
        { text: "This taught me something!", emoji: "💡", color: "gold" },
        { text: "I learned about Jesus!", emoji: "✝️", color: "blue" },
        { text: "I learned about God!", emoji: "🙏", color: "purple" },
        { text: "The Bible is awesome!", emoji: "📖", color: "indigo" },
        { text: "This made me think!", emoji: "🤔", color: "teal" },
        { text: "I want to be like this!", emoji: "⭐", color: "yellow" },
        // Emotional resonance
        { text: "This touched my heart!", emoji: "❤️", color: "pink" },
        { text: "I love this story!", emoji: "😊", color: "orange" },
        { text: "God bless everyone!", emoji: "🌟", color: "cyan" },
        // Engagement feedback
        { text: "Read it again please!", emoji: "🔄", color: "green" },
        { text: "I told my friends!", emoji: "👫", color: "lime" },
        { text: "My favorite book!", emoji: "📚", color: "amber" },
    ];
}

// POST /api/ai/generate-playlist-comments - Generate personalized comments for a playlist
router.post('/generate-playlist-comments', async (req, res) => {
    try {
        const { playlistName, playlistDescription, songTitles, playlistType } = req.body;
        
        if (!playlistName) {
            return res.status(400).json({ message: 'playlistName is required' });
        }
        
        const geminiKey = process.env.GEMINI_API_KEY;
        const isAudiobook = playlistType === 'Audiobook';
        
        if (!geminiKey) {
            console.log('⚠️ No Gemini API key, returning fallback playlist comments');
            return res.json({ 
                comments: isAudiobook ? getFallbackAudiobookComments() : getFallbackPlaylistComments(), 
                source: 'fallback' 
            });
        }
        
        const songList = songTitles?.slice(0, 5).join(', ') || '';
        
        // Different prompts for audiobooks vs music - FEEDBACK-FOCUSED
        const prompt = isAudiobook 
            ? `Generate exactly 12 kid-friendly comment options for a children's Christian AUDIOBOOK/SERMON series.

Playlist Name: "${playlistName}"
${playlistDescription ? `Description: ${playlistDescription}` : ''}
${songList ? `Episodes include: ${songList}` : ''}

Create FEEDBACK-ORIENTED comments that help us understand if the content resonates:

PRIORITY COMMENTS (6 total):
- 3 comments about LEARNING something (e.g., "This taught me something!", "I learned about Jesus!", "I learned about God!")
- 3 comments about FAITH CONNECTION (e.g., "The Bible is amazing!", "I want to follow God!", "This helps me pray!")

EMOTIONAL/ENGAGEMENT COMMENTS (4 total):
- 2 comments about emotional impact (e.g., "This touched my heart!", "I feel God's love!")
- 2 comments about wanting more/sharing (e.g., "Listen to this again!", "I told my family!")

FUN/SIMPLE COMMENTS (2 total):
- 2 fun but still meaningful comments (e.g., "My favorite story!", "God bless everyone!")

Requirements:
- Be 3-8 words only
- Include exactly ONE relevant emoji (💡 ✝️ 🙏 📖 ⭐ ❤️ 🌟 ✨ 😊 👫 🔄 📚)
- Be appropriate for children ages 3-10
- Focus on faith, learning, and emotional connection
- DO NOT reference music, dancing, or singing - this is a story/sermon series!

Return ONLY a valid JSON array with exactly 12 objects:
[{"text":"This taught me something!","emoji":"💡"},{"text":"I learned about Jesus!","emoji":"✝️"}]

Return ONLY the JSON array, no other text.`
            : `Generate exactly 12 kid-friendly comment options for a children's Christian WORSHIP/MUSIC playlist.

Playlist Name: "${playlistName}"
${playlistDescription ? `Description: ${playlistDescription}` : ''}
${songList ? `Songs include: ${songList}` : ''}

Create FEEDBACK-ORIENTED comments that help us understand if the content resonates:

PRIORITY COMMENTS (6 total):
- 3 comments about LEARNING/WORSHIP (e.g., "These songs teach me!", "I love praising God!", "Music about Jesus!")
- 3 comments about FAITH CONNECTION (e.g., "I feel closer to God!", "This brings me joy!", "I want to worship!")

EMOTIONAL/ENGAGEMENT COMMENTS (4 total):
- 2 comments about emotional impact (e.g., "These songs touch my heart!", "Makes me happy inside!")
- 2 comments about engagement (e.g., "I sing this every day!", "My family loves this!")

FUN/SIMPLE COMMENTS (2 total):
- 2 fun but still meaningful comments (e.g., "God bless everyone!", "Best songs ever!")

Requirements:
- Be 3-8 words only
- Include exactly ONE relevant emoji (💡 🙏 ✝️ ⭐ ❤️ 🌟 ✨ 😊 🎵 💃 🎤 👫)
- Be appropriate for children ages 3-10
- Focus on faith, worship, and emotional connection

Return ONLY a valid JSON array with exactly 12 objects:
[{"text":"These songs teach me!","emoji":"💡"},{"text":"I love praising God!","emoji":"🙏"}]

Return ONLY the JSON array, no other text.`;

        console.log(`🎯 Generating AI comments for ${isAudiobook ? 'AUDIOBOOK' : 'MUSIC'} playlist: "${playlistName}"`);
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.9,
                        maxOutputTokens: 1024,
                    },
                }),
            }
        );
        
        if (!response.ok) {
            console.error('❌ Gemini API error:', await response.text());
            return res.json({ 
                comments: isAudiobook ? getFallbackAudiobookComments() : getFallbackPlaylistComments(), 
                source: 'fallback' 
            });
        }
        
        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        
        // Parse JSON from response (handle markdown code blocks)
        let jsonString = responseText;
        if (responseText.includes('```')) {
            const match = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (match) {
                jsonString = match[1];
            }
        }
        
        try {
            const comments = JSON.parse(jsonString);
            
            // Validate and add colors to each comment
            const validatedComments = comments
                .filter((c) => c && c.text && c.emoji)
                .slice(0, 12)
                .map((c, index) => ({
                    text: c.text.substring(0, 50),
                    emoji: c.emoji,
                    color: COMMENT_COLORS[index % COMMENT_COLORS.length],
                }));
            
            if (validatedComments.length < 6) {
                console.log('⚠️ Not enough valid AI comments, using fallback');
                return res.json({ 
                    comments: isAudiobook ? getFallbackAudiobookComments() : getFallbackPlaylistComments(), 
                    source: 'fallback' 
                });
            }
            
            console.log(`✅ Generated ${validatedComments.length} AI comments for playlist "${playlistName}"`);
            res.json({ comments: validatedComments, source: 'ai' });
            
        } catch (parseError) {
            console.error('❌ Failed to parse AI response:', parseError.message);
            console.log('Raw response:', responseText);
            res.json({ 
                comments: isAudiobook ? getFallbackAudiobookComments() : getFallbackPlaylistComments(), 
                source: 'fallback' 
            });
        }
        
    } catch (error) {
        console.error('Generate playlist comments error:', error);
        // Use playlistType from request body for fallback in outer catch
        const isAudiobookType = req.body?.playlistType === 'Audiobook';
        res.json({ 
            comments: isAudiobookType ? getFallbackAudiobookComments() : getFallbackPlaylistComments(), 
            source: 'fallback' 
        });
    }
});

// Fallback comments for MUSIC playlists when AI generation fails - FEEDBACK-FOCUSED
function getFallbackPlaylistComments() {
    return [
        // Learning & Faith-based feedback (high value)
        { text: "These songs teach me!", emoji: "💡", color: "gold" },
        { text: "I love praising God!", emoji: "🙏", color: "blue" },
        { text: "Music about Jesus!", emoji: "✝️", color: "purple" },
        { text: "This brings me joy!", emoji: "😊", color: "yellow" },
        { text: "I feel closer to God!", emoji: "⭐", color: "indigo" },
        // Emotional resonance
        { text: "These songs touch my heart!", emoji: "❤️", color: "pink" },
        { text: "Makes me happy inside!", emoji: "🌟", color: "orange" },
        { text: "God bless everyone!", emoji: "✨", color: "cyan" },
        // Engagement feedback
        { text: "I sing this every day!", emoji: "🎤", color: "green" },
        { text: "My family loves this!", emoji: "👫", color: "lime" },
        { text: "I dance and worship!", emoji: "💃", color: "teal" },
        { text: "Best songs ever!", emoji: "🎵", color: "amber" },
    ];
}

// Fallback comments for AUDIOBOOK/SERMON playlists when AI generation fails - FEEDBACK-FOCUSED
function getFallbackAudiobookComments() {
    return [
        // Learning & Faith-based feedback (high value)
        { text: "This taught me something!", emoji: "💡", color: "gold" },
        { text: "I learned about Jesus!", emoji: "✝️", color: "blue" },
        { text: "I learned about God!", emoji: "🙏", color: "purple" },
        { text: "The Bible is amazing!", emoji: "📖", color: "indigo" },
        { text: "This helps me pray!", emoji: "🙏", color: "yellow" },
        { text: "I want to follow God!", emoji: "⭐", color: "teal" },
        // Emotional resonance
        { text: "This touched my heart!", emoji: "❤️", color: "pink" },
        { text: "I feel God's love!", emoji: "✨", color: "orange" },
        { text: "God bless everyone!", emoji: "🌟", color: "cyan" },
        // Engagement feedback
        { text: "Listen to this again!", emoji: "🔄", color: "green" },
        { text: "I told my family!", emoji: "👫", color: "lime" },
        { text: "My favorite story!", emoji: "📚", color: "amber" },
    ];
}

// ===========================
// RADIO SCRIPT GENERATION
// ===========================

// POST /api/ai-generate/radio-script - Generate a radio host script for introducing a song
router.post('/radio-script', async (req, res) => {
    try {
        const { 
            hostName, 
            hostPersonality, 
            nextSongTitle, 
            nextSongArtist, 
            previousSongTitle, 
            previousSongArtist,
            targetDuration = 30, // Target duration in seconds
            stationName = 'Praise Station Radio'
        } = req.body;

        if (!nextSongTitle) {
            return res.status(400).json({ message: 'nextSongTitle is required' });
        }

        const geminiKey = process.env.GEMINI_API_KEY;
        if (!geminiKey) {
            console.log('⚠️ No Gemini API key, returning fallback radio script');
            return res.json({
                script: getFallbackRadioScript(hostName, nextSongTitle, nextSongArtist),
                source: 'fallback',
            });
        }

        // Calculate target word count (approximately 2.5 words per second for natural speech)
        const targetWordCount = Math.round(targetDuration * 2.5);

        const prompt = `You are ${hostName || 'a friendly radio host'} on "${stationName}", a Christian family radio station.

PERSONALITY: ${hostPersonality || 'Warm, encouraging, and uplifting. You love sharing God\'s love through music and bringing joy to families.'}

YOUR TASK: Write a short radio host segment that will be spoken aloud. The segment should:
1. ${previousSongTitle ? `Briefly reflect on the previous song "${previousSongTitle}"${previousSongArtist ? ` by ${previousSongArtist}` : ''} (1 sentence max)` : 'Start with a warm greeting or uplifting thought'}
2. Share a brief encouraging message, Bible verse reference, or uplifting thought (1-2 sentences)
3. Naturally introduce the upcoming song "${nextSongTitle}"${nextSongArtist ? ` by ${nextSongArtist}` : ''}

REQUIREMENTS:
- Target length: approximately ${targetWordCount} words (about ${targetDuration} seconds when spoken)
- Use natural, conversational language suitable for speaking aloud
- Keep it family-friendly and appropriate for all ages
- Sound warm and genuine, not scripted or robotic
- Include enthusiasm but don't be over-the-top
- You may reference God, Jesus, faith, blessings, or scripture naturally
- Do NOT include any stage directions, sound effects notes, or parenthetical instructions
- Write ONLY the words the host will speak

Respond with ONLY the script text, nothing else.`;

        console.log(`📻 Generating radio script for "${nextSongTitle}" with host ${hostName || 'default'}`);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.8,
                        maxOutputTokens: 300,
                    },
                }),
            }
        );

        if (!response.ok) {
            console.error('❌ Gemini API error:', await response.text());
            return res.json({
                script: getFallbackRadioScript(hostName, nextSongTitle, nextSongArtist),
                source: 'fallback',
            });
        }

        const data = await response.json();
        const scriptText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

        if (!scriptText) {
            console.log('⚠️ Empty response from Gemini, using fallback');
            return res.json({
                script: getFallbackRadioScript(hostName, nextSongTitle, nextSongArtist),
                source: 'fallback',
            });
        }

        // Clean up the script (remove any accidental stage directions)
        const cleanedScript = scriptText
            .replace(/\*[^*]+\*/g, '') // Remove *actions*
            .replace(/\([^)]+\)/g, '') // Remove (parentheticals)
            .replace(/\[[^\]]+\]/g, '') // Remove [brackets]
            .replace(/\n\s*\n/g, ' ') // Replace double newlines with space
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();

        console.log(`✅ Generated radio script: ${cleanedScript.substring(0, 100)}...`);

        res.json({
            script: cleanedScript,
            source: 'ai',
            wordCount: cleanedScript.split(/\s+/).length,
            estimatedDuration: Math.round(cleanedScript.split(/\s+/).length / 2.5),
        });

    } catch (error) {
        console.error('Generate radio script error:', error);
        res.json({
            script: getFallbackRadioScript(req.body?.hostName, req.body?.nextSongTitle, req.body?.nextSongArtist),
            source: 'fallback',
        });
    }
});

// POST /api/ai-generate/radio-scripts-batch - Generate multiple radio scripts at once
router.post('/radio-scripts-batch', async (req, res) => {
    try {
        const { segments, hostPersonality, stationName, targetDuration = 30 } = req.body;

        if (!segments || !Array.isArray(segments) || segments.length === 0) {
            return res.status(400).json({ message: 'segments array is required' });
        }

        const geminiKey = process.env.GEMINI_API_KEY;
        const results = [];

        for (let i = 0; i < segments.length; i++) {
            const segment = segments[i];
            
            if (segment.type !== 'host_break') {
                results.push({ index: i, skipped: true });
                continue;
            }

            try {
                // Small delay between requests to avoid rate limiting
                if (i > 0) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }

                const scriptResponse = await fetch(
                    `http://localhost:${process.env.PORT || 3001}/api/ai-generate/radio-script`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            hostName: segment.hostName,
                            hostPersonality: hostPersonality || segment.hostPersonality,
                            nextSongTitle: segment.nextTrack?.title,
                            nextSongArtist: segment.nextTrack?.artist,
                            previousSongTitle: segment.previousTrack?.title,
                            previousSongArtist: segment.previousTrack?.artist,
                            targetDuration,
                            stationName,
                        }),
                    }
                );

                const scriptData = await scriptResponse.json();
                results.push({
                    index: i,
                    segmentId: segment._id,
                    script: scriptData.script,
                    source: scriptData.source,
                    wordCount: scriptData.wordCount,
                    estimatedDuration: scriptData.estimatedDuration,
                });

                console.log(`📻 Generated script ${i + 1}/${segments.length}`);
            } catch (err) {
                console.error(`Error generating script for segment ${i}:`, err);
                results.push({
                    index: i,
                    segmentId: segment._id,
                    script: getFallbackRadioScript(segment.hostName, segment.nextTrack?.title, segment.nextTrack?.artist),
                    source: 'fallback',
                    error: err.message,
                });
            }
        }

        res.json({
            results,
            total: segments.length,
            generated: results.filter(r => !r.skipped && !r.error).length,
            fallbacks: results.filter(r => r.source === 'fallback').length,
        });

    } catch (error) {
        console.error('Batch radio script generation error:', error);
        res.status(500).json({ message: 'Failed to generate scripts', error: error.message });
    }
});

// Fallback radio script when AI generation fails
function getFallbackRadioScript(hostName, songTitle, songArtist) {
    const greetings = [
        "Welcome back to Praise Station Radio!",
        "You're listening to Praise Station Radio!",
        "Thanks for tuning in to Praise Station Radio!",
        "God bless you for joining us today!",
    ];

    const messages = [
        "Remember, God's love is with you always.",
        "Let this music lift your spirit today!",
        "May your day be filled with His blessings.",
        "Let's praise the Lord together!",
        "God has great plans for you!",
    ];

    const intros = [
        `Here's "${songTitle}"${songArtist ? ` by ${songArtist}` : ''}.`,
        `Coming up next, "${songTitle}"${songArtist ? ` from ${songArtist}` : ''}.`,
        `Let's listen to "${songTitle}"${songArtist ? ` by ${songArtist}` : ''}.`,
        `Up next is "${songTitle}"${songArtist ? ` by ${songArtist}` : ''}. Enjoy!`,
    ];

    const greeting = greetings[Math.floor(Math.random() * greetings.length)];
    const message = messages[Math.floor(Math.random() * messages.length)];
    const intro = intros[Math.floor(Math.random() * intros.length)];

    return `${greeting} ${message} ${intro}`;
}

module.exports = router;

