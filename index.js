const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Nodemailer configuration for Hostinger
const transporter = nodemailer.createTransport({
  host: 'smtp.hostinger.com',
  port: 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER, // Your Hostinger email
    pass: process.env.EMAIL_PASS  // Your Hostinger email password
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Email templates
const createVolunteerEmailTemplate = (formData) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b35, #f7931e); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
        .section { background: white; margin: 15px 0; padding: 15px; border-radius: 8px; border-left: 4px solid #ff6b35; }
        .section h3 { color: #ff6b35; margin-top: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; }
        .field { margin: 8px 0; }
        .label { font-weight: bold; color: #555; }
        .value { color: #333; }
        .footer { text-align: center; margin-top: 20px; padding: 15px; background: #e8e8e8; border-radius: 8px; font-size: 14px; color: #666; }
        .paw { font-size: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🐾 New Volunteer Application</h1>
        <p>Chester & Chubbs Foundation</p>
      </div>
      
      <div class="content">
        <div class="section">
          <h3>👤 Personal Information</h3>
          <div class="field"><span class="label">Name:</span> <span class="value">${formData.name}</span></div>
          <div class="field"><span class="label">Email:</span> <span class="value">${formData.email}</span></div>
          <div class="field"><span class="label">Phone:</span> <span class="value">${formData.phone}</span></div>
          <div class="field"><span class="label">Zip Code:</span> <span class="value">${formData.zipCode}</span></div>
        </div>
        
        <div class="section">
          <h3>🎯 Areas of Interest</h3>
          <div class="value">${formData.interests}</div>
        </div>
        
        <div class="section">
          <h3>📅 Availability</h3>
          <div class="value">${formData.availability}</div>
        </div>
        
        <div class="section">
          <h3>📝 About Themselves</h3>
          <div class="value">${formData.about}</div>
        </div>
        
        <div class="section">
          <h3>🚨 Emergency Contact</h3>
          <div class="field"><span class="label">Name:</span> <span class="value">${formData.emergencyName}</span></div>
          <div class="field"><span class="label">Phone:</span> <span class="value">${formData.emergencyPhone}</span></div>
        </div>
        
        <div class="section">
          <h3>✅ Agreements</h3>
          <div class="field"><span class="label">Adult/Consent:</span> <span class="value">${formData.adultConsent}</span></div>
          <div class="field"><span class="label">Terms Agreement:</span> <span class="value">${formData.agreeTerms}</span></div>
        </div>
      </div>
      
      <div class="footer">
        <p><span class="paw">🐾</span> You have received a new volunteer application! <span class="paw">🐾</span></p>
        <p>This email was automatically generated from our website volunteer form.</p>
      </div>
    </body>
    </html>
  `;
};

const createFosterEmailTemplate = (formData) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b35, #f7931e); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
        .section { background: white; margin: 15px 0; padding: 15px; border-radius: 8px; border-left: 4px solid #ff6b35; }
        .section h3 { color: #ff6b35; margin-top: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; }
        .field { margin: 8px 0; }
        .label { font-weight: bold; color: #555; }
        .value { color: #333; }
        .footer { text-align: center; margin-top: 20px; padding: 15px; background: #e8e8e8; border-radius: 8px; font-size: 14px; color: #666; }
        .paw { font-size: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>🏠 New Foster Application</h1>
        <p>Chester & Chubbs Foundation</p>
      </div>
      
      <div class="content">
        <div class="section">
          <h3>👤 Personal Information</h3>
          <div class="field"><span class="label">Name:</span> <span class="value">${formData.name}</span></div>
          <div class="field"><span class="label">Email:</span> <span class="value">${formData.email}</span></div>
          <div class="field"><span class="label">Phone:</span> <span class="value">${formData.phone}</span></div>
          <div class="field"><span class="label">Address:</span> <span class="value">${formData.address}</span></div>
        </div>
        
        <div class="section">
          <h3>🏡 Home Information</h3>
          <div class="field"><span class="label">Home Ownership:</span> <span class="value">${formData.homeOwnership}</span></div>
          <div class="field"><span class="label">Animal Type Preference:</span> <span class="value">${formData.animalType}</span></div>
          <div class="field"><span class="label">Has Other Pets:</span> <span class="value">${formData.hasOtherPets}</span></div>
          <div class="field"><span class="label">Availability:</span> <span class="value">${formData.availability}</span></div>
        </div>
        
        <div class="section">
          <h3>📝 About Their Home & Experience</h3>
          <div class="value">${formData.about}</div>
        </div>
        
        <div class="section">
          <h3>✅ Agreements</h3>
          <div class="field"><span class="label">Adult/Consent:</span> <span class="value">${formData.adultConsent}</span></div>
        </div>
      </div>
      
      <div class="footer">
        <p><span class="paw">🐾</span> You have received a new foster application! <span class="paw">🐾</span></p>
        <p>This email was automatically generated from our website foster application form.</p>
      </div>
    </body>
    </html>
  `;
};

const createContactEmailTemplate = (formData) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #ff6b35, #f7931e); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
        .section { background: white; margin: 15px 0; padding: 15px; border-radius: 8px; border-left: 4px solid #ff6b35; }
        .section h3 { color: #ff6b35; margin-top: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; }
        .field { margin: 8px 0; }
        .label { font-weight: bold; color: #555; }
        .value { color: #333; }
        .message-box { background: #f0f8ff; padding: 15px; border-radius: 8px; border: 1px solid #d0e7ff; margin: 10px 0; }
        .footer { text-align: center; margin-top: 20px; padding: 15px; background: #e8e8e8; border-radius: 8px; font-size: 14px; color: #666; }
        .paw { font-size: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>📧 New Contact Form Submission</h1>
        <p>Chester & Chubbs Foundation</p>
      </div>
      
      <div class="content">
        <div class="section">
          <h3>👤 Contact Information</h3>
          <div class="field"><span class="label">Name:</span> <span class="value">${formData.name}</span></div>
          <div class="field"><span class="label">Email:</span> <span class="value">${formData.email}</span></div>
          <div class="field"><span class="label">Phone:</span> <span class="value">${formData.phone || 'Not provided'}</span></div>
        </div>
        
        <div class="section">
          <h3>💬 Message</h3>
          <div class="message-box">
            <div class="value">${formData.message}</div>
          </div>
        </div>
      </div>
      
      <div class="footer">
        <p><span class="paw">🐾</span> You have received a new contact form submission! <span class="paw">🐾</span></p>
        <p>This email was automatically generated from our website contact form.</p>
      </div>
    </body>
    </html>
  `;
};

// Middleware
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'https://ccfrescue.org',
    'https://www.ccfrescue.org'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Additional CORS headers for preflight requests
app.options('*', cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:5174',
    'https://ccfrescue.org',
    'https://www.ccfrescue.org'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Chester & Chubbs Foundation API is running!' });
});

// Create payment intent endpoint
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'usd', metadata = {} } = req.body;

    // Validate amount (minimum $5.00)
    if (!amount || amount < 500) {
      return res.status(400).json({ 
        error: 'Invalid amount. Minimum donation is $5.00.' 
      });
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: currency,
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
        organization: 'Chester & Chubbs Foundation',
      },
    });

    res.json({ 
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id
    });

  } catch (error) {
    console.error('Error creating payment intent:', error);
    res.status(500).json({ 
      error: 'Error creating payment intent',
      message: error.message 
    });
  }
});

// Volunteer form submission endpoint
app.post('/api/submit-volunteer', async (req, res) => {
  try {
    const formData = req.body;
    
    // Validate required fields
    const requiredFields = ['name', 'email', 'phone', 'zipCode', 'availability', 'about', 'emergencyName', 'emergencyPhone'];
    const missingFields = requiredFields.filter(field => !formData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missingFields 
      });
    }
    
    // Check if at least one interest is selected
    const interests = Object.entries(formData.interests || {})
      .filter(([, v]) => v)
      .map(([k]) => k === 'animalCare' ? 'Animal Care' : 
                   k === 'eventsFundraising' ? 'Events & Fundraising' : 
                   k === 'transport' ? 'Transporting Animals' : 
                   k === 'adminMarketing' ? 'Admin / Marketing Support' : k)
      .join(', ');
    
    if (!interests) {
      return res.status(400).json({ 
        error: 'Please select at least one area of interest' 
      });
    }
    
    // Prepare email data
    const emailData = {
      ...formData,
      interests,
      adultConsent: formData.isAdultOrConsent ? 'Yes' : 'No',
      agreeTerms: formData.agreeWaiver ? 'Yes' : 'No'
    };
    
    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: 'New Volunteer Application - Chester & Chubbs Foundation',
      html: createVolunteerEmailTemplate(emailData)
    };
    
    await transporter.sendMail(mailOptions);
    
    res.json({ 
      success: true, 
      message: 'Volunteer application submitted successfully!' 
    });
    
  } catch (error) {
    console.error('Error submitting volunteer form:', error);
    res.status(500).json({ 
      error: 'Error submitting volunteer form',
      message: error.message 
    });
  }
});

// Foster form submission endpoint
app.post('/api/submit-foster', async (req, res) => {
  try {
    const formData = req.body;
    
    // Validate required fields
    const requiredFields = ['name', 'email', 'phone', 'address', 'homeOwnership', 'animalType', 'hasOtherPets', 'availability', 'about'];
    const missingFields = requiredFields.filter(field => !formData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missingFields 
      });
    }
    
    // Prepare email data
    const emailData = {
      ...formData,
      adultConsent: formData.isAdultOrConsent ? 'Yes' : 'No'
    };
    
    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: 'New Foster Application - Chester & Chubbs Foundation',
      html: createFosterEmailTemplate(emailData)
    };
    
    await transporter.sendMail(mailOptions);
    
    res.json({ 
      success: true, 
      message: 'Foster application submitted successfully!' 
    });
    
  } catch (error) {
    console.error('Error submitting foster form:', error);
    res.status(500).json({ 
      error: 'Error submitting foster form',
      message: error.message 
    });
  }
});

// Contact form submission endpoint
app.post('/api/submit-contact', async (req, res) => {
  try {
    const formData = req.body;
    
    // Validate required fields
    const requiredFields = ['name', 'email', 'message'];
    const missingFields = requiredFields.filter(field => !formData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missingFields 
      });
    }
    
    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: 'New Contact Form Submission - Chester & Chubbs Foundation',
      html: createContactEmailTemplate(formData)
    };
    
    await transporter.sendMail(mailOptions);
    
    res.json({ 
      success: true, 
      message: 'Contact form submitted successfully!' 
    });
    
  } catch (error) {
    console.error('Error submitting contact form:', error);
    res.status(500).json({ 
      error: 'Error submitting contact form',
      message: error.message 
    });
  }
});

// Webhook endpoint for payment confirmations
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded':
      const paymentIntent = event.data.object;
      console.log('Payment succeeded:', paymentIntent.id);
      // Here you can send confirmation emails, update database, etc.
      break;
    case 'payment_intent.payment_failed':
      const failedPayment = event.data.object;
      console.log('Payment failed:', failedPayment.id);
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({ received: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

