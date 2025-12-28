const express = require('express');
const router = express.Router();
const { Storage } = require('@google-cloud/storage');
const fetch = require('node-fetch');

// Initialize GCS
const storage = new Storage({
    projectId: process.env.GCS_PROJECT_ID,
    keyFilename: process.env.GCS_KEY_FILE,
});
const bucket = storage.bucket(process.env.GCS_BUCKET || 'godly-kids-media');

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
        
        // NOTE: Google Imagen via Gemini API requires a different endpoint/setup
        // Skipping for now - using DALL-E directly which works better
        // Future: Set up Vertex AI for Imagen support
        
        // Try OpenAI DALL-E as fallback
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
                        // Return the DALL-E URL directly (valid for ~1 hour)
                        // For production, you'd want to download and re-upload to your own storage
                        imageUrl = tempUrl;
                        generationMethod = 'dall-e-3';
                        console.log(`✅ Generated cover with DALL-E 3 (temp URL)`);
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

module.exports = router;

