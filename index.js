const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const multer = require('multer');
const mysql = require('mysql2/promise');

// Load environment variables - try .env.dev first, then .env
try {
  require('dotenv').config({ path: '.env.dev' });
  console.log('Loaded .env.dev configuration');
} catch (error) {
  require('dotenv').config();
  console.log('Loaded .env configuration');
}

const app = express();

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads', 'pets');
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      const error = new Error('Only image files are allowed!');
      error.code = 'INVALID_FILE_TYPE';
      cb(error, false);
    }
  }
});

// Error handling middleware for multer
const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'File size must be less than 5MB'
      });
    }
    return res.status(400).json({
      error: 'File upload error',
      message: error.message
    });
  }
  if (error.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({
      error: 'Invalid file type',
      message: 'Only image files are allowed'
    });
  }
  next(error);
};

// MySQL Database Configuration function
function getDbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ccfrescue_dev',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  };
}

// Create database connection pool
let pool;

// Ensure directories exist for uploads
async function ensureDirectories() {
  try {
    await fs.mkdir(path.join(__dirname, 'uploads', 'pets'), { recursive: true });
  } catch (error) {
    console.error('Error creating directories:', error);
  }
}

// Database initialization
async function initializeDatabase() {
  try {
    console.log('Attempting to connect to database...');
    
    // Get current database configuration
    const dbConfig = getDbConfig();
    
    // Debug: Log database configuration
    console.log('Environment:', process.env.NODE_ENV);
    console.log('Database Config:', {
      host: dbConfig.host,
      user: dbConfig.user,
      database: dbConfig.database,
      port: dbConfig.port,
      password: dbConfig.password ? '[HIDDEN]' : '[EMPTY]'
    });
    
    // Create connection pool
    pool = mysql.createPool(dbConfig);
    
    // Use direct connection for initialization
    const connection = await mysql.createConnection(dbConfig);
    console.log('✅ Database connection successful!');
    
    // Test the connection
    await connection.execute('SELECT 1 as test');
    console.log('✅ Database query test successful!');
    
    // Create animals table if it doesn't exist (matching your actual schema)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS animals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        species VARCHAR(50) NOT NULL,
        breed VARCHAR(100),
        age_months INT,
        gender VARCHAR(10),
        size VARCHAR(20),
        color VARCHAR(100),
        description TEXT,
        intake_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'available',
        medical_notes TEXT,
        behavior_notes TEXT,
        special_needs TEXT,
        photo_urls LONGTEXT,
        primary_photo_index INT DEFAULT 0,
        microchip_id VARCHAR(100),
        adoption_fee DECIMAL(10,2),
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    
    // Add primary_photo_index column if it doesn't exist (for existing databases)
    try {
      await connection.execute(`
        ALTER TABLE animals 
        ADD COLUMN IF NOT EXISTS primary_photo_index INT DEFAULT 0
      `);
      console.log('✅ Primary photo index column added/verified');
    } catch (error) {
      console.log('Primary photo index column already exists or error adding:', error.message);
    }
    
    // Add naming convention columns if they don't exist
    const namingColumns = [
      { name: 'location_code', type: 'VARCHAR(10)', default: "'SA'" },
      { name: 'pet_id_code', type: 'VARCHAR(100)', default: null },
      { name: 'foster_code', type: 'VARCHAR(20)', default: null },
      { name: 'is_medical', type: 'TINYINT(1)', default: '0' },
      { name: 'intake_type', type: 'VARCHAR(20)', default: null }
    ];
    
    for (const col of namingColumns) {
      try {
        // Check if column exists first (MySQL doesn't support IF NOT EXISTS in ALTER TABLE)
        const [columns] = await connection.execute(`
          SELECT COLUMN_NAME 
          FROM INFORMATION_SCHEMA.COLUMNS 
          WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_NAME = 'animals' 
          AND COLUMN_NAME = ?
        `, [col.name]);
        
        if (columns.length === 0) {
          await connection.execute(`
            ALTER TABLE animals 
            ADD COLUMN ${col.name} ${col.type}${col.default ? ` DEFAULT ${col.default}` : ''}
          `);
          console.log(`✅ ${col.name} column added`);
        } else {
          console.log(`✅ ${col.name} column already exists`);
        }
      } catch (error) {
        console.log(`Error checking/adding ${col.name} column:`, error.message);
      }
    }
    
    await connection.end();
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    console.log('Continuing without database initialization...');
  }
}

// Naming Convention Functions
function getTypeCode(species) {
  const typeMap = {
    'cat': 'CAT',
    'dog': 'DOG',
    'rabbit': 'RBT',
    'bird': 'BRD',
    'hamster': 'HMS',
    'guinea pig': 'GPG',
    'ferret': 'FRT',
    'other': 'OTH'
  };
  return typeMap[species?.toLowerCase()] || 'OTH';
}

