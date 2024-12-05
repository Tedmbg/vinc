const express = require('express');
const dotenv = require('dotenv');
const router = express.Router();
const { Pool } = require('pg');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors')
const bcrypt = require('bcryptjs');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);




// Load environment variables
dotenv.config();

// Initialize Express
const app = express();



// Configure multer storage (use memory storage to get buffer data)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);



// PostgreSQL connection pool
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false, // Adjust based on security requirements
  },
});

app.use(cors({
  origin:  'http://localhost:5173', // Frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true, // If you need to include cookies
}));



// Middleware to parse JSON
app.use(express.json());

// Middleware for session handling
app.use(
  session({
    store: new PgSession({
      pool: pool, // PostgreSQL connection pool
      tableName: 'session', // Default table for session storage
    }),
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }, // 1 day
  })
);

// Mount routes after session middleware
app.use('/api', router);


// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error acquiring client', err.stack);
  }
  console.log('Connected to the database');
  release();
});



// Sample route
app.get('/', (req, res) => {
  res.send('API is working!');
});



// Example using Express.js
app.get('/api/streets', async (req, res) => {
  try {
    const streets = await pool.query('SELECT * FROM spatial_ref_sys');
    res.json(streets.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});



// Backend endpoint to update business coordinates
app.put("/api/businesses/:business_id/coordinates", async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude } = req.body;

  try {
    const result = await db.query(
      "UPDATE businesses SET latitude = $1, longitude = $2 WHERE id = $3 RETURNING *",
      [latitude, longitude, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating business coordinates:", err);
    res.status(500).send("Server error");
  }
});

// Fetch businesses with coordinates
app.get("/api/businesses", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT business_id, business_name, latitude, longitude FROM businesses WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching businesses:", err);
    res.status(500).send("Server error");
  }
});

// Endpoint to upload business images (logo and cover image)
app.post(
  '/api/businesses/:business_id/upload-images',
  upload.fields([{ name: 'logo' }, { name: 'cover_image' }]),
  async (req, res) => {
    const { business_id } = req.params;
    const files = req.files;

    try {
      let logo_url = null;
      let cover_image_url = null;

      // Handle logo upload
      if (files.logo && files.logo[0]) {
        const { buffer, originalname, mimetype } = files.logo[0];
        const filePath = `logos/${business_id}/${Date.now()}_${originalname}`;

        // Upload to Supabase storage
        const { data, error } = await supabase.storage
          .from('business-assets')
          .upload(filePath, buffer, {
            cacheControl: '3600',
            upsert: false,
            contentType: mimetype,
          });

        if (error) throw error;

        // Get public URL
        const { data: urlData, error: publicURLError } = supabase.storage
          .from('business-assets')
          .getPublicUrl(filePath);

        if (publicURLError) throw publicURLError;

        logo_url = urlData.publicUrl;
      }

      // Handle cover image upload
      if (files.cover_image && files.cover_image[0]) {
        const { buffer, originalname, mimetype } = files.cover_image[0];
        const filePath = `cover_images/${business_id}/${Date.now()}_${originalname}`;

        // Upload to Supabase storage
        const { data, error } = await supabase.storage
          .from('business-assets')
          .upload(filePath, buffer, {
            cacheControl: '3600',
            upsert: false,
            contentType: mimetype,
          });

        if (error) throw error;

        // Get public URL
        const { data: urlData, error: publicURLError } = supabase.storage
          .from('business-assets')
          .getPublicUrl(filePath);

        if (publicURLError) throw publicURLError;

        cover_image_url = urlData.publicUrl;
      }

      // Update the database
      const queryText = `
        UPDATE businesses
        SET
          logo_url = COALESCE($1, logo_url),
          cover_image_url = COALESCE($2, cover_image_url)
        WHERE business_id = $3
        RETURNING *;
      `;

      const values = [logo_url, cover_image_url, business_id];

      const result = await pool.query(queryText, values);

      res.json({
        message: 'Images uploaded successfully',
        business: result.rows[0],
      });
    } catch (error) {
      console.error('Error uploading images:', error);
      res.status(500).json({ error: 'Error uploading images' });
    }
  }
);

