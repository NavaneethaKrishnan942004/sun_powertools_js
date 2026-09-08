require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'powertools_db',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    namedPlaceholders: true,
    decimalNumbers: true,
    timezone: '+00:00',
    dateStrings: true
});

// Test connection on startup
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log(`[Database] Connected successfully to MySQL (${process.env.DB_NAME || 'powertools_db'})`);
        connection.release();
    } catch (err) {
        console.error('[Database] Connection failed:', err.message);
    }
})();

module.exports = pool;
