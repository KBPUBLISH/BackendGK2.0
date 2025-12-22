const express = require('express');
const router = express.Router();

// Initialize Stripe with secret key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Stripe Price IDs (from your Stripe dashboard)
const PRICE_IDS = {
  annual: process.env.STRIPE_PRICE_ANNUAL || 'price_annual_placeholder',
  monthly: process.env.STRIPE_PRICE_MONTHLY || 'price_monthly_placeholder',
};

/**
 * GET /api/stripe/create-checkout-session
 * Info endpoint - tells users to use POST
 */
router.get('/create-checkout-session', (req, res) => {
  res.json({ 
    message: 'Stripe checkout endpoint is working! Use POST method with: plan, userId, email, successUrl, cancelUrl',
    method: 'POST required',
    example: {
      plan: 'annual or monthly',
      userId: 'user-id',
      email: 'user@example.com',
      successUrl: 'https://app.godlykids.com/#/payment-success',
      cancelUrl: 'https://app.godlykids.com/#/paywall'
    }
  });
});

/**
 * POST /api/stripe/create-checkout-session
 * Creates a Stripe Checkout session for web purchases
 */
router.post('/create-checkout-session', async (req, res) => {
  console.log('🛒 Stripe create-checkout-session called');
  console.log('   Body:', JSON.stringify(req.body));
  
  try {
    const { plan, userId, email, successUrl, cancelUrl } = req.body;

    if (!plan || !['annual', 'monthly'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Must be "annual" or "monthly"' });
    }

    const priceId = PRICE_IDS[plan];
    
    if (!priceId || priceId.includes('placeholder')) {
      return res.status(500).json({ error: 'Stripe price not configured. Please contact support.' });
    }

    console.log('🛒 Creating Stripe checkout session:', { plan, userId, email });

    // Build checkout session options
    const sessionOptions = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl || `${process.env.FRONTEND_URL || 'https://app.godlykids.com'}/#/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.FRONTEND_URL || 'https://app.godlykids.com'}/#/paywall`,
      metadata: {
        userId: userId || 'anonymous',
        plan: plan,
      },
      subscription_data: {
        metadata: {
          userId: userId || 'anonymous',
          plan: plan,
        },
        // 7-day free trial
        trial_period_days: 7,
      },
      // Allow promotion codes
      allow_promotion_codes: true,
    };

    // Add customer email if provided
    if (email) {
      sessionOptions.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionOptions);

    console.log('✅ Stripe checkout session created:', session.id);

    res.json({ 
      sessionId: session.id,
      url: session.url,
    });

  } catch (error) {
    console.error('❌ Stripe checkout error:', error);
    res.status(500).json({ 
      error: 'Failed to create checkout session',
      message: error.message 
    });
  }
});

/**
 * POST /api/stripe/webhook
 * Handle Stripe webhooks for subscription events
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('📬 Stripe webhook received:', event.type);

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log('✅ Checkout completed:', session.id);
      
      // Get user ID from metadata
      const userId = session.metadata?.userId;
      const plan = session.metadata?.plan;
      
      if (userId && userId !== 'anonymous') {
        // Update user's premium status in database
        try {
          const User = require('../models/User');
          const AppUser = require('../models/AppUser');
          
          // Update User collection
          await User.findOneAndUpdate(
            { $or: [{ email: userId }, { _id: userId }] },
            { isPremium: true, subscriptionPlan: plan },
            { upsert: false }
          );
          
          // Update AppUser collection
          await AppUser.findOneAndUpdate(
            { $or: [{ email: userId.toLowerCase() }, { deviceId: userId }] },
            { isPremium: true, subscriptionPlan: plan },
            { upsert: false }
          );
          
          console.log(`✅ Updated premium status for user: ${userId}`);
        } catch (dbError) {
          console.error('❌ Database update error:', dbError);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const userId = subscription.metadata?.userId;
      
      console.log('❌ Subscription cancelled:', subscription.id);
      
      if (userId && userId !== 'anonymous') {
        try {
          const User = require('../models/User');
          const AppUser = require('../models/AppUser');
          
          await User.findOneAndUpdate(
            { $or: [{ email: userId }, { _id: userId }] },
            { isPremium: false }
          );
          
          await AppUser.findOneAndUpdate(
            { $or: [{ email: userId.toLowerCase() }, { deviceId: userId }] },
            { isPremium: false }
          );
          
          console.log(`✅ Removed premium status for user: ${userId}`);
        } catch (dbError) {
          console.error('❌ Database update error:', dbError);
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log('⚠️ Payment failed for invoice:', invoice.id);
      break;
    }

    default:
      console.log(`ℹ️ Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

/**
 * GET /api/stripe/verify-session/:sessionId
 * Verify a checkout session was successful
 */
router.get('/verify-session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (session.payment_status === 'paid' || session.status === 'complete') {
      res.json({ 
        success: true, 
        isPremium: true,
        plan: session.metadata?.plan,
        customerId: session.customer,
      });
    } else {
      res.json({ 
        success: false, 
        isPremium: false,
        status: session.status,
      });
    }
  } catch (error) {
    console.error('❌ Session verification error:', error);
    res.status(500).json({ error: 'Failed to verify session' });
  }
});

module.exports = router;

