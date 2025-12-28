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
        
        let imageUrl = null;
        let generationMethod = 'placeholder';
        
        // Try Google Imagen (via Gemini API) first
        if (!imageUrl && geminiKey) {
            try {
                console.log('🎨 Trying Google Imagen...');
                const imagenResponse = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${geminiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            instances: [{ prompt: fullPrompt }],
                            parameters: {
                                sampleCount: 1,
                                aspectRatio: '1:1',
                                safetyFilterLevel: 'block_low_and_above',
                                personGeneration: 'dont_allow',
                            },
                        }),
                    }
                );
                
                if (imagenResponse.ok) {
                    const data = await imagenResponse.json();
                    const base64Image = data.predictions?.[0]?.bytesBase64Encoded;
                    
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
                        generationMethod = 'google-imagen';
                        console.log(`✅ Generated cover with Google Imagen: ${imageUrl}`);
                    }
                } else {
                    const errorText = await imagenResponse.text();
                    console.error('Google Imagen error:', errorText);
                }
            } catch (error) {
                console.error('Google Imagen generation failed:', error.message);
            }
        }
        
        // Try OpenAI DALL-E as fallback
        if (!imageUrl && openaiKey) {
            try {
                console.log('🎨 Trying OpenAI DALL-E...');
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
                        // Download and upload to GCS for permanent storage
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
                        
                        imageUrl = `https://storage.googleapis.com/${bucket.name}/${filename}`;
                        generationMethod = 'dall-e-3';
                        console.log(`✅ Generated cover with DALL-E 3: ${imageUrl}`);
                    }
                } else {
                    const errorData = await openaiResponse.json();
                    console.error('OpenAI DALL-E error:', errorData);
                }
            } catch (error) {
                console.error('DALL-E generation failed:', error.message);
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
        
        // If no API available or all failed, use a placeholder based on style
        if (!imageUrl) {
            // Use style-based placeholder images
            const placeholders = {
                cartoon: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-cartoon.png',
                watercolor: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-watercolor.png',
                pixel: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-pixel.png',
                storybook: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-storybook.png',
                anime: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-anime.png',
                paper: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-paper.png',
                crayon: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-crayon.png',
                clay: 'https://storage.googleapis.com/godly-kids-media/placeholders/playlist-clay.png',
            };
            
            // Default colorful gradient placeholder
            imageUrl = placeholders[style] || 'https://via.placeholder.com/1024x1024/6366f1/ffffff?text=🎵';
            generationMethod = 'placeholder';
            
            console.log(`⚠️ Using placeholder image (AI generation failed or no API configured): ${imageUrl}`);
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