function formatDateForCode(date) {
  // date can be Date object or YYYY-MM-DD string
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

async function getNextSequentialNumber(locationCode, intakeDate, typeCode) {
  try {
    const dateStr = formatDateForCode(intakeDate);
    const basePattern = `CCF-${locationCode}-${dateStr}-${typeCode}-`;
    
    // Get all pets matching the base pattern and extract their sequential numbers
    const [rows] = await pool.execute(`
      SELECT pet_id_code 
      FROM animals 
      WHERE location_code = ? 
      AND DATE_FORMAT(intake_date, '%Y%m%d') = ? 
      AND pet_id_code LIKE ?
    `, [locationCode, dateStr, `${basePattern}%`]);
    
    // Extract sequential numbers from pet_id_code
    // Pattern: CCF-[LOC]-[DATE]-[TYPE]-[SEQ] or CCF-[LOC]-[DATE]-[TYPE]-[SEQ]-[ADDONS]
    const sequentialNumbers = rows
      .map(row => {
        const code = row.pet_id_code || '';
        // Match the sequential number part (3 digits after the type code)
        const match = code.match(new RegExp(`${basePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d{3})`));
        return match ? parseInt(match[1]) : 0;
      })
      .filter(num => num > 0);
    
    // Get the highest sequential number and add 1
    const maxSeq = sequentialNumbers.length > 0 ? Math.max(...sequentialNumbers) : 0;
    return String(maxSeq + 1).padStart(3, '0');
  } catch (error) {
    console.error('Error getting sequential number:', error);
    return '001'; // Default to 001 on error
  }
}

async function generatePetIdCode(petData) {
  try {
    const locationCode = petData.locationCode || 'SA';
    const intakeDate = petData.intakeDate || new Date();
    const typeCode = getTypeCode(petData.species);
    const sequential = await getNextSequentialNumber(locationCode, intakeDate, typeCode);
    
    // Base ID: CCF-[LocationCode]-[YYYYMMDD]-[TypeCode]-[Sequential#]
    let petIdCode = `CCF-${locationCode}-${formatDateForCode(intakeDate)}-${typeCode}-${sequential}`;
    
    // Add optional add-ons
    if (petData.fosterCode) {
      petIdCode += `-${petData.fosterCode}`;
    }
    
    if (petData.isMedical) {
      petIdCode += '-MED';
    }
    
    if (petData.intakeType) {
      petIdCode += `-${petData.intakeType.toUpperCase()}`;
    }
    
    return petIdCode;
  } catch (error) {
    console.error('Error generating pet ID code:', error);
    return null;
  }
}

// Pet data management functions
async function getPets() {
  try {
    const [rows] = await pool.execute('SELECT * FROM animals ORDER BY created_at DESC');
    
    // Map database fields to frontend expected format
    const mappedPets = rows.map(animal => {
      // Debug photo_urls processing
      console.log(`Processing animal ${animal.id} (${animal.name}):`);
      console.log(`  Raw photo_urls:`, animal.photo_urls);
      console.log(`  Primary photo index:`, animal.primary_photo_index);
      console.log(`  Type:`, typeof animal.photo_urls);
      
      let imageUrl = '';
      let allPhotoUrls = [];
      
      if (animal.photo_urls) {
        try {
          if (typeof animal.photo_urls === 'string') {
            allPhotoUrls = JSON.parse(animal.photo_urls);
          } else {
            allPhotoUrls = animal.photo_urls;
          }
          
          // Use primary photo index to select the correct photo
          const primaryIndex = animal.primary_photo_index || 0;
          if (Array.isArray(allPhotoUrls) && allPhotoUrls.length > 0) {
            // Ensure index is within bounds, fallback to first photo if invalid
            const validIndex = primaryIndex >= 0 && primaryIndex < allPhotoUrls.length ? primaryIndex : 0;
            imageUrl = allPhotoUrls[validIndex] || '';
          }
        } catch (e) {
          console.log(`  JSON parse error:`, e.message);
          imageUrl = animal.photo_urls || '';
          allPhotoUrls = [];
        }
      }
      
      console.log(`  All photo URLs:`, allPhotoUrls);
      console.log(`  Final imageUrl:`, imageUrl);
      
      return {
        id: animal.id,
        name: animal.name,
        species: animal.species,
        breed: animal.breed || '',
        age: animal.age_months ? `${Math.floor(animal.age_months / 12)} years ${animal.age_months % 12} months` : 'Unknown',
        gender: animal.gender || 'Unknown',
        size: animal.size || 'Unknown',
        color: animal.color || 'Unknown',
        status: animal.status || 'available',
        description: animal.description || '',
        specialNeeds: animal.special_needs || '',
        medicalInfo: animal.medical_notes || '',
        behaviorNotes: animal.behavior_notes || '',
        location: '', // Not in your schema
        imageUrl: imageUrl,
        allPhotoUrls: allPhotoUrls,
        primaryPhotoIndex: animal.primary_photo_index || 0,
        microchipId: animal.microchip_id || '',
        adoptionFee: animal.adoption_fee || 0,
        intakeDate: animal.intake_date,
        dateAdded: animal.created_at,
        lastUpdated: animal.updated_at,
        petIdCode: animal.pet_id_code || '',
        locationCode: animal.location_code || '',
        fosterCode: animal.foster_code || '',
        isMedical: animal.is_medical || false,
        intakeType: animal.intake_type || ''
      };
    });
    
    return mappedPets;
  } catch (error) {
    console.error('Error fetching pets from database:', error);
    return [];
  }
}

async function getPetById(id) {
  try {
    const [rows] = await pool.execute('SELECT * FROM animals WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    
    const animal = rows[0];
    
    // Debug photo_urls processing
    console.log(`Processing single animal ${animal.id} (${animal.name}):`);
    console.log(`  Raw photo_urls:`, animal.photo_urls);
    console.log(`  Primary photo index:`, animal.primary_photo_index);
    console.log(`  Type:`, typeof animal.photo_urls);
    
    let imageUrl = '';
    let allPhotoUrls = [];
    
    if (animal.photo_urls) {
      try {
        if (typeof animal.photo_urls === 'string') {
          allPhotoUrls = JSON.parse(animal.photo_urls);
        } else {
          allPhotoUrls = animal.photo_urls;
        }
        
        // Use primary photo index to select the correct photo
        const primaryIndex = animal.primary_photo_index || 0;
        if (Array.isArray(allPhotoUrls) && allPhotoUrls.length > 0) {
          // Ensure index is within bounds, fallback to first photo if invalid
          const validIndex = primaryIndex >= 0 && primaryIndex < allPhotoUrls.length ? primaryIndex : 0;
          imageUrl = allPhotoUrls[validIndex] || '';
        }
      } catch (e) {
        console.log(`  JSON parse error:`, e.message);
        imageUrl = animal.photo_urls || '';
        allPhotoUrls = [];
      }
    }
    
    console.log(`  All photo URLs:`, allPhotoUrls);
    console.log(`  Final imageUrl:`, imageUrl);
    
    // Map database fields to frontend expected format
    return {
      id: animal.id,
      name: animal.name,
      species: animal.species,
      breed: animal.breed || '',
      age: animal.age_months ? `${Math.floor(animal.age_months / 12)} years ${animal.age_months % 12} months` : 'Unknown',
      gender: animal.gender || 'Unknown',
      size: animal.size || 'Unknown',
      color: animal.color || 'Unknown',
      status: animal.status || 'available',
      description: animal.description || '',
      specialNeeds: animal.special_needs || '',
      medicalInfo: animal.medical_notes || '',
      behaviorNotes: animal.behavior_notes || '',
      location: '', // Not in your schema
      imageUrl: imageUrl,
      allPhotoUrls: allPhotoUrls,
      primaryPhotoIndex: animal.primary_photo_index || 0,
      microchipId: animal.microchip_id || '',
      adoptionFee: animal.adoption_fee || 0,
      intakeDate: animal.intake_date,
      dateAdded: animal.created_at,
      lastUpdated: animal.updated_at,
      petIdCode: animal.pet_id_code || '',
      locationCode: animal.location_code || '',
      fosterCode: animal.foster_code || '',
      isMedical: animal.is_medical || false,
      intakeType: animal.intake_type || ''
    };
  } catch (error) {
    console.error('Error fetching pet by ID:', error);
    return null;
  }
}

async function addPet(petData) {
  try {
    const {
      name, species, breed, age, gender, size, status, color,
      description, specialNeeds, medicalInfo, behaviorNotes, imageUrl,
      microchipId, adoptionFee, intakeDate,
      locationCode, fosterCode, isMedical, intakeType
    } = petData;
    
    // Convert age string to months (basic conversion)
    let ageMonths = null;
    if (age && typeof age === 'string') {
      const ageMatch = age.match(/(\d+)\s*years?\s*(\d+)\s*months?/);
      if (ageMatch) {
        ageMonths = parseInt(ageMatch[1]) * 12 + parseInt(ageMatch[2]);
      } else {
        const monthMatch = age.match(/(\d+)\s*months?/);
        if (monthMatch) {
          ageMonths = parseInt(monthMatch[1]);
        }
      }
    }
    
    const photoUrls = imageUrl ? JSON.stringify([imageUrl]) : null;
    const intakeDateValue = intakeDate || new Date().toISOString().split('T')[0];
    
    // Generate pet ID code using naming convention
    const petIdCode = await generatePetIdCode({
      locationCode: locationCode || 'SA',
      intakeDate: intakeDateValue,
      species: species,
      fosterCode: fosterCode,
      isMedical: isMedical,
      intakeType: intakeType
    });
    
    const [result] = await pool.execute(`
      INSERT INTO animals (name, species, breed, age_months, gender, size, color, status, description, special_needs, medical_notes, behavior_notes, photo_urls, microchip_id, adoption_fee, intake_date, location_code, pet_id_code, foster_code, is_medical, intake_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [name, species, breed, ageMonths, gender, size, color, status, description, specialNeeds, medicalInfo, behaviorNotes, photoUrls, microchipId, adoptionFee, intakeDateValue, locationCode || 'SA', petIdCode, fosterCode || null, isMedical || false, intakeType || null]);
    
    return { id: result.insertId, ...petData, petIdCode };
  } catch (error) {
    console.error('Error adding pet to database:', error);
    throw error;
  }
}

async function updatePet(id, petData) {
  try {
    const {
      name, species, breed, age, gender, size, status, color,
      description, specialNeeds, medicalInfo, behaviorNotes, imageUrl,
      microchipId, adoptionFee, intakeDate,
      locationCode, fosterCode, isMedical, intakeType
    } = petData;
    
    // Convert age string to months (basic conversion)
    let ageMonths = null;
    if (age && typeof age === 'string') {
      const ageMatch = age.match(/(\d+)\s*years?\s*(\d+)\s*months?/);
      if (ageMatch) {
        ageMonths = parseInt(ageMatch[1]) * 12 + parseInt(ageMatch[2]);
      } else {
        const monthMatch = age.match(/(\d+)\s*months?/);
        if (monthMatch) {
          ageMonths = parseInt(monthMatch[1]);
        }
      }
    }
    
    const photoUrls = imageUrl ? JSON.stringify([imageUrl]) : null;
    
    // Regenerate pet ID code if key fields changed
    const existingPet = await getPetById(id);
    let petIdCode = existingPet?.petIdCode;
    
    if (!petIdCode || 
        existingPet?.locationCode !== (locationCode || 'SA') ||
        existingPet?.intakeDate !== intakeDate ||
        existingPet?.species !== species ||
        existingPet?.fosterCode !== fosterCode ||
        existingPet?.isMedical !== isMedical ||
        existingPet?.intakeType !== intakeType) {
      petIdCode = await generatePetIdCode({
        locationCode: locationCode || existingPet?.locationCode || 'SA',
        intakeDate: intakeDate || existingPet?.intakeDate || new Date(),
        species: species || existingPet?.species,
        fosterCode: fosterCode || existingPet?.fosterCode,
        isMedical: isMedical || existingPet?.isMedical,
        intakeType: intakeType || existingPet?.intakeType
      });
    }
    
    await pool.execute(`
      UPDATE animals 
      SET name = ?, species = ?, breed = ?, age_months = ?, gender = ?, size = ?, color = ?, status = ?,
          description = ?, special_needs = ?, medical_notes = ?, behavior_notes = ?, photo_urls = ?,
          microchip_id = ?, adoption_fee = ?, intake_date = ?,
          location_code = ?, pet_id_code = ?, foster_code = ?, is_medical = ?, intake_type = ?
      WHERE id = ?
    `, [name, species, breed, ageMonths, gender, size, color, status, description, specialNeeds, medicalInfo, behaviorNotes, photoUrls, microchipId, adoptionFee, intakeDate, locationCode || 'SA', petIdCode, fosterCode || null, isMedical || false, intakeType || null, id]);
    
    return { id, ...petData, petIdCode };
  } catch (error) {
    console.error('Error updating pet in database:', error);
    throw error;
  }
}

async function deletePet(id) {
  try {
    const pet = await getPetById(id);
    if (!pet) return null;
    
    await pool.execute('DELETE FROM animals WHERE id = ?', [id]);
    return pet;
  } catch (error) {
    console.error('Error deleting pet from database:', error);
    throw error;
  }
}

// Initialize database and directories on startup (non-blocking)
(async () => {
  try {
    await ensureDirectories();
    console.log('✅ Directories initialized');
  } catch (error) {
    console.error('⚠️ Error initializing directories:', error);
  }
  
  try {
    await initializeDatabase();
    console.log('✅ Database initialization complete');
  } catch (error) {
    console.error('⚠️ Database initialization failed, but server will continue:', error.message);
    console.log('⚠️ Server will run but database operations may fail');
  }
})();

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
  console.log('Email template received formData:', JSON.stringify(formData, null, 2));
  console.log('interestedPet in template:', formData.interestedPet);
  console.log('petInfo in template:', formData.petInfo);
  
  // Helper function to safely get pet info
  const petInfo = formData.petInfo || {};
  const hasPetInfo = petInfo && Object.keys(petInfo).length > 0;
  
  // Build pet information section
  let petInfoSection = '';
  if (hasPetInfo) {
    petInfoSection = `
        <div class="section" style="background: #fff8e1; border-left: 4px solid #ff9800;">
          <h3>🐾 Pet Information - Interested in Fostering</h3>
          ${petInfo.petIdCode ? `<div class="field" style="background: #e3f2fd; padding: 8px; border-radius: 4px; margin-bottom: 12px;"><span class="label" style="font-weight: bold; color: #1976d2;">Pet ID Code:</span> <span class="value" style="font-family: monospace; font-size: 14px; color: #1976d2;">${petInfo.petIdCode}</span></div>` : ''}
          <div class="field"><span class="label">Name:</span> <span class="value">${petInfo.name || 'N/A'}</span></div>
          <div class="field"><span class="label">Database ID:</span> <span class="value">${petInfo.id || 'N/A'}</span></div>
          <div class="field"><span class="label">Species:</span> <span class="value">${petInfo.species || 'N/A'} ${petInfo.breed ? `(${petInfo.breed})` : ''}</span></div>
          <div class="field"><span class="label">Age:</span> <span class="value">${petInfo.age || 'N/A'}</span></div>
          <div class="field"><span class="label">Gender:</span> <span class="value">${petInfo.gender || 'N/A'}</span></div>
          <div class="field"><span class="label">Size:</span> <span class="value">${petInfo.size || 'N/A'}</span></div>
          ${petInfo.color ? `<div class="field"><span class="label">Color:</span> <span class="value">${petInfo.color}</span></div>` : ''}
          ${petInfo.status ? `<div class="field"><span class="label">Status:</span> <span class="value">${petInfo.status}</span></div>` : ''}
          ${petInfo.adoptionFee ? `<div class="field"><span class="label">Adoption Fee:</span> <span class="value">$${petInfo.adoptionFee}</span></div>` : ''}
          ${petInfo.microchipId ? `<div class="field"><span class="label">Microchip ID:</span> <span class="value">${petInfo.microchipId}</span></div>` : ''}
          ${petInfo.description ? `<div class="field" style="margin-top: 12px;"><span class="label">Description:</span><div class="value" style="margin-top: 4px; font-style: italic;">${petInfo.description}</div></div>` : ''}
          ${petInfo.specialNeeds ? `<div class="field" style="margin-top: 12px;"><span class="label">Special Needs:</span><div class="value" style="margin-top: 4px; color: #d32f2f;">${petInfo.specialNeeds}</div></div>` : ''}
          ${petInfo.medicalInfo ? `<div class="field" style="margin-top: 12px;"><span class="label">Medical Information:</span><div class="value" style="margin-top: 4px;">${petInfo.medicalInfo}</div></div>` : ''}
          ${petInfo.behaviorNotes ? `<div class="field" style="margin-top: 12px;"><span class="label">Behavior Notes:</span><div class="value" style="margin-top: 4px;">${petInfo.behaviorNotes}</div></div>` : ''}
          ${petInfo.imageUrl ? `<div class="field" style="margin-top: 12px;"><span class="label">Photo URL:</span><div class="value" style="margin-top: 4px; word-break: break-all;">${petInfo.imageUrl}</div></div>` : ''}
        </div>
    `;
  } else if (formData.interestedPet) {
    // Fallback to old format if petInfo is not available
    petInfoSection = `
        <div class="section">
          <h3>🐾 Interested in Fostering</h3>
          <div class="field"><span class="label">Pet:</span> <span class="value">${formData.interestedPet}</span></div>
        </div>
    `;
  }
  
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
        
        ${petInfoSection}
        
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

const createAdoptEmailTemplate = (formData) => {
  console.log('Adoption email template received formData:', JSON.stringify(formData, null, 2));
  console.log('interestedPet in template:', formData.interestedPet);
  console.log('petInfo in template:', formData.petInfo);
  
  // Helper function to safely get pet info
  const petInfo = formData.petInfo || {};
  const hasPetInfo = petInfo && Object.keys(petInfo).length > 0;
  
  // Build pet information section
  let petInfoSection = '';
  if (hasPetInfo) {
    petInfoSection = `
        <div class="section" style="background: #e8f5e9; border-left: 4px solid #4caf50;">
          <h3>🐾 Pet Information - Interested in Adopting</h3>
          ${petInfo.petIdCode ? `<div class="field" style="background: #e3f2fd; padding: 8px; border-radius: 4px; margin-bottom: 12px;"><span class="label" style="font-weight: bold; color: #1976d2;">Pet ID Code:</span> <span class="value" style="font-family: monospace; font-size: 14px; color: #1976d2;">${petInfo.petIdCode}</span></div>` : ''}
          <div class="field"><span class="label">Name:</span> <span class="value">${petInfo.name || 'N/A'}</span></div>
          <div class="field"><span class="label">Database ID:</span> <span class="value">${petInfo.id || 'N/A'}</span></div>
          <div class="field"><span class="label">Species:</span> <span class="value">${petInfo.species || 'N/A'} ${petInfo.breed ? `(${petInfo.breed})` : ''}</span></div>
          <div class="field"><span class="label">Age:</span> <span class="value">${petInfo.age || 'N/A'}</span></div>
          <div class="field"><span class="label">Gender:</span> <span class="value">${petInfo.gender || 'N/A'}</span></div>
          <div class="field"><span class="label">Size:</span> <span class="value">${petInfo.size || 'N/A'}</span></div>
          ${petInfo.color ? `<div class="field"><span class="label">Color:</span> <span class="value">${petInfo.color}</span></div>` : ''}
          ${petInfo.status ? `<div class="field"><span class="label">Status:</span> <span class="value">${petInfo.status}</span></div>` : ''}
          ${petInfo.adoptionFee ? `<div class="field"><span class="label">Adoption Fee:</span> <span class="value">$${petInfo.adoptionFee}</span></div>` : ''}
          ${petInfo.microchipId ? `<div class="field"><span class="label">Microchip ID:</span> <span class="value">${petInfo.microchipId}</span></div>` : ''}
          ${petInfo.description ? `<div class="field" style="margin-top: 12px;"><span class="label">Description:</span><div class="value" style="margin-top: 4px; font-style: italic;">${petInfo.description}</div></div>` : ''}
          ${petInfo.specialNeeds ? `<div class="field" style="margin-top: 12px;"><span class="label">Special Needs:</span><div class="value" style="margin-top: 4px; color: #d32f2f;">${petInfo.specialNeeds}</div></div>` : ''}
          ${petInfo.medicalInfo ? `<div class="field" style="margin-top: 12px;"><span class="label">Medical Information:</span><div class="value" style="margin-top: 4px;">${petInfo.medicalInfo}</div></div>` : ''}
          ${petInfo.behaviorNotes ? `<div class="field" style="margin-top: 12px;"><span class="label">Behavior Notes:</span><div class="value" style="margin-top: 4px;">${petInfo.behaviorNotes}</div></div>` : ''}
          ${petInfo.imageUrl ? `<div class="field" style="margin-top: 12px;"><span class="label">Photo URL:</span><div class="value" style="margin-top: 4px; word-break: break-all;">${petInfo.imageUrl}</div></div>` : ''}
        </div>
    `;
  } else if (formData.interestedPet) {
    // Fallback to old format if petInfo is not available
    petInfoSection = `
        <div class="section">
          <h3>🐾 Interested in Adopting</h3>
          <div class="field"><span class="label">Pet:</span> <span class="value">${formData.interestedPet}</span></div>
        </div>
    `;
  }
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #4caf50, #66bb6a); color: white; padding: 20px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 10px 10px; }
        .section { background: white; margin: 15px 0; padding: 15px; border-radius: 8px; border-left: 4px solid #4caf50; }
        .section h3 { color: #4caf50; margin-top: 0; font-size: 16px; text-transform: uppercase; letter-spacing: 1px; }
        .field { margin: 8px 0; }
        .label { font-weight: bold; color: #555; }
        .value { color: #333; }
        .footer { text-align: center; margin-top: 20px; padding: 15px; background: #e8e8e8; border-radius: 8px; font-size: 14px; color: #666; }
        .paw { font-size: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>💚 New Adoption Application</h1>
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
        
        ${petInfoSection}
        
        <div class="section">
          <h3>🏡 Home Information</h3>
          <div class="field"><span class="label">Home Ownership:</span> <span class="value">${formData.homeOwnership}</span></div>
          <div class="field"><span class="label">Has Other Pets:</span> <span class="value">${formData.hasOtherPets}</span></div>
          <div class="field"><span class="label">Has Children:</span> <span class="value">${formData.hasChildren}</span></div>
          <div class="field"><span class="label">Experience with Pets:</span> <span class="value">${formData.experience}</span></div>
        </div>
        
        <div class="section">
          <h3>📝 About Their Home & Why They Want to Adopt</h3>
          <div class="value">${formData.about}</div>
        </div>
        
        <div class="section">
          <h3>✅ Agreements</h3>
          <div class="field"><span class="label">Adult/Consent:</span> <span class="value">${formData.adultConsent}</span></div>
        </div>
      </div>
      
      <div class="footer">
        <p><span class="paw">🐾</span> You have received a new adoption application! <span class="paw">🐾</span></p>
        <p>This email was automatically generated from our website adoption application form.</p>
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

// Middleware - CORS Configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'https://ccfrescue.org',
  'https://www.ccfrescue.org'
];

// Add Render domain if specified
if (process.env.FRONTEND_URL) {
  allowedOrigins.push(process.env.FRONTEND_URL);
}

// Allow all origins in development, specific origins in production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    // In production, check against allowed origins
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.some(allowed => origin.includes(allowed))) {
      callback(null, true);
    } else {
      // Log the origin for debugging
      console.log('CORS blocked origin:', origin);
      callback(null, true); // Temporarily allow all for debugging - change to callback(new Error('Not allowed by CORS')) later
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
};

app.use(cors(corsOptions));

// Additional CORS headers for preflight requests
app.options('*', cors(corsOptions));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/', (req, res) => {
  console.log('GET / - Health check requested');
  res.json({ 
    message: 'Chester & Chubbs Foundation API is running!',
    timestamp: new Date().toISOString(),
    routes: {
      health: '/',
      pets: '/api/pets',
      petById: '/api/pets/:id'
    }
  });
});

// Test route to verify route registration
app.get('/api/test', (req, res) => {
  console.log('GET /api/test - Test route hit');
  res.json({ 
    success: true, 
    message: 'Test route is working!',
    timestamp: new Date().toISOString()
  });
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
    console.log('Foster form data received:', JSON.stringify(formData, null, 2));
    
    // Validate required fields - animalType is only required if petInfo is not provided
    const requiredFields = ['name', 'email', 'phone', 'address', 'homeOwnership', 'hasOtherPets', 'availability', 'about'];
    if (!formData.petInfo) {
      requiredFields.push('animalType');
    }
    const missingFields = requiredFields.filter(field => !formData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missingFields 
      });
    }
    
    // Prepare email data - include all formData including petInfo
    const emailData = {
      ...formData,
      adultConsent: formData.isAdultOrConsent ? 'Yes' : 'No',
      interestedPet: formData.interestedPet || '' // Ensure interestedPet is included for backward compatibility
      // petInfo is already included in formData via spread operator
    };
    
    // Send email - use petInfo.name if available, otherwise fall back to interestedPet
    let subject = 'New Foster Application - Chester & Chubbs Foundation';
    if (formData.petInfo && formData.petInfo.name) {
      subject = `New Foster Application for ${formData.petInfo.name} - Chester & Chubbs Foundation`;
    } else if (formData.interestedPet) {
      subject = `New Foster Application for ${formData.interestedPet} - Chester & Chubbs Foundation`;
    }
    
    console.log('Email data being sent to template:', JSON.stringify(emailData, null, 2));
    console.log('interestedPet value:', emailData.interestedPet);
    console.log('petInfo value:', emailData.petInfo);
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: subject,
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

// Adoption form submission endpoint
app.post('/api/submit-adopt', async (req, res) => {
  try {
    const formData = req.body;
    console.log('Adoption form data received:', JSON.stringify(formData, null, 2));
    
    // Validate required fields
    const requiredFields = ['name', 'email', 'phone', 'address', 'homeOwnership', 'hasOtherPets', 'hasChildren', 'experience', 'about'];
    const missingFields = requiredFields.filter(field => !formData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missingFields 
      });
    }
    
    // Prepare email data - include all formData including petInfo
    const emailData = {
      ...formData,
      adultConsent: formData.isAdultOrConsent ? 'Yes' : 'No',
      interestedPet: formData.interestedPet || ''
    };
    
    // Send email - use petInfo.name if available, otherwise fall back to interestedPet
    let subject = 'New Adoption Application - Chester & Chubbs Foundation';
    if (formData.petInfo && formData.petInfo.name) {
      subject = `New Adoption Application for ${formData.petInfo.name} - Chester & Chubbs Foundation`;
    } else if (formData.interestedPet) {
      subject = `New Adoption Application for ${formData.interestedPet} - Chester & Chubbs Foundation`;
    }
    
    console.log('Email data being sent to template:', JSON.stringify(emailData, null, 2));
    console.log('petInfo value:', emailData.petInfo);
    
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER,
      subject: subject,
      html: createAdoptEmailTemplate(emailData)
    };
    
    await transporter.sendMail(mailOptions);
    
    res.json({ 
      success: true, 
      message: 'Adoption application submitted successfully!' 
    });
    
  } catch (error) {
    console.error('Error submitting adoption form:', error);
    res.status(500).json({ 
      error: 'Error submitting adoption form',
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

// Pet Management API Endpoints

// Preview pet ID code (for admin forms)
app.get('/api/pets/preview-id', async (req, res) => {
  try {
    const { locationCode, intakeDate, species, fosterCode, isMedical, intakeType } = req.query;
    
    if (!species) {
      return res.status(400).json({ 
        error: 'Species is required to generate pet ID code' 
      });
    }
    
    const previewCode = await generatePetIdCode({
      locationCode: locationCode || 'SA',
      intakeDate: intakeDate || new Date(),
      species: species,
      fosterCode: fosterCode || null,
      isMedical: isMedical === 'true' || isMedical === '1',
      intakeType: intakeType || null
    });
    
    res.json({ 
      success: true, 
      petIdCode: previewCode 
    });
  } catch (error) {
    console.error('Error generating preview ID:', error);
    res.status(500).json({ 
      error: 'Error generating preview ID',
      message: error.message 
    });
  }
});

// Get all pets - MUST be before /api/pets/:id route
app.get('/api/pets', async (req, res) => {
  console.log('GET /api/pets - Request received');
  console.log('Route handler executing...');
  try {
    // Check if database is connected
    if (!pool) {
      console.error('Database not initialized - returning empty array');
      return res.status(200).json({ 
        success: true,
        error: 'Database not available',
        message: 'Database connection has not been established. Please check server logs.',
        pets: [] // Return empty array so frontend doesn't break
      });
    }
    
    console.log('Fetching pets from database...');
    const pets = await getPets();
    console.log(`Found ${pets.length} pets`);
    res.json({ success: true, pets });
  } catch (error) {
    console.error('Error fetching pets:', error);
    // Return empty array on error so frontend doesn't break
    res.status(200).json({ 
      success: true,
      error: 'Error fetching pets',
      message: error.message,
      pets: [] // Return empty array so frontend doesn't break
    });
  }
});

// Get a specific pet by ID
app.get('/api/pets/:id', async (req, res) => {
  try {
    const pet = await getPetById(req.params.id);
    
    if (!pet) {
      return res.status(404).json({ 
        error: 'Pet not found' 
      });
    }
    
    res.json({ success: true, pet });
  } catch (error) {
    console.error('Error fetching pet:', error);
    res.status(500).json({ 
      error: 'Error fetching pet',
      message: error.message 
    });
  }
});

// Add a new pet
app.post('/api/pets', upload.single('image'), handleMulterError, async (req, res) => {
  try {
    const { 
      name, species, breed, age, gender, size, status, description, 
      specialNeeds, medicalInfo, location, intakeDate,
      locationCode, fosterCode, isMedical, intakeType
    } = req.body;
    
    // Validate required fields
    const requiredFields = ['name', 'species', 'age', 'gender', 'size', 'status', 'description'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        missingFields 
      });
    }
    
    const petData = {
      name,
      species,
      breed: breed || '',
      age,
      gender,
      size,
      status, // 'available', 'foster-needed', 'adopted', 'pending'
      description,
      specialNeeds: specialNeeds || '',
      medicalInfo: medicalInfo || '',
      location: location || '',
      imageUrl: req.file ? `/uploads/pets/${req.file.filename}` : '',
      intakeDate: intakeDate || new Date().toISOString().split('T')[0],
      locationCode: locationCode || 'SA',
      fosterCode: fosterCode || null,
      isMedical: isMedical === true || isMedical === 'true' || isMedical === '1',
      intakeType: intakeType || null
    };
    
    const newPet = await addPet(petData);
    
    res.json({ 
      success: true, 
      message: 'Pet added successfully!',
      pet: newPet
    });
    
  } catch (error) {
    console.error('Error adding pet:', error);
    res.status(500).json({ 
      error: 'Error adding pet',
      message: error.message 
    });
  }
});

// Update a pet
app.put('/api/pets/:id', upload.single('image'), handleMulterError, async (req, res) => {
  try {
    const existingPet = await getPetById(req.params.id);
    
    if (!existingPet) {
      return res.status(404).json({ 
        error: 'Pet not found' 
      });
    }
    
    const { 
      name, species, breed, age, gender, size, status, description, 
      specialNeeds, medicalInfo, location, intakeDate,
      locationCode, fosterCode, isMedical, intakeType
    } = req.body;
    
    const petData = {
      name: name || existingPet.name,
      species: species || existingPet.species,
      breed: breed || existingPet.breed,
      age: age || existingPet.age,
      gender: gender || existingPet.gender,
      size: size || existingPet.size,
      status: status || existingPet.status,
      description: description || existingPet.description,
      specialNeeds: specialNeeds || existingPet.specialNeeds,
      medicalInfo: medicalInfo || existingPet.medicalInfo,
      location: location || existingPet.location,
      imageUrl: req.file ? `/uploads/pets/${req.file.filename}` : existingPet.imageUrl,
      intakeDate: intakeDate || existingPet.intakeDate,
      locationCode: locationCode !== undefined ? locationCode : existingPet.locationCode || 'SA',
      fosterCode: fosterCode !== undefined ? fosterCode : existingPet.fosterCode,
      isMedical: isMedical !== undefined ? (isMedical === true || isMedical === 'true' || isMedical === '1') : existingPet.isMedical,
      intakeType: intakeType !== undefined ? intakeType : existingPet.intakeType
    };
    
    const updatedPet = await updatePet(req.params.id, petData);
    
    res.json({ 
      success: true, 
      message: 'Pet updated successfully!',
      pet: updatedPet
    });
    
  } catch (error) {
    console.error('Error updating pet:', error);
    res.status(500).json({ 
      error: 'Error updating pet',
      message: error.message 
    });
  }
});

// Delete a pet
app.delete('/api/pets/:id', async (req, res) => {
  try {
    const deletedPet = await deletePet(req.params.id);
    
    if (!deletedPet) {
      return res.status(404).json({ 
        error: 'Pet not found' 
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Pet deleted successfully!',
      pet: deletedPet
    });
    
  } catch (error) {
    console.error('Error deleting pet:', error);
    res.status(500).json({ 
      error: 'Error deleting pet',
      message: error.message 
    });
  }
});

// 404 handler - must be after all routes
app.use('*', (req, res) => {
  console.log(`404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl,
    message: `Cannot ${req.method} ${req.originalUrl}`
  });
});

// Debug: Log all registered routes
console.log('\n📋 Registered Routes:');
const routes = [];
app._router.stack.forEach(function(middleware){
  if(middleware.route){
    routes.push(Object.keys(middleware.route.methods) + ' ' + middleware.route.path);
  } else if(middleware.name === 'router'){
    routes.push('Router: ' + (middleware.regexp.source || 'unknown'));
  }
});
console.log('Routes:', routes);

// Start server
const PORT = process.env.PORT || 3001;

// Add error handling for server startup
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Server URL: http://0.0.0.0:${PORT}`);
  console.log(`✅ Health check: http://0.0.0.0:${PORT}/`);
  console.log(`✅ Pets API: http://0.0.0.0:${PORT}/api/pets`);
  console.log(`✅ Test route: http://0.0.0.0:${PORT}/api/test`);
}).on('error', (error) => {
  console.error('❌ Server failed to start:', error);
  process.exit(1);
});