// Endpoint to upload product image
app.post(
  '/api/products/:product_id/upload-image',
  upload.single('product_image'),
  async (req, res) => {
    const { product_id } = req.params;
    const file = req.file;

    try {
      let product_image_url = null;

      if (file) {
        const { buffer, originalname, mimetype } = file;
        const filePath = `product_images/${product_id}/${Date.now()}_${originalname}`;

        // Upload to Supabase storage
        const { data, error } = await supabase.storage
          .from('product-assets')
          .upload(filePath, buffer, {
            cacheControl: '3600',
            upsert: false,
            contentType: mimetype,
          });

        if (error) throw error;

        // Get public URL
        const { data: urlData, error: publicURLError } = supabase.storage
          .from('product-assets')
          .getPublicUrl(filePath);

        if (publicURLError) throw publicURLError;

        product_image_url = urlData.publicUrl;
      }

      // Update the database
      const queryText = `
        UPDATE products
        SET
          product_image_url = COALESCE($1, product_image_url)
        WHERE product_id = $2
        RETURNING *;
      `;

      const values = [product_image_url, product_id];

      const result = await pool.query(queryText, values);

      res.json({
        message: 'Product image uploaded successfully',
        product: result.rows[0],
      });
    } catch (error) {
      console.error('Error uploading product image:', error);
      res.status(500).json({ error: 'Error uploading product image' });
    }
  }
);




