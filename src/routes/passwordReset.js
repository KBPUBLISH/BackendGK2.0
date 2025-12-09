const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const { sendPasswordResetEmail } = require('../services/emailService');

// Store reset tokens (in production, use Redis or database)
const resetTokens = new Map();

// Clean up expired tokens every hour
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of resetTokens.entries()) {
        if (data.expires < now) {
            resetTokens.delete(token);
        }
    }
}, 60 * 60 * 1000);

/**
 * Request password reset
 * POST /api/password-reset/request
 */
router.post('/request', async (req, res) => {
    console.log('📬 Password reset endpoint hit!');
    console.log('📬 Request body:', req.body);
    console.log('📬 Request origin:', req.headers.origin);
    
    const { email } = req.body;
    
    if (!email) {
        console.log('❌ No email provided in request');
        return res.status(400).json({ 
            success: false, 
            message: 'Email is required' 
        });
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    console.log('🔐 Password reset requested for:', normalizedEmail);
    
    // Log email config status
    console.log('📧 EMAIL_USER configured:', !!process.env.EMAIL_USER);
    console.log('📧 EMAIL_PASSWORD configured:', !!process.env.EMAIL_PASSWORD);
    
    try {
        // Check if user exists
        const user = await User.findOne({ email: normalizedEmail });
        
        // Always return success to prevent email enumeration attacks
        // But only actually send email if user exists
        if (!user) {
            console.log('⚠️ Password reset requested for non-existent email:', normalizedEmail);
            return res.json({ 
                success: true, 
                message: 'If an account exists with this email, you will receive reset instructions.' 
            });
        }
        
        // Generate secure reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        
        // Store token with 1 hour expiry
        resetTokens.set(tokenHash, {
            email: normalizedEmail,
            expires: Date.now() + (60 * 60 * 1000) // 1 hour
        });
        
        // Build reset URL
        const appUrl = process.env.APP_URL || 'https://app.godlykids.com';
        const resetUrl = `${appUrl}/#/reset-password?token=${resetToken}`;
        
        // Send email
        const emailResult = await sendPasswordResetEmail(normalizedEmail, resetToken, resetUrl);
        
        if (!emailResult.success) {
            console.error('❌ Failed to send reset email:', emailResult.error);
            // Still return success to prevent enumeration, but log the error
        } else {
            console.log('✅ Password reset email sent successfully');
        }
        
        res.json({ 
            success: true, 
            message: 'If an account exists with this email, you will receive reset instructions.' 
        });
        
    } catch (error) {
        console.error('❌ Password reset request error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred. Please try again later.' 
        });
    }
});

/**
 * Verify reset token
 * POST /api/password-reset/verify
 */
router.post('/verify', async (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ 
            success: false, 
            message: 'Reset token is required' 
        });
    }
    
    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const tokenData = resetTokens.get(tokenHash);
        
        if (!tokenData) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid or expired reset link. Please request a new one.' 
            });
        }
        
        if (tokenData.expires < Date.now()) {
            resetTokens.delete(tokenHash);
            return res.status(400).json({ 
                success: false, 
                message: 'Reset link has expired. Please request a new one.' 
            });
        }
        
        res.json({ 
            success: true, 
            email: tokenData.email 
        });
        
    } catch (error) {
        console.error('❌ Token verification error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred. Please try again.' 
        });
    }
});

/**
 * Reset password with token
 * POST /api/password-reset/reset
 */
router.post('/reset', async (req, res) => {
    const { token, newPassword } = req.body;
    
    if (!token || !newPassword) {
        return res.status(400).json({ 
            success: false, 
            message: 'Token and new password are required' 
        });
    }
    
    if (newPassword.length < 6) {
        return res.status(400).json({ 
            success: false, 
            message: 'Password must be at least 6 characters' 
        });
    }
    
    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const tokenData = resetTokens.get(tokenHash);
        
        if (!tokenData) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid or expired reset link. Please request a new one.' 
            });
        }
        
        if (tokenData.expires < Date.now()) {
            resetTokens.delete(tokenHash);
            return res.status(400).json({ 
                success: false, 
                message: 'Reset link has expired. Please request a new one.' 
            });
        }
        
        // Find and update user
        const user = await User.findOne({ email: tokenData.email });
        
        if (!user) {
            resetTokens.delete(tokenHash);
            return res.status(400).json({ 
                success: false, 
                message: 'User not found. Please contact support.' 
            });
        }
        
        // Update password (the pre-save hook will hash it)
        user.password = newPassword;
        await user.save();
        
        // Delete used token
        resetTokens.delete(tokenHash);
        
        console.log('✅ Password reset successful for:', tokenData.email);
        
        res.json({ 
            success: true, 
            message: 'Password reset successfully! You can now sign in with your new password.' 
        });
        
    } catch (error) {
        console.error('❌ Password reset error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred. Please try again.' 
        });
    }
});

module.exports = router;

