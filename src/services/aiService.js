/**
 * AI Service for generating content
 * Uses OpenAI API if available, otherwise returns placeholder content
 */

// Try to load OpenAI - it's optional
let OpenAI = null;
let openai = null;

try {
    OpenAI = require('openai');
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
} catch (e) {
    console.log('OpenAI package not installed - AI features will use placeholders');
}

/**
 * Generate an activity (quiz or reflection) from devotional content
 * @param {string} devotionalContent - The devotional text to base the activity on
 * @param {string} activityType - Either 'quiz' or 'reflection'
 * @returns {Object} Generated activity content
 */
async function generateActivityFromDevotional(devotionalContent, activityType) {
    // If no OpenAI key, return placeholder content
    if (!openai) {
        console.log('No OpenAI API key configured, returning placeholder activity');
        return generatePlaceholderActivity(activityType, devotionalContent);
    }

    try {
        const prompt = activityType === 'quiz' 
            ? `Based on the following devotional content, create a simple quiz for children aged 4-10. 
               Include 3-4 multiple choice questions that test comprehension of the key lessons.
               Return as JSON with format: { "questions": [{ "question": "...", "options": ["A", "B", "C", "D"], "correctAnswer": 0 }] }
               
               Devotional: ${devotionalContent}`
            : `Based on the following devotional content, create a reflection activity for children aged 4-10.
               Include 2-3 thoughtful questions that encourage personal reflection and application.
               Return as JSON with format: { "reflections": [{ "prompt": "...", "guidance": "..." }] }
               
               Devotional: ${devotionalContent}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [
                {
                    role: 'system',
                    content: 'You are a helpful assistant that creates educational content for Christian children. Always respond with valid JSON.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 1000,
        });

        const responseText = completion.choices[0]?.message?.content || '';
        
        // Try to parse as JSON
        try {
            // Extract JSON from response (in case there's extra text)
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (parseError) {
            console.error('Failed to parse AI response as JSON:', parseError);
        }

        // If parsing failed, return placeholder
        return generatePlaceholderActivity(activityType, devotionalContent);

    } catch (error) {
        console.error('Error calling OpenAI:', error);
        return generatePlaceholderActivity(activityType, devotionalContent);
    }
}

/**
 * Generate placeholder activity when AI is unavailable
 */
function generatePlaceholderActivity(activityType, devotionalContent) {
    if (activityType === 'quiz') {
        return {
            questions: [
                {
                    question: 'What was the main lesson in today\'s devotional?',
                    options: [
                        'God loves us',
                        'We should be kind to others',
                        'Prayer is important',
                        'All of the above'
                    ],
                    correctAnswer: 3
                },
                {
                    question: 'How can we apply this lesson in our daily life?',
                    options: [
                        'By being helpful to family',
                        'By sharing with friends',
                        'By praying every day',
                        'By reading the Bible'
                    ],
                    correctAnswer: 0
                }
            ]
        };
    } else {
        return {
            reflections: [
                {
                    prompt: 'What did you learn from today\'s story?',
                    guidance: 'Think about the main character and what happened to them.'
                },
                {
                    prompt: 'How can you be more like the person in this story?',
                    guidance: 'Think about one thing you can do today.'
                }
            ]
        };
    }
}

module.exports = {
    generateActivityFromDevotional,
};