// Add a new user
router.post('/users', async (req, res) => {

  console.log('POST /api/users hit');
  console.log('Request body:', req.body);
  const { first_name, last_name, email, password, phone_number, role = 'customer' } = req.body; // Default role to 'customer'

  // Validate required fields
  if (!first_name || !last_name || !email || !password) {
    return res.status(400).json({ message: 'All required fields must be provided' });
  }

  try {
    // Hash the password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);

    // Insert user into the database
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, phone_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING user_id, first_name, last_name, email, role, phone_number, created_at`,
      [first_name, last_name, email, password_hash, role, phone_number]
    );

    res.status(201).json({
      message: 'User created successfully',
      user: result.rows[0],
    });
  } catch (error) {
    console.error(error);

    // Handle unique constraint violation for email
    if (error.code === '23505') {
      return res.status(400).json({ message: 'Email already exists' });
    }

    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Get User Profile
router.get('/users/me', async (req, res) => {
  // Check if userId exists in the session
  const userId = req.session.userId;
  if (!userId) {
    return res.status(401).json({ message: 'Unauthorized: Please log in' });
  }

  try {
    const result = await pool.query(
      `SELECT user_id, first_name, last_name, email, role, phone_number, created_at, updated_at 
       FROM users 
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

  

// user login 
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Compare the hashed password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Store userId in the session
    req.session.userId = user.user_id;

    res.json({ message: 'Login successful', user: { user_id: user.user_id, email: user.email } });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Logout endpoint
router.post('/logout', (req, res) => {
  // Destroy the session
  req.session.destroy((err) => {
    if (err) {
      console.error('Error during logout:', err);
      return res.status(500).json({ message: 'Logout failed' });
    }

    // Clear the session cookie
    res.clearCookie('connect.sid');
    res.json({ message: 'Logout successful' });
  });
});

// first part business profile 
// Business transition
router.post('/businesses/transition', async (req, res) => {
  const {
    first_name,
    last_name,
    email,
    password,
    confirm_password,
    business_name,
    business_phone_number,
    address,
    city,
    postal_code,
    app_suite
  } = req.body;

  // Validate mandatory fields for both cases
  if (!business_name || !business_phone_number || !address || !city || !postal_code || !confirm_password) {
    return res.status(400).json({ message: 'Business name, phone number, address, city, postal code, and confirm password are required' });
  }

  try {
    let userId;

    if (req.session.userId) {
      // For existing users
      userId = req.session.userId;

      // Retrieve the logged-in user's details
      const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [userId]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      const user = userResult.rows[0];

      // Validate password confirmation
      const isValidPassword = await bcrypt.compare(confirm_password, user.password_hash);
      if (!isValidPassword) {
        return res.status(401).json({ message: 'Invalid password confirmation' });
      }

      // Update the user's role to 'business_owner' if not already set
      if (user.role !== 'business_owner') {
        await pool.query('UPDATE users SET role = $1 WHERE user_id = $2', ['business_owner', user.user_id]);
      }
    } else {
      // For new users
      if (!first_name || !last_name || !email || !password) {
        return res.status(400).json({ message: 'First name, last name, email, and password are required for new user signup' });
      }

      if (password !== confirm_password) {
        return res.status(400).json({ message: 'Passwords do not match' });
      }

      // Check if email already exists
      const emailCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      // Hash the password
      const saltRounds = 10;
      const password_hash = await bcrypt.hash(password, saltRounds);

      // Create new user as 'business_owner'
      const userResult = await pool.query(
        `INSERT INTO users (first_name, last_name, email, password_hash, role, phone_number) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING user_id`,
        [first_name, last_name, email, password_hash, 'business_owner', business_phone_number]
      );
      userId = userResult.rows[0].user_id;
    }

    // Insert business profile
    const businessResult = await pool.query(
      `INSERT INTO businesses (
         owner_id, 
         business_name, 
         phone_number, 
         address, 
         city, 
         postal_code, 
         app_suite
       ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING business_id, business_name, phone_number, address, city, postal_code, app_suite`,
      [userId, business_name, business_phone_number, address, city, postal_code, app_suite || null]
    );

    res.status(201).json({
      message: 'Business profile created successfully',
      business: businessResult.rows[0],
    });
  } catch (error) {
    console.error('Error during business transition:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Fetch business info
router.get('/businesses/info', async (req, res) => {
  try {
    // Check if the user is logged in
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Unauthorized: Please log in' });
    }

    // Retrieve the logged-in user's details
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if the user is a business_owner
    if (user.role !== 'business_owner') {
      return res.status(403).json({ message: 'Access denied: User is not a business owner' });
    }

    // Retrieve the business associated with the user
    const businessResult = await pool.query(
      `SELECT b.business_id, b.business_name, b.address, b.phone_number 
       FROM businesses b
       WHERE b.owner_id = $1`,
      [user.user_id]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).json({ message: 'Business not found' });
    }

    const business = businessResult.rows[0];

    // Retrieve the categories associated with the business
    const categoriesResult = await pool.query(
      `SELECT c.category_id, c.name
       FROM business_categories bc
       INNER JOIN categories c ON bc.category_id = c.category_id
       WHERE bc.business_id = $1`,
      [business.business_id]
    );

    res.json({
      business_id: business.business_id,
      business_name: business.business_name,
      address: business.address,
      phone_number: business.phone_number,
      categories: categoriesResult.rows.length ? categoriesResult.rows : [], // Return empty array if no categories
    });
  } catch (error) {
    console.error('Error fetching business info:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Fetch all categories
router.get('/categories', async (req, res) => {
  try {
    const categoriesResult = await pool.query('SELECT category_id, name FROM categories ORDER BY name ASC');
    res.json(categoriesResult.rows);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


router.put('/businesses/info/edit', async (req, res) => {
  const { business_name, address, phone_number, categories } = req.body;

  try {
    // Check if the user is logged in
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Unauthorized: Please log in' });
    }

    // Retrieve the logged-in user's details
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if the user is a business_owner
    if (user.role !== 'business_owner') {
      return res.status(403).json({ message: 'Access denied: User is not a business owner' });
    }

    // Retrieve the business associated with the user
    const businessResult = await pool.query(
      `SELECT business_id 
       FROM businesses 
       WHERE owner_id = $1`,
      [user.user_id]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).json({ message: 'Business not found' });
    }

    const businessId = businessResult.rows[0].business_id;

    // Update fields dynamically
    const updateFields = [];
    const updateValues = [];
    if (business_name) {
      updateFields.push('business_name = $' + (updateFields.length + 1));
      updateValues.push(business_name);
    }
    if (address) {
      updateFields.push('address = $' + (updateFields.length + 1));
      updateValues.push(address);
    }
    if (phone_number) {
      updateFields.push('phone_number = $' + (updateFields.length + 1));
      updateValues.push(phone_number);
    }

    if (updateFields.length > 0) {
      updateValues.push(businessId); // Add business_id to the end for the WHERE clause
      await pool.query(
        `UPDATE businesses 
         SET ${updateFields.join(', ')}, updated_at = NOW() 
         WHERE business_id = $${updateValues.length}`,
        updateValues
      );
    }

    // Update categories if provided
    if (categories) {
      // Resolve category names to IDs
      const categoryResult = await pool.query(
        `SELECT category_id FROM categories WHERE name = ANY($1)`,
        [categories]
      );

      const categoryIds = categoryResult.rows.map((row) => row.category_id);

      // Clear existing categories and insert new ones
      await pool.query('DELETE FROM business_categories WHERE business_id = $1', [businessId]);
      if (categoryIds.length > 0) {
        const categoryInserts = categoryIds.map((categoryId) => `(${businessId}, ${categoryId})`).join(',');
        await pool.query(`INSERT INTO business_categories (business_id, category_id) VALUES ${categoryInserts}`);
      }
    }

    res.json({ message: 'Business info updated successfully' });
  } catch (error) {
    console.error('Error updating business info:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Fetch business working hours
router.get('/businesses/hours', async (req, res) => {
  try {
    // Check if the user is logged in
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Unauthorized: Please log in' });
    }

    // Retrieve the logged-in user's details
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if the user is a business_owner
    if (user.role !== 'business_owner') {
      return res.status(403).json({ message: 'Access denied: User is not a business owner' });
    }

    // Retrieve the business associated with the user
    const businessResult = await pool.query(
      `SELECT business_id 
       FROM businesses 
       WHERE owner_id = $1`,
      [user.user_id]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).json({ message: 'Business not found' });
    }

    const businessId = businessResult.rows[0].business_id;

    // Retrieve working hours for the business
    const result = await pool.query(
      `SELECT day_of_week, opening_time, closing_time, is_closed 
       FROM working_hours 
       WHERE business_id = $1
       ORDER BY 
         CASE 
           WHEN day_of_week = 'Monday' THEN 1
           WHEN day_of_week = 'Tuesday' THEN 2
           WHEN day_of_week = 'Wednesday' THEN 3
           WHEN day_of_week = 'Thursday' THEN 4
           WHEN day_of_week = 'Friday' THEN 5
           WHEN day_of_week = 'Saturday' THEN 6
           WHEN day_of_week = 'Sunday' THEN 7
         END`,
      [businessId]
    );

    // If no working hours are set, return an empty array
    res.json(result.rows.length > 0 ? result.rows : []);
  } catch (error) {
    console.error('Error fetching business working hours:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});


// Update business working hours
// Update business working hours with simplified structure
router.put('/businesses/hours/edit', async (req, res) => {
  const { hours } = req.body; // Array of { days, opening_time, closing_time, is_closed }

  if (!hours || !Array.isArray(hours)) {
    return res.status(400).json({ message: 'Invalid working hours data' });
  }

  try {
    // Check if the user is logged in
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Unauthorized: Please log in' });
    }

    // Retrieve the logged-in user's details
    const userResult = await pool.query('SELECT * FROM users WHERE user_id = $1', [req.session.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];

    // Check if the user is a business_owner
    if (user.role !== 'business_owner') {
      return res.status(403).json({ message: 'Access denied: User is not a business owner' });
    }

    // Retrieve the business associated with the user
    const businessResult = await pool.query(
      `SELECT business_id 
       FROM businesses 
       WHERE owner_id = $1`,
      [user.user_id]
    );

    if (businessResult.rows.length === 0) {
      return res.status(404).json({ message: 'Business not found' });
    }

    const businessId = businessResult.rows[0].business_id;

    // Delete existing working hours for the business
    await pool.query('DELETE FROM working_hours WHERE business_id = $1', [businessId]);

    // Insert new working hours
    const inserts = [];
    for (const entry of hours) {
      const { days, opening_time, closing_time, is_closed } = entry;
      for (const day of days) {
        inserts.push(
          `(${businessId}, '${day}', ${opening_time ? `'${opening_time}'` : 'NULL'}, ${closing_time ? `'${closing_time}'` : 'NULL'}, ${is_closed})`
        );
      }
    }

    if (inserts.length > 0) {
      await pool.query(
        `INSERT INTO working_hours (business_id, day_of_week, opening_time, closing_time, is_closed) VALUES ${inserts.join(', ')}`
      );
    }

    res.json({ message: 'Working hours updated successfully' });
  } catch (error) {
    console.error('Error updating business working hours:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});



// Define the server port
const PORT = process.env.PORT || 3000;


app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
