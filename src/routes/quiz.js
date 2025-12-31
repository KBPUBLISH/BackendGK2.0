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
        const { bookId, age, attemptNumber = 1 } = req.body;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required' });
        }

        // Determine age group
        const userAge = parseInt(age) || 6; // Default to 6 if not provided
        const ageGroup = BookQuiz.getAgeGroup(userAge);
        const currentAttempt = parseInt(attemptNumber) || 1;
        
        console.log(`📚 Quiz request for book ${bookId}, age ${userAge} (group: ${ageGroup}), attempt ${currentAttempt}`);

        // Check if quiz already exists for this book
        let existingQuiz = await BookQuiz.findOne({ bookId });
        
        // Check if we already have questions for this age group and attempt
        if (existingQuiz && existingQuiz.hasQuestionsForAge(userAge, currentAttempt)) {
            console.log(`📚 Quiz already exists for book ${bookId}, age group ${ageGroup}, attempt ${currentAttempt}`);
            return res.json({
                quiz: {
                    ...existingQuiz.toObject(),
                    questions: existingQuiz.getQuestionsForAge(userAge, currentAttempt),
                    ageGroup,
                    attemptNumber: currentAttempt
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
        
        // For attempt 2, instruct AI to create completely different questions
        const attemptInstruction = currentAttempt === 2 
            ? `\n\nIMPORTANT: This is a SECOND ATTEMPT quiz. Create COMPLETELY DIFFERENT questions from typical first-attempt questions. Focus on:
- Different story details and moments
- Different character perspectives
- Different aspects of the plot
- Questions about the ending and lessons learned
- More creative and thoughtful questions
Do NOT repeat common or obvious questions about the story.`
            : '';

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `${agePrompt}

Create exactly 6 multiple-choice questions based on the story content provided.${attemptInstruction}

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
        
        // Add questions for this age group and attempt
        existingQuiz.setQuestionsForAge(userAge, questions, currentAttempt);
        await existingQuiz.save();

        console.log(`✅ Quiz generated successfully for book: ${book.title}, age group: ${ageGroup}, attempt ${currentAttempt}`);

        res.json({
            quiz: {
                ...existingQuiz.toObject(),
                questions, // Return the questions for this age group and attempt
                ageGroup,
                attemptNumber: currentAttempt
            },
            cached: false
        });

    } catch (error) {
        console.error('Quiz Generation Error:', error.response?.data || error.message);
        res.status(500).json({ message: 'Failed to generate quiz', error: error.message });
    }
});

// POST /api/quiz/generate-first - Generate just the first question quickly
router.post('/generate-first', async (req, res) => {
    try {
        const { bookId, age, attemptNumber = 1 } = req.body;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required' });
        }

        const userAge = parseInt(age) || 6;
        const ageGroup = BookQuiz.getAgeGroup(userAge);
        const currentAttempt = parseInt(attemptNumber) || 1;

        // Check if quiz already exists for this attempt
        let existingQuiz = await BookQuiz.findOne({ bookId });
        if (existingQuiz && existingQuiz.hasQuestionsForAge(userAge, currentAttempt)) {
            const questions = existingQuiz.getQuestionsForAge(userAge, currentAttempt);
            return res.json({
                firstQuestion: questions[0],
                totalQuestions: questions.length,
                cached: true,
                ageGroup,
                attemptNumber: currentAttempt
            });
        }

        // Get book and story content
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        const pages = await Page.find({ bookId }).sort({ pageNumber: 1 });
        let storyContent = '';
        pages.forEach(page => {
            if (page.content && page.content.textBoxes) {
                page.content.textBoxes.forEach(tb => {
                    if (tb.text) {
                        const cleanText = tb.text.replace(/\[[^\]]+\]/g, '').trim();
                        if (cleanText) storyContent += cleanText + ' ';
                    }
                });
            }
            if (page.textBoxes) {
                page.textBoxes.forEach(tb => {
                    if (tb.text) {
                        const cleanText = tb.text.replace(/\[[^\]]+\]/g, '').trim();
                        if (cleanText) storyContent += cleanText + ' ';
                    }
                });
            }
        });

        if (!storyContent.trim()) {
            return res.status(400).json({ message: 'No story content found' });
        }

        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return res.status(500).json({ message: 'OpenAI API key not configured' });
        }

        // Generate just ONE question quickly
        console.log(`⚡ Quick-generating first question for book: ${book.title}, attempt ${currentAttempt}`);
        
        const agePrompt = getAgeAppropriatePrompt(userAge, ageGroup);
        
        // For attempt 2, instruct AI to create a different type of question
        const attemptInstruction = currentAttempt === 2 
            ? `\n\nIMPORTANT: This is a SECOND ATTEMPT quiz. Create a DIFFERENT warm-up question than typical. Focus on a unique detail or moment from the story that isn't commonly asked about.`
            : '';
        
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `${agePrompt}

Create exactly 1 multiple-choice question based on the story. This should be an easy warm-up question about the beginning of the story.${attemptInstruction}

Rules:
1. Create exactly 1 question
2. 4 options (A, B, C, D), only ONE correct
3. Make it about something from the start of the story
4. Keep it fun and encouraging

Return ONLY a JSON object (not array):
{
  "question": "What happened at the beginning?",
  "options": [
    { "text": "Option A", "isCorrect": false },
    { "text": "Option B", "isCorrect": true },
    { "text": "Option C", "isCorrect": false },
    { "text": "Option D", "isCorrect": false }
  ]
}`
                    },
                    {
                        role: 'user',
                        content: `Create 1 warm-up question for a ${userAge}-year-old about: "${book.title}"\n\nStory: ${storyContent.substring(0, 2000)}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 500
            },
            {
                headers: {
                    'Authorization': `Bearer ${openaiKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        let firstQuestion;
        try {
            const content = response.data.choices[0].message.content.trim();
            const jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            firstQuestion = JSON.parse(jsonContent);
        } catch (parseError) {
            console.error('Failed to parse first question:', parseError);
            return res.status(500).json({ message: 'Failed to parse question' });
        }

        console.log(`✅ First question generated for: ${book.title}, attempt ${currentAttempt}`);

        res.json({
            firstQuestion,
            totalQuestions: 6, // We'll generate 6 total
            cached: false,
            ageGroup,
            attemptNumber: currentAttempt,
            // Signal that remaining questions need to be generated
            needsRemainingQuestions: true
        });

    } catch (error) {
        console.error('First Question Generation Error:', error.response?.data || error.message);
        res.status(500).json({ message: 'Failed to generate first question', error: error.message });
    }
});

// POST /api/quiz/generate-remaining - Generate remaining questions (called in background)
router.post('/generate-remaining', async (req, res) => {
    try {
        const { bookId, age, firstQuestion, attemptNumber = 1 } = req.body;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required' });
        }

        const userAge = parseInt(age) || 6;
        const ageGroup = BookQuiz.getAgeGroup(userAge);
        const currentAttempt = parseInt(attemptNumber) || 1;

        // Check if full quiz already exists for this attempt
        let existingQuiz = await BookQuiz.findOne({ bookId });
        if (existingQuiz && existingQuiz.hasQuestionsForAge(userAge, currentAttempt)) {
            const questions = existingQuiz.getQuestionsForAge(userAge, currentAttempt);
            if (questions.length >= 6) {
                return res.json({
                    questions,
                    cached: true,
                    ageGroup,
                    attemptNumber: currentAttempt
                });
            }
        }

        // Get book and story content
        const book = await Book.findById(bookId);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }

        const pages = await Page.find({ bookId }).sort({ pageNumber: 1 });
        let storyContent = '';
        pages.forEach(page => {
            if (page.content && page.content.textBoxes) {
                page.content.textBoxes.forEach(tb => {
                    if (tb.text) {
                        const cleanText = tb.text.replace(/\[[^\]]+\]/g, '').trim();
                        if (cleanText) storyContent += cleanText + ' ';
                    }
                });
            }
            if (page.textBoxes) {
                page.textBoxes.forEach(tb => {
                    if (tb.text) {
                        const cleanText = tb.text.replace(/\[[^\]]+\]/g, '').trim();
                        if (cleanText) storyContent += cleanText + ' ';
                    }
                });
            }
        });

        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return res.status(500).json({ message: 'OpenAI API key not configured' });
        }

        // Generate remaining 5 questions
        console.log(`📝 Generating remaining questions for: ${book.title}, attempt ${currentAttempt}`);
        
        const agePrompt = getAgeAppropriatePrompt(userAge, ageGroup);
        
        // For attempt 2, instruct AI to create completely different questions
        const attemptInstruction = currentAttempt === 2 
            ? `\n\nIMPORTANT: This is a SECOND ATTEMPT quiz. Create COMPLETELY DIFFERENT questions from typical first-attempt questions. Focus on:
- Different story details and moments
- Different character perspectives  
- Different aspects of the plot
- Questions about the ending and lessons learned
- More creative and thoughtful questions
Do NOT repeat common or obvious questions about the story.`
            : '';
        
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `${agePrompt}

Create exactly 5 more multiple-choice questions. The first question was already asked: "${firstQuestion?.question || 'a warm-up question'}"${attemptInstruction}

Rules:
1. Create exactly 5 NEW questions (different from the first one)
2. Each has 4 options (A, B, C, D), only ONE correct
3. Cover different parts of the story (middle and end)
4. Include variety: characters, events, feelings, lessons
5. Make it fun!

Return ONLY a JSON array:
[
  { "question": "...", "options": [{ "text": "...", "isCorrect": false }, ...] },
  ...
]`
                    },
                    {
                        role: 'user',
                        content: `Create 5 more questions for a ${userAge}-year-old about: "${book.title}"\n\nStory: ${storyContent.substring(0, 4000)}`
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

        let remainingQuestions;
        try {
            const content = response.data.choices[0].message.content.trim();
            console.log('📝 Raw OpenAI response for remaining questions:', content.substring(0, 200));
            const jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            remainingQuestions = JSON.parse(jsonContent);
            console.log(`📝 Parsed ${remainingQuestions.length} remaining questions`);
        } catch (parseError) {
            console.error('Failed to parse remaining questions:', parseError);
            console.error('Raw content was:', response.data.choices[0]?.message?.content?.substring(0, 500));
            return res.status(500).json({ message: 'Failed to parse questions', parseError: parseError.message });
        }

        // Validate remaining questions
        if (!Array.isArray(remainingQuestions)) {
            console.error('Remaining questions is not an array:', typeof remainingQuestions);
            return res.status(500).json({ message: 'Invalid response format - expected array' });
        }

        // Combine first question with remaining
        const allQuestions = [firstQuestion, ...remainingQuestions].filter(Boolean);
        console.log(`📝 Total questions after combining: ${allQuestions.length}`);

        // Save to database
        if (!existingQuiz) {
            existingQuiz = new BookQuiz({
                bookId,
                ageGroupedQuestions: [],
                attempts: []
            });
        }
        existingQuiz.setQuestionsForAge(userAge, allQuestions, currentAttempt);
        await existingQuiz.save();

        console.log(`✅ All ${allQuestions.length} questions saved for: ${book.title}, attempt ${currentAttempt}`);

        res.json({
            questions: allQuestions,
            cached: false,
            ageGroup,
            attemptNumber: currentAttempt
        });

    } catch (error) {
        console.error('Remaining Questions Generation Error:', error);
        console.error('Error details:', error.response?.data || error.message || error.stack);
        res.status(500).json({ 
            message: 'Failed to generate remaining questions', 
            error: error.message,
            details: error.response?.data || null
        });
    }
});

