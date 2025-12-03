const express = require('express');
const router = express.Router();
const axios = require('axios');
const BookQuiz = require('../models/BookQuiz');
const Book = require('../models/Book');
const Page = require('../models/Page');

// Helper function to get age-appropriate prompt
const getAgeAppropriatePrompt = (age, ageGroup) => {
    switch (ageGroup) {
        case '3-5':
            return `You are creating a quiz for a child aged 3-5 years old.
Rules for this age group:
- Use VERY simple words (1-2 syllables when possible)
- Questions should be about basic things: colors, animals, characters, simple actions
- Options should be short (2-4 words maximum)
- Make questions fun and encouraging
- Focus on "what" and "who" questions, not "why" or "how"
- Include picture-friendly concepts (things kids can visualize)
- Example: "What color was the bunny?" with options like "White", "Blue", "Green", "Red"`;

        case '6-8':
            return `You are creating a quiz for a child aged 6-8 years old.
Rules for this age group:
- Use simple but slightly more complex vocabulary
- Questions can include basic comprehension and sequence of events
- Options can be short sentences (5-8 words)
- Include some "why" questions with simple reasoning
- Test memory of story details and character names
- Example: "Why did the farmer go to the field?" with options about the story`;

        case '9-12':
            return `You are creating a quiz for a child aged 9-12 years old.
Rules for this age group:
- Use grade-appropriate vocabulary
- Questions should test deeper comprehension and themes
- Include inference questions (what might happen next, why characters acted a certain way)
- Options can be full sentences
- Include questions about lessons learned and moral of the story
- Test understanding of cause and effect
- Example: "What lesson did the main character learn about friendship?"`;

        default:
            return `You are creating a quiz for a child. Use age-appropriate language and concepts.`;
    }
};

