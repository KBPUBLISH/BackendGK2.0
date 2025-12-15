const express = require('express');
const router = express.Router();
const Influencer = require('../models/Influencer');
const User = require('../models/User');

// ==========================================
// PUBLIC ROUTES (for landing page)
// ==========================================

// GET /api/influencers/:code - Get influencer info for landing page
router.get('/:code', async (req, res) => {
    try {
        const { code } = req.params;
        const influencer = await Influencer.findOne({ 
            code: code.toUpperCase(), 
            isActive: true 
        }).select('name code discountPercent trialDays customSettings');

        if (!influencer) {
            return res.status(404).json({ message: 'Influencer code not found' });
        }

        res.json({
            name: influencer.name,
            code: influencer.code,
            discountPercent: influencer.discountPercent,
            trialDays: influencer.trialDays,
            customSettings: influencer.customSettings || {}
        });
    } catch (error) {
        console.error('Error fetching influencer:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/influencers/:code/click - Track link click
router.post('/:code/click', async (req, res) => {
    try {
        const { code } = req.params;
        const result = await Influencer.findOneAndUpdate(
            { code: code.toUpperCase(), isActive: true },
            { $inc: { 'stats.clicks': 1 } },
            { new: true }
        );

        if (!result) {
            return res.status(404).json({ message: 'Influencer code not found' });
        }

        console.log(`📊 Influencer click tracked: ${code}`);
        res.json({ success: true, clicks: result.stats.clicks });
    } catch (error) {
        console.error('Error tracking click:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/influencers/:code/signup - Track signup with attribution
router.post('/:code/signup', async (req, res) => {
    try {
        const { code } = req.params;
        const { userId, email } = req.body;

        const influencer = await Influencer.findOneAndUpdate(
            { code: code.toUpperCase(), isActive: true },
            { $inc: { 'stats.signups': 1 } },
            { new: true }
        );

        if (!influencer) {
            return res.status(404).json({ message: 'Influencer code not found' });
        }

        // Update user with referral info if userId provided
        if (userId) {
            await User.findByIdAndUpdate(userId, {
                'referredBy.influencerCode': influencer.code,
                'referredBy.influencerId': influencer._id,
                'referredBy.signedUpAt': new Date()
            });
        }

        console.log(`📊 Influencer signup tracked: ${code} - User: ${email || userId}`);
        res.json({ 
            success: true, 
            signups: influencer.stats.signups,
            influencerId: influencer._id
        });
    } catch (error) {
        console.error('Error tracking signup:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/influencers/:code/conversion - Track successful purchase
router.post('/:code/conversion', async (req, res) => {
    try {
        const { code } = req.params;
        const { userId, amount } = req.body;

        const influencer = await Influencer.findOneAndUpdate(
            { code: code.toUpperCase(), isActive: true },
            { 
                $inc: { 
                    'stats.conversions': 1,
                    'stats.totalRevenue': amount || 0
                } 
            },
            { new: true }
        );

        if (!influencer) {
            return res.status(404).json({ message: 'Influencer code not found' });
        }

        // Update user with conversion timestamp
        if (userId) {
            await User.findByIdAndUpdate(userId, {
                'referredBy.convertedAt': new Date()
            });
        }

        console.log(`📊 Influencer conversion tracked: ${code} - Amount: $${amount || 0}`);
        res.json({ 
            success: true, 
            conversions: influencer.stats.conversions,
            totalRevenue: influencer.stats.totalRevenue
        });
    } catch (error) {
        console.error('Error tracking conversion:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// ==========================================
// ADMIN ROUTES (for portal)
// ==========================================

// GET /api/influencers - List all influencers (admin)
router.get('/', async (req, res) => {
    try {
        const { active, search } = req.query;
        
        let query = {};
        if (active === 'true') query.isActive = true;
        if (active === 'false') query.isActive = false;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { code: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const influencers = await Influencer.find(query)
            .sort({ createdAt: -1 });

        res.json(influencers);
    } catch (error) {
        console.error('Error listing influencers:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// POST /api/influencers - Create new influencer (admin)
router.post('/', async (req, res) => {
    try {
        const { name, code, email, commissionPercent, discountPercent, trialDays, customSettings, notes } = req.body;

        // Validate required fields
        if (!name || !code || !email) {
            return res.status(400).json({ message: 'Name, code, and email are required' });
        }

        // Check if code already exists
        const existing = await Influencer.findOne({ code: code.toUpperCase() });
        if (existing) {
            return res.status(400).json({ message: 'This code is already in use' });
        }

        const influencer = new Influencer({
            name,
            code: code.toUpperCase(),
            email: email.toLowerCase(),
            commissionPercent: commissionPercent || 10,
            discountPercent: discountPercent || 25,
            trialDays: trialDays || 7,
            customSettings,
            notes
        });

        await influencer.save();
        console.log(`✅ New influencer created: ${code}`);
        res.status(201).json(influencer);
    } catch (error) {
        console.error('Error creating influencer:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// PUT /api/influencers/:id - Update influencer (admin)
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // If code is being updated, ensure it's uppercase
        if (updates.code) {
            updates.code = updates.code.toUpperCase();
            
            // Check if new code already exists (excluding current influencer)
            const existing = await Influencer.findOne({ 
                code: updates.code, 
                _id: { $ne: id } 
            });
            if (existing) {
                return res.status(400).json({ message: 'This code is already in use' });
            }
        }

        // If email is being updated, ensure it's lowercase
        if (updates.email) {
            updates.email = updates.email.toLowerCase();
        }

        const influencer = await Influencer.findByIdAndUpdate(
            id,
            { $set: updates },
            { new: true, runValidators: true }
        );

        if (!influencer) {
            return res.status(404).json({ message: 'Influencer not found' });
        }

        console.log(`✅ Influencer updated: ${influencer.code}`);
        res.json(influencer);
    } catch (error) {
        console.error('Error updating influencer:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// DELETE /api/influencers/:id - Delete/deactivate influencer (admin)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { permanent } = req.query;

        if (permanent === 'true') {
            // Permanent delete
            const result = await Influencer.findByIdAndDelete(id);
            if (!result) {
                return res.status(404).json({ message: 'Influencer not found' });
            }
            console.log(`🗑️ Influencer permanently deleted: ${result.code}`);
            res.json({ message: 'Influencer permanently deleted' });
        } else {
            // Soft delete (deactivate)
            const influencer = await Influencer.findByIdAndUpdate(
                id,
                { isActive: false },
                { new: true }
            );
            if (!influencer) {
                return res.status(404).json({ message: 'Influencer not found' });
            }
            console.log(`⏸️ Influencer deactivated: ${influencer.code}`);
            res.json({ message: 'Influencer deactivated', influencer });
        }
    } catch (error) {
        console.error('Error deleting influencer:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// GET /api/influencers/:id/stats - Get detailed stats (admin)
router.get('/:id/stats', async (req, res) => {
    try {
        const { id } = req.params;
        
        const influencer = await Influencer.findById(id);
        if (!influencer) {
            return res.status(404).json({ message: 'Influencer not found' });
        }

        // Get users referred by this influencer
        const referredUsers = await User.find({
            'referredBy.influencerId': id
        }).select('email createdAt referredBy.signedUpAt referredBy.convertedAt isPremium');

        // Calculate conversion rate
        const conversionRate = influencer.stats.signups > 0 
            ? ((influencer.stats.conversions / influencer.stats.signups) * 100).toFixed(1)
            : 0;

        // Calculate estimated commission
        const estimatedCommission = (influencer.stats.totalRevenue * influencer.commissionPercent / 100).toFixed(2);

        res.json({
            influencer: {
                name: influencer.name,
                code: influencer.code,
                email: influencer.email,
                commissionPercent: influencer.commissionPercent
            },
            stats: {
                ...influencer.stats,
                conversionRate: `${conversionRate}%`,
                estimatedCommission: parseFloat(estimatedCommission)
            },
            referredUsers: referredUsers.map(u => ({
                email: u.email,
                signedUpAt: u.referredBy?.signedUpAt,
                convertedAt: u.referredBy?.convertedAt,
                isPremium: u.isPremium
            }))
        });
    } catch (error) {
        console.error('Error fetching influencer stats:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;

