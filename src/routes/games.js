const express = require('express');
const router = express.Router();

// Daily tasks for gamification
const dailyTasks = [
    { id: 'read_book', title: 'Read a Book', description: 'Read any book from start to finish', coinReward: 10, type: 'book' },
    { id: 'watch_lesson', title: 'Watch a Lesson', description: 'Complete a daily video lesson', coinReward: 15, type: 'lesson' },
    { id: 'complete_quiz', title: 'Complete a Quiz', description: 'Finish a book quiz with 70%+ score', coinReward: 20, type: 'quiz' },
    { id: 'listen_playlist', title: 'Listen to Music', description: 'Listen to a full playlist', coinReward: 10, type: 'playlist' },
];

// GET /api/games/daily-tasks - Get daily tasks
router.get('/daily-tasks', async (req, res) => {
    try {
        res.json(dailyTasks);
    } catch (error) {
        console.error('Error fetching daily tasks:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/games/complete-task - Mark a task as complete
router.post('/complete-task', async (req, res) => {
    try {
        const { userId, taskId, profileId } = req.body;
        
        if (!userId || !taskId) {
            return res.status(400).json({ error: 'userId and taskId are required' });
        }

        const task = dailyTasks.find(t => t.id === taskId);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // In a full implementation, you'd track this in the database
        // and prevent duplicate completions for the same day

        res.json({ 
            success: true, 
            coinsEarned: task.coinReward,
            message: `Completed "${task.title}" and earned ${task.coinReward} coins!`
        });
    } catch (error) {
        console.error('Error completing task:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/games/leaderboard - Get leaderboard
router.get('/leaderboard', async (req, res) => {
    try {
        // Placeholder - would query users sorted by coins/points
        res.json([]);
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/games/achievements - Get available achievements
router.get('/achievements', async (req, res) => {
    try {
        const achievements = [
            { id: 'first_book', title: 'Bookworm Beginner', description: 'Read your first book', icon: '📖' },
            { id: 'five_books', title: 'Avid Reader', description: 'Read 5 books', icon: '📚' },
            { id: 'first_quiz', title: 'Quiz Starter', description: 'Complete your first quiz', icon: '❓' },
            { id: 'perfect_quiz', title: 'Quiz Master', description: 'Get 100% on a quiz', icon: '🏆' },
            { id: 'week_streak', title: 'Week Warrior', description: 'Use the app 7 days in a row', icon: '🔥' },
        ];
        res.json(achievements);
    } catch (error) {
        console.error('Error fetching achievements:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;