// POST /api/quiz/generate - Generate a quiz for a book using AI
router.post('/generate', async (req, res) => {
    try {
        const { bookId, age } = req.body;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required' });
        }

        // Determine age group
        const userAge = parseInt(age) || 6; // Default to 6 if not provided
        const ageGroup = BookQuiz.getAgeGroup(userAge);
        
        console.log(`📚 Quiz request for book ${bookId}, age ${userAge} (group: ${ageGroup})`);

        // Check if quiz already exists for this book
        let existingQuiz = await BookQuiz.findOne({ bookId });
        
        // Check if we already have questions for this age group
        if (existingQuiz && existingQuiz.hasQuestionsForAge(userAge)) {
            console.log(`📚 Quiz already exists for book ${bookId}, age group ${ageGroup}`);
            return res.json({
                quiz: {
                    ...existingQuiz.toObject(),
                    questions: existingQuiz.getQuestionsForAge(userAge),
                    ageGroup
                },
                cached: true
            });
        }

        // Get book details
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        // Get all pages for the book to extract the story content
        const pages = await Page.find({ bookId }).sort({ pageNumber: 1 });
        
        // Extract text content from all pages
        let storyContent = '';
        pages.forEach(page => {
            if (page.content && page.content.textBoxes) {
                page.content.textBoxes.forEach(tb => {
                    if (tb.text) {
                        // Remove emotional cues like [excited], [pause], etc.
                        const cleanText = tb.text.replace(/\[[^\]]+\]/g, '').trim();
                        if (cleanText) {
                            storyContent += cleanText + ' ';
                        }
                    }
                });
            }
            // Also check legacy textBoxes field
            if (page.textBoxes) {
                page.textBoxes.forEach(tb => {
                    if (tb.text) {
                        const cleanText = tb.text.replace(/\[[^\]]+\]/g, '').trim();
                        if (cleanText) {
                            storyContent += cleanText + ' ';
                        }
                    }
                });
            }
        });

        if (!storyContent.trim()) {
            return res.status(400).json({ message: 'No story content found in book pages' });
        }

        console.log('📖 Generating quiz for book:', book.title, 'Age group:', ageGroup);
        console.log('📝 Story content length:', storyContent.length, 'characters');

        // Use OpenAI to generate quiz questions
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return res.status(500).json({ message: 'OpenAI API key not configured' });
        }

        const agePrompt = getAgeAppropriatePrompt(userAge, ageGroup);

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `${agePrompt}

Create exactly 6 multiple-choice questions based on the story content provided.

General Rules:
1. Create exactly 6 multiple-choice questions
2. Each question should have exactly 4 options (A, B, C, D)
3. Only ONE option should be correct per question
4. Questions should test comprehension, not trick the child
5. Questions should cover different parts of the story
6. Include questions about characters, events, and feelings
7. Make the quiz fun and encouraging

Return your response as a valid JSON array with this exact structure:
[
  {
    "question": "What did the main character do first?",
    "options": [
      { "text": "Went to school", "isCorrect": false },
      { "text": "Ate breakfast", "isCorrect": true },
      { "text": "Played outside", "isCorrect": false },
      { "text": "Read a book", "isCorrect": false }
    ]
  }
]

Return ONLY the JSON array, no explanations or markdown.`
                    },
                    {
                        role: 'user',
                        content: `Create a 6-question quiz for a ${userAge}-year-old child about this story titled "${book.title}":\n\n${storyContent.substring(0, 4000)}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 2000
            },
            {
                headers: {
                    'Authorization': `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        let questions;
        try {
            const content = response.data.choices[0].message.content.trim();
            // Remove markdown code blocks if present
            const jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            questions = JSON.parse(jsonContent);
        } catch (parseError) {
            console.error('Failed to parse AI response:', parseError);
            return res.status(500).json({ message: 'Failed to parse quiz questions from AI' });
        }

        // Validate questions structure
        if (!Array.isArray(questions) || questions.length !== 6) {
            console.error('Invalid questions array:', questions);
            return res.status(500).json({ message: 'AI generated invalid quiz format' });
        }

        // Create or update the quiz
        if (!existingQuiz) {
            existingQuiz = new BookQuiz({
                bookId,
                ageGroupedQuestions: [],
                attempts: []
            });
        }
        
        // Add questions for this age group
        existingQuiz.setQuestionsForAge(userAge, questions);
        await existingQuiz.save();

        console.log(`✅ Quiz generated successfully for book: ${book.title}, age group: ${ageGroup}`);

        res.json({
            quiz: {
                ...existingQuiz.toObject(),
                questions, // Return the questions for this age group
                ageGroup
            },
            cached: false
        });

    } catch (error) {
        console.error('Quiz Generation Error:', error.response?.data || error.message);
        res.status(500).json({ message: 'Failed to generate quiz', error: error.message });
    }
});

// GET /api/quiz/:bookId - Get quiz for a book
router.get('/:bookId', async (req, res) => {
    try {
        const { bookId } = req.params;
        const { userId, age } = req.query;

        const quiz = await BookQuiz.findOne({ bookId });
        
        if (!quiz) {
            return res.status(404).json({ message: 'Quiz not found for this book' });
        }

        const userAge = parseInt(age) || 6;
        const ageGroup = BookQuiz.getAgeGroup(userAge);
        
        // Get questions for the user's age group
        const questions = quiz.getQuestionsForAge(userAge);
        
        if (!questions || questions.length === 0) {
            return res.status(404).json({ 
                message: 'Quiz not found for this age group',
                needsGeneration: true,
                ageGroup
            });
        }

        // Get user's attempt count
        const attemptCount = userId ? quiz.getUserAttemptCount(userId) : 0;
        const canTakeQuiz = userId ? quiz.canUserTakeQuiz(userId) : true;

        res.json({
            quiz: {
                ...quiz.toObject(),
                questions, // Return only the age-appropriate questions
                ageGroup
            },
            attemptCount,
            canTakeQuiz,
            maxAttempts: 2
        });

    } catch (error) {
        console.error('Get Quiz Error:', error.message);
        res.status(500).json({ message: 'Failed to get quiz', error: error.message });
    }
});