// GET /api/quiz/:bookId - Get quiz for a book
router.get('/:bookId', async (req, res) => {
    try {
        const { bookId } = req.params;
        const { userId, age, attemptNumber } = req.query;

        const quiz = await BookQuiz.findOne({ bookId });
        
        if (!quiz) {
            return res.status(404).json({ message: 'Quiz not found for this book' });
        }

        const userAge = parseInt(age) || 6;
        const ageGroup = BookQuiz.getAgeGroup(userAge);
        const currentAttempt = parseInt(attemptNumber) || 1;
        
        // Get questions for the user's age group and attempt
        const questions = quiz.getQuestionsForAge(userAge, currentAttempt);
        
        if (!questions || questions.length === 0) {
            return res.status(404).json({ 
                message: 'Quiz not found for this age group and attempt',
                needsGeneration: true,
                ageGroup,
                attemptNumber: currentAttempt
            });
        }

        // Get user's attempt count
        const attemptCount = userId ? quiz.getUserAttemptCount(userId) : 0;
        const canTakeQuiz = userId ? quiz.canUserTakeQuiz(userId) : true;

        res.json({
            quiz: {
                ...quiz.toObject(),
                questions, // Return only the age-appropriate questions for this attempt
                ageGroup,
                attemptNumber: currentAttempt
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
        const { userId, answers, age, attemptNumber } = req.body;

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

        // Get questions for the user's age group and current attempt
        const userAge = parseInt(age) || 6;
        const currentAttempt = parseInt(attemptNumber) || (quiz.getUserAttemptCount(userId) + 1);
        const questions = quiz.getQuestionsForAge(userAge, currentAttempt);
        
        if (!questions || questions.length === 0) {
            return res.status(404).json({ message: 'Quiz questions not found for this age group and attempt' });
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
        const newAttemptNumber = quiz.addAttempt(userId, correctCount, coinsEarned);
        await quiz.save();

        console.log(`📊 Quiz submitted (age ${userAge}): ${correctCount}/6 correct, ${coinsEarned} coins earned`);

        res.json({
            score: correctCount,
            totalQuestions: 6,
            coinsEarned,
            attemptNumber: newAttemptNumber,
            attemptsRemaining: 2 - newAttemptNumber,
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
