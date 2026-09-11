require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

// Middlewares
const { attachUserContext } = require('./middleware/auth');
const { viewHelpers } = require('./middleware/viewHelpers');

// Route Modules
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const profileRoutes = require('./routes/profileRoutes');
const userRoutes = require('./routes/userRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const brandRoutes = require('./routes/brandRoutes');
const unitRoutes = require('./routes/unitRoutes');
const productTypeRoutes = require('./routes/productTypeRoutes');
const customerRoutes = require('./routes/customerRoutes');
const productRoutes = require('./routes/productRoutes');
const salesNoteRoutes = require('./routes/salesNoteRoutes');
const rentalRoutes = require('./routes/rentalRoutes');
const reportRoutes = require('./routes/reportRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Trust reverse proxy for Render / Cloudflare (HTTPS termination & client IP)
app.set('trust proxy', 1);

// Set View Engine (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Body Parsers
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));

// Session Configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'sun_powertools_secret_key_123',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 1 day
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto' // Secure on HTTPS (Render), works on HTTP (localhost)
    }
}));

// Serve Static Assets
// Supports both root '/assets' and prefix '/sun_powertools/assets'
const assetsDir = path.join(__dirname, '../assets');
const uploadsDir = path.join(__dirname, '../uploads');

app.use('/assets', express.static(assetsDir));
app.use('/sun_powertools/assets', express.static(assetsDir));

app.use('/uploads', express.static(uploadsDir));
app.use('/sun_powertools/uploads', express.static(uploadsDir));

// Serve favicon
app.get(['/favicon.ico', '/sun_powertools/favicon.ico'], (req, res) => {
    res.sendFile(path.join(assetsDir, 'images/logo/favicon.ico'), (err) => {
        if (err) res.status(204).end();
    });
});

// Global Template Helpers & Auth Context
app.use(viewHelpers);
app.use(attachUserContext);

// Register Routes
app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/', settingsRoutes);
app.use('/', profileRoutes);
app.use('/', userRoutes);
app.use('/', categoryRoutes);
app.use('/', brandRoutes);
app.use('/', unitRoutes);
app.use('/', productTypeRoutes);
app.use('/', customerRoutes);
app.use('/', productRoutes);
app.use('/', salesNoteRoutes);
app.use('/', rentalRoutes);
app.use('/', reportRoutes);

// 404 Handler
app.use((req, res) => {
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({ success: false, message: 'Resource not found.' });
    }
    if (req.session && req.session.user_id) {
        return res.redirect('/');
    }
    res.redirect('/login');
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[Server Error]', err);
    const isProd = process.env.NODE_ENV === 'production';
    const clientMessage = isProd ? 'An unexpected error occurred. Please try again later.' : (err.message || 'Internal Server Error');
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(500).json({ success: false, message: clientMessage });
    }
    res.status(500).send(`<h3>An unexpected error occurred</h3><p>${clientMessage}</p><a href="/">Return to Dashboard</a>`);
});

// Start Server
const server = app.listen(PORT, HOST, () => {
    console.log(`=========================================`);
    console.log(`  Sun PowerTools Node.js Backend Server  `);
    console.log(`  Running on: http://${HOST}:${PORT}   `);
    console.log(`=========================================`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[Server Error] Port ${PORT} is already in use by another process.`);
    } else {
        console.error('[Server Error]', err);
    }
});

module.exports = app;
