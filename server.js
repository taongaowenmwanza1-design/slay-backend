const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:3000', 'https://glittery-concha-5a71f9.netlify.app'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-admin-key']
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests, slow down.' }
});
app.use('/api', limiter);

app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, 'uploads'));
    },
    filename: function (req, file, cb) {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
        cb(null, uniqueName);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: function (req, file, cb) {
        const allowed = /jpeg|jpg|png|webp|gif/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        if (ext && mime) cb(null, true);
        else cb(new Error('Only images allowed'));
    }
});

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'aaznawmm',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()').then(() => console.log('Database connected')).catch(err => console.error('DB error:', err.message));

const ADMIN_KEY = 'slay2026admin';

function adminAuth(req, res, next) {
    if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Access denied' });
    next();
}

app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE in_stock = true ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/orders', async (req, res) => {
    try {
        const { customer_name, customer_phone, customer_email, items, total_amount, payment_method } = req.body;
        const result = await pool.query(
            `INSERT INTO orders (customer_name, customer_phone, customer_email, items, total_amount, payment_method)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [customer_name, customer_phone, customer_email, JSON.stringify(items), total_amount, payment_method]
        );
        res.status(201).json({ message: 'Order placed', order_id: result.rows[0].id });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/layby', async (req, res) => {
    try {
        const { customer_name, customer_phone, customer_email, product_id, product_name, total_price, deposit_percent, duration_months } = req.body;
        const deposit_amount = (total_price * deposit_percent) / 100;
        const remaining_amount = total_price - deposit_amount;
        const result = await pool.query(
            `INSERT INTO layby (customer_name, customer_phone, customer_email, product_id, product_name, total_price, deposit_percent, deposit_amount, remaining_amount, duration_months)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [customer_name, customer_phone, customer_email, product_id, product_name, total_price, deposit_percent, deposit_amount, remaining_amount, duration_months]
        );
        res.status(201).json({ message: 'Layby request submitted', layby_id: result.rows[0].id, deposit_amount, remaining_amount });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/admin/upload', adminAuth, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image' });
    res.json({ image_url: `https://slay-essentials-api.onrender.com/uploads/${req.file.filename}` });
});

app.post('/api/admin/upload-gallery', adminAuth, upload.array('images', 10), (req, res) => {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No images' });
    const urls = req.files.map(f => `https://slay-essentials-api.onrender.com/uploads/${f.filename}`);
    res.json({ image_urls: urls });
});

app.post('/api/admin/products', adminAuth, async (req, res) => {
    try {
        const { name, category, price, description, image_url, gallery_images } = req.body;
        const result = await pool.query(
            `INSERT INTO products (name, category, price, description, image_url, gallery_images) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
            [name, category, price, description, image_url, JSON.stringify(gallery_images || [])]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/products/:id', adminAuth, async (req, res) => {
    try {
        const { name, category, price, description, image_url, gallery_images, in_stock } = req.body;
        const result = await pool.query(
            `UPDATE products SET name=$1, category=$2, price=$3, description=$4, image_url=$5, gallery_images=$6, in_stock=$7 WHERE id=$8 RETURNING *`,
            [name, category, price, description, image_url, JSON.stringify(gallery_images || []), in_stock, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/admin/products/:id', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM products WHERE id=$1 RETURNING *', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ message: 'Deleted' });
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/admin/orders', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/orders/:id', adminAuth, async (req, res) => {
    try {
        const { payment_status, order_status } = req.body;
        const result = await pool.query(
            `UPDATE orders SET payment_status=$1, order_status=$2 WHERE id=$3 RETURNING *`,
            [payment_status, order_status, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/admin/layby', adminAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM layby ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.put('/api/admin/layby/:id', adminAuth, async (req, res) => {
    try {
        const { status } = req.body;
        const result = await pool.query(`UPDATE layby SET status=$1 WHERE id=$2 RETURNING *`, [status, req.params.id]);
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