// POST /api/quiz/:bookId/submit - Submit quiz answers
router.post('/:bookId/submit', async (req, res) => {
    try {
        const { bookId } = req.params;
        const { userId, answers, age } = req.body;

        if (!userId) {
            return res.status(400).json({ message: 'userId is required' });
        }

        if (!answers || !Array.isArray(answers)) {
            return res.status(400).json({ message: 'answers array is required' });
        }

        const quiz = await BookQuiz.findOne({ bookId });
        
        if (!quiz) {
            return res.status(404).json({ message: 'Quiz not found for this book' });
        }

        // Check if user can still take the quiz
        if (!quiz.canUserTakeQuiz(userId)) {
            return res.status(400).json({ 
                message: 'Maximum attempts reached',
                attemptCount: 2,
                maxAttempts: 2
            });
        }

        // Get questions for the user's age group
        const userAge = parseInt(age) || 6;
        const questions = quiz.getQuestionsForAge(userAge);
        
        if (!questions || questions.length === 0) {
            return res.status(404).json({ message: 'Quiz questions not found for this age group' });
        }

        // Calculate score
        let correctCount = 0;
        const results = questions.map((q, index) => {
            const userAnswer = answers[index];
            const correctOption = q.options.findIndex(opt => opt.isCorrect);
            const isCorrect = userAnswer === correctOption;
            if (isCorrect) correctCount++;
            return {
                questionIndex: index,
                userAnswer,
                correctAnswer: correctOption,
                isCorrect
            };
        });

        // Calculate coins (10 per correct answer)
        const coinsEarned = correctCount * 10;

        // Record the attempt
        const attemptNumber = quiz.addAttempt(userId, correctCount, coinsEarned);
        await quiz.save();

        console.log(`📊 Quiz submitted (age ${userAge}): ${correctCount}/6 correct, ${coinsEarned} coins earned`);

        res.json({
            score: correctCount,
            totalQuestions: 6,
            coinsEarned,
            attemptNumber,
            attemptsRemaining: 2 - attemptNumber,
            results
        });

    } catch (error) {
        console.error('Submit Quiz Error:', error.message);
        res.status(500).json({ message: 'Failed to submit quiz', error: error.message });
    }
});

// GET /api/quiz/:bookId/attempts/:userId - Get user's attempts for a book quiz
router.get('/:bookId/attempts/:userId', async (req, res) => {
    try {
        const { bookId, userId } = req.params;

        const quiz = await BookQuiz.findOne({ bookId });
        
        if (!quiz) {
            return res.json({
                attemptCount: 0,
                canTakeQuiz: true,
                maxAttempts: 2,
                attempts: []
            });
        }

        const userAttempts = quiz.attempts.filter(a => a.godlykids_user_id === userId);
        const attemptCount = userAttempts.length;

        res.json({
            attemptCount,
            canTakeQuiz: attemptCount < 2,
            maxAttempts: 2,
            attempts: userAttempts
        });

    } catch (error) {
        console.error('Get Attempts Error:', error.message);
        res.status(500).json({ message: 'Failed to get attempts', error: error.message });
    }
});

// GET /api/quiz/:bookId/age-groups - Get available age groups for a book's quiz
router.get('/:bookId/age-groups', async (req, res) => {
    try {
        const { bookId } = req.params;

        const quiz = await BookQuiz.findOne({ bookId });
        
        if (!quiz) {
            return res.json({ ageGroups: [] });
        }

        const ageGroups = quiz.ageGroupedQuestions.map(g => ({
            ageGroup: g.ageGroup,
            questionCount: g.questions.length
        }));

        res.json({ ageGroups });

    } catch (error) {
        console.error('Get Age Groups Error:', error.message);
        res.status(500).json({ message: 'Failed to get age groups', error: error.message });
    }
});

module.exports = router;
