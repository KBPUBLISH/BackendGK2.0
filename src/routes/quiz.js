const express = require('express');
const router = express.Router();
const axios = require('axios');
const BookQuiz = require('../models/BookQuiz');
const Book = require('../models/Book');
const Page = require('../models/Page');

// Helper function to get age-appropriate prompt with spiritual focus
const getAgeAppropriatePrompt = (age, ageGroup) => {
    const spiritualFocus = `
IMPORTANT - SPIRITUAL FOCUS:
This is a Christian children's app. Questions should help kids connect with Biblical values and deeper spiritual meaning.
Focus on:
- What the story teaches about God, Jesus, faith, or prayer
- Character virtues like kindness, forgiveness, courage, honesty, and love
- How the characters showed faith or trust in God
- What lessons about being a good Christian the story teaches
- How kids can apply these lessons in their own lives

DO NOT ask trivial recall questions like "What sound did they hear?" or "What color was the hat?"
Instead, ask questions that help kids think about the MEANING and LESSONS of the story.`;

    switch (ageGroup) {
        case '3-5':
            return `You are creating a quiz for a child aged 3-5 years old.
${spiritualFocus}

Rules for this age group (ages 3-5):
- Use VERY simple words (1-2 syllables when possible)
- Focus on basic emotions, kindness, and simple faith concepts
- Options should be short (2-4 words maximum)
- Make questions fun and encouraging
- Ask about how characters were kind, brave, or loving
- Ask about how characters trusted God or prayed
- Example: "How did the character show kindness?" with options like "Shared food", "Was mean", "Ran away", "Hid"
- Example: "What did the story teach us about?" with options like "Being brave", "Being selfish", "Being lazy", "Being scared"`;

        case '6-8':
            return `You are creating a quiz for a child aged 6-8 years old.
${spiritualFocus}

Rules for this age group (ages 6-8):
- Use simple but slightly more complex vocabulary
- Questions should explore WHY characters made good or bad choices
- Ask about Biblical virtues: faith, hope, love, patience, kindness
- Options can be short sentences (5-8 words)
- Include questions about how to apply lessons to real life
- Example: "Why was it important for the character to forgive?" 
- Example: "What does this story teach us about trusting God?"
- Example: "How could YOU be kind like the main character?"`;

        case '9-12':
            return `You are creating a quiz for a child aged 9-12 years old.
${spiritualFocus}

Rules for this age group (ages 9-12):
- Use grade-appropriate vocabulary
- Questions should test deeper spiritual understanding and themes
- Ask about character development and spiritual growth
- Include questions connecting the story to Biblical principles
- Ask how the story relates to their own faith journey
- Options can be full sentences
- Include questions about moral dilemmas and faith decisions
- Example: "What does this story teach us about God's love and forgiveness?"
- Example: "How did the character's faith help them overcome their challenge?"
- Example: "What Bible verse or teaching does this story remind you of?"`;

        default:
            return `You are creating a quiz for a child. 
${spiritualFocus}
Use age-appropriate language and focus on spiritual lessons.`;
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

        // Use book's target age if available, otherwise use user's age
        const targetAge = book.minAge || userAge;
        const targetAgeGroup = BookQuiz.getAgeGroup(targetAge);
        
        console.log('📖 Generating quiz for book:', book.title);
        console.log('📚 Book target age:', book.minAge || 'not set', '| User age:', userAge, '| Using age group:', targetAgeGroup);
        console.log('📝 Story content length:', storyContent.length, 'characters');

        // Use OpenAI to generate quiz questions
        const openaiKey = process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            return res.status(500).json({ message: 'OpenAI API key not configured' });
        }

        const agePrompt = getAgeAppropriatePrompt(targetAge, targetAgeGroup);

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
4. Questions should focus on SPIRITUAL LESSONS and DEEPER MEANING
5. Questions should help kids grow in faith and understand Biblical values
6. Include questions about:
   - What the story teaches about God, faith, or prayer
   - How characters showed virtues like kindness, forgiveness, bravery, honesty
   - What lessons kids can apply to their own lives
   - How characters trusted God or made faithful choices
7. AVOID trivial recall questions about minor details
8. Make the quiz fun and encouraging

Return your response as a valid JSON array with this exact structure:
[
  {
    "question": "What important lesson does this story teach about kindness?",
    "options": [
      { "text": "Kindness helps others feel loved", "isCorrect": true },
      { "text": "Kindness is not important", "isCorrect": false },
      { "text": "Only be kind to friends", "isCorrect": false },
      { "text": "Being kind is too hard", "isCorrect": false }
    ]
  }
]

Return ONLY the JSON array, no explanations or markdown.`
                    },
                    {
                        role: 'user',
                        content: `Create a 6-question spiritual quiz for a ${targetAge}-year-old child about this Christian story titled "${book.title}". Focus on faith, Biblical values, and life lessons:\n\n${storyContent.substring(0, 4000)}`
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

// POST /api/quiz/generate-first - Generate just the first question quickly
router.post('/generate-first', async (req, res) => {
    try {
        const { bookId, age } = req.body;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required' });
        }

        const userAge = parseInt(age) || 6;
        const ageGroup = BookQuiz.getAgeGroup(userAge);

        // Check if quiz already exists
        let existingQuiz = await BookQuiz.findOne({ bookId });
        if (existingQuiz && existingQuiz.hasQuestionsForAge(userAge)) {
            const questions = existingQuiz.getQuestionsForAge(userAge);
            return res.json({
                firstQuestion: questions[0],
                totalQuestions: questions.length,
                cached: true,
                ageGroup
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

        // Use book's target age if available
        const targetAge = book.minAge || userAge;
        const targetAgeGroup = BookQuiz.getAgeGroup(targetAge);

        // Generate just ONE question quickly
        console.log(`⚡ Quick-generating first question for book: ${book.title} (target age: ${targetAge})`);
        
        const agePrompt = getAgeAppropriatePrompt(targetAge, targetAgeGroup);
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `${agePrompt}

Create exactly 1 multiple-choice question based on the story. This should be a warm-up question that introduces the MAIN THEME or SPIRITUAL LESSON of the story.

Rules:
1. Create exactly 1 question
2. 4 options (A, B, C, D), only ONE correct
3. Focus on the story's main message, lesson, or a character's virtue
4. Keep it fun, encouraging, and spiritually meaningful
5. AVOID trivial recall questions - focus on meaning

Return ONLY a JSON object (not array):
{
  "question": "What is this story mainly about?",
  "options": [
    { "text": "Learning to trust God", "isCorrect": true },
    { "text": "Finding treasure", "isCorrect": false },
    { "text": "Playing games", "isCorrect": false },
    { "text": "Going to school", "isCorrect": false }
  ]
}`
                    },
                    {
                        role: 'user',
                        content: `Create 1 spiritual warm-up question for a ${targetAge}-year-old about this Christian story: "${book.title}". Focus on the main faith lesson or virtue:\n\nStory: ${storyContent.substring(0, 2000)}`
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

        console.log(`✅ First question generated for: ${book.title}`);

        res.json({
            firstQuestion,
            totalQuestions: 6, // We'll generate 6 total
            cached: false,
            ageGroup,
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
        const { bookId, age, firstQuestion } = req.body;

        if (!bookId) {
            return res.status(400).json({ message: 'bookId is required' });
        }

        const userAge = parseInt(age) || 6;
        const ageGroup = BookQuiz.getAgeGroup(userAge);

        // Check if full quiz already exists
        let existingQuiz = await BookQuiz.findOne({ bookId });
        if (existingQuiz && existingQuiz.hasQuestionsForAge(userAge)) {
            const questions = existingQuiz.getQuestionsForAge(userAge);
            if (questions.length >= 6) {
                return res.json({
                    questions,
                    cached: true,
                    ageGroup
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

        // Use book's target age if available
        const targetAge = book.minAge || userAge;
        const targetAgeGroup = BookQuiz.getAgeGroup(targetAge);

        // Generate remaining 5 questions
        console.log(`📝 Generating remaining questions for: ${book.title} (target age: ${targetAge})`);
        
        const agePrompt = getAgeAppropriatePrompt(targetAge, targetAgeGroup);
        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    {
                        role: 'system',
                        content: `${agePrompt}

Create exactly 5 more multiple-choice questions. The first question was already asked: "${firstQuestion?.question || 'a warm-up question'}"

Rules:
1. Create exactly 5 NEW questions (different from the first one)
2. Each has 4 options (A, B, C, D), only ONE correct
3. Focus on SPIRITUAL LESSONS and DEEPER MEANING throughout the story
4. Include variety:
   - Questions about character virtues (kindness, courage, faith, honesty)
   - Questions about what the story teaches about God or prayer
   - Questions about how kids can apply these lessons
   - Questions about how characters grew or changed
5. AVOID trivial recall questions about minor details
6. Make it fun and faith-building!

Return ONLY a JSON array:
[
  { "question": "...", "options": [{ "text": "...", "isCorrect": false }, ...] },
  ...
]`
                    },
                    {
                        role: 'user',
                        content: `Create 5 more spiritual questions for a ${targetAge}-year-old about this Christian story: "${book.title}". Focus on faith lessons and virtues:\n\nStory: ${storyContent.substring(0, 4000)}`
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
        existingQuiz.setQuestionsForAge(userAge, allQuestions);
        await existingQuiz.save();

        console.log(`✅ All ${allQuestions.length} questions saved for: ${book.title}`);

        res.json({
            questions: allQuestions,
            cached: false,
            ageGroup
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
