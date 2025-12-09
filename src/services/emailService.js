const nodemailer = require('nodemailer');

// Initialize Gmail transporter lazily
let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;
    
    const emailUser = process.env.EMAIL_USER;
    const emailPassword = process.env.EMAIL_PASSWORD;
    
    console.log('📧 Checking email config...');
    console.log('📧 EMAIL_USER:', emailUser ? `${emailUser.substring(0, 5)}...` : 'NOT SET');
    console.log('📧 EMAIL_PASSWORD:', emailPassword ? 'SET (hidden)' : 'NOT SET');
    
    if (!emailUser || !emailPassword) {
        console.warn('⚠️ EMAIL_USER or EMAIL_PASSWORD not configured - emails disabled');
        return null;
    }
    
    transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: emailUser,
            pass: emailPassword
        }
    });
    
    console.log('✅ Gmail email transporter initialized for:', emailUser);
    return transporter;
};

/**
 * Send a password reset email
 */
const sendPasswordResetEmail = async (email, resetToken, resetUrl) => {
    const transport = getTransporter();
    
    if (!transport) {
        console.log('📧 Email skipped (Gmail not configured). Reset token:', resetToken);
        return { success: false, error: 'Email service not configured' };
    }
    
    try {
        const fromEmail = process.env.EMAIL_USER || 'hello@kbpublish.org';
        const supportEmail = process.env.SUPPORT_EMAIL || 'hello@kbpublish.org';
        
        const mailOptions = {
            from: `GodlyKids <${fromEmail}>`,
            to: email,
            subject: '🔐 Reset Your GodlyKids Password',
            html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f0e8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f0e8; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: linear-gradient(135deg, #5c3d2e 0%, #3e2a1e 100%); border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
                    
                    <!-- Header -->
                    <tr>
                        <td style="padding: 30px 30px 20px; text-align: center;">
                            <h1 style="margin: 0; color: #FFD700; font-size: 28px; font-weight: bold;">GodlyKids</h1>
                            <p style="margin: 5px 0 0; color: #eecaa0; font-size: 14px;">Faith-filled adventures for kids! 🌟</p>
                        </td>
                    </tr>
                    
                    <!-- Main Content -->
                    <tr>
                        <td style="padding: 0 30px 30px;">
                            <div style="background: rgba(255,255,255,0.95); border-radius: 15px; padding: 30px; text-align: center;">
                                <div style="font-size: 50px; margin-bottom: 15px;">🔐</div>
                                <h2 style="margin: 0 0 15px; color: #3e2a1e; font-size: 22px;">Password Reset Request</h2>
                                <p style="margin: 0 0 25px; color: #5c3d2e; font-size: 15px; line-height: 1.6;">
                                    We received a request to reset your password. Click the button below to create a new password.
                                </p>
                                
                                <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: #3e2a1e; text-decoration: none; padding: 15px 40px; border-radius: 30px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 15px rgba(255,215,0,0.4);">
                                    Reset Password
                                </a>
                                
                                <p style="margin: 25px 0 0; color: #8B4513; font-size: 13px;">
                                    This link expires in <strong>1 hour</strong>.
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Security Notice -->
                    <tr>
                        <td style="padding: 0 30px 20px;">
                            <div style="background: rgba(0,0,0,0.2); border-radius: 10px; padding: 15px;">
                                <p style="margin: 0; color: #eecaa0; font-size: 12px; text-align: center;">
                                    🛡️ Didn't request this? You can safely ignore this email.<br>
                                    Your password will remain unchanged.
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                        <td style="padding: 20px 30px 30px; text-align: center; border-top: 1px solid rgba(255,255,255,0.1);">
                            <p style="margin: 0 0 10px; color: #eecaa0; font-size: 13px;">
                                Need help? Contact us at<br>
                                <a href="mailto:${supportEmail}" style="color: #FFD700;">${supportEmail}</a>
                            </p>
                            <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 11px;">
                                © ${new Date().getFullYear()} GodlyKids. All rights reserved.
                            </p>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
            `,
            text: `
GodlyKids Password Reset

We received a request to reset your password.

Click this link to reset your password:
${resetUrl}

This link expires in 1 hour.

Didn't request this? You can safely ignore this email. Your password will remain unchanged.

Need help? Contact us at ${supportEmail}

© ${new Date().getFullYear()} GodlyKids
            `.trim()
        };
        
        const info = await transport.sendMail(mailOptions);
        
        console.log('✅ Password reset email sent to:', email, 'MessageId:', info.messageId);
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('❌ Email send error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Send a welcome email after signup
 */
const sendWelcomeEmail = async (email, name) => {
    const transport = getTransporter();
    
    if (!transport) {
        console.log('📧 Welcome email skipped (Gmail not configured)');
        return { success: false, error: 'Email service not configured' };
    }
    
    try {
        const fromEmail = process.env.EMAIL_USER || 'hello@kbpublish.org';
        
        const mailOptions = {
            from: `GodlyKids <${fromEmail}>`,
            to: email,
            subject: '🎉 Welcome to GodlyKids!',
            html: `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f0e8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f0e8; padding: 40px 20px;">
        <tr>
            <td align="center">
                <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 500px; background: linear-gradient(135deg, #5c3d2e 0%, #3e2a1e 100%); border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
                    
                    <tr>
                        <td style="padding: 30px; text-align: center;">
                            <h1 style="margin: 0; color: #FFD700; font-size: 28px;">Welcome to GodlyKids! 🎉</h1>
                            <p style="margin: 15px 0 0; color: #eecaa0; font-size: 16px;">
                                Hi${name ? ` ${name}` : ''}! Your faith-filled adventure begins now!
                            </p>
                        </td>
                    </tr>
                    
                    <tr>
                        <td style="padding: 0 30px 30px;">
                            <div style="background: rgba(255,255,255,0.95); border-radius: 15px; padding: 25px; text-align: center;">
                                <p style="margin: 0; color: #5c3d2e; font-size: 15px; line-height: 1.6;">
                                    Explore Bible stories, fun games, and activities that help kids grow in faith! 📚✨
                                </p>
                            </div>
                        </td>
                    </tr>
                    
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
            `
        };
        
        const info = await transport.sendMail(mailOptions);
        
        console.log('✅ Welcome email sent to:', email);
        return { success: true, messageId: info.messageId };
        
    } catch (error) {
        console.error('❌ Email send error:', error);
        return { success: false, error: error.message };
    }
};

/**
 * Test email configuration
 */
const testEmailConfig = async () => {
    const transport = getTransporter();
    
    if (!transport) {
        return { success: false, error: 'Email not configured' };
    }
    
    try {
        await transport.verify();
        console.log('✅ Email configuration verified successfully');
        return { success: true };
    } catch (error) {
        console.error('❌ Email configuration error:', error);
        return { success: false, error: error.message };
    }
};

module.exports = {
    sendPasswordResetEmail,
    sendWelcomeEmail,
    testEmailConfig
};
