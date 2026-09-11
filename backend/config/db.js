require('dotenv').config();
const mysql = require('mysql2/promise');

// Parse database configuration from environment variables or connection URI
let poolConfig = {};

if (process.env.DATABASE_URL || process.env.MYSQL_URL) {
    try {
        const dbUrl = new URL(process.env.DATABASE_URL || process.env.MYSQL_URL);
        poolConfig = {
            host: dbUrl.hostname,
            port: parseInt(dbUrl.port || '3306', 10),
            user: decodeURIComponent(dbUrl.username),
            password: decodeURIComponent(dbUrl.password),
            database: dbUrl.pathname.replace(/^\//, '')
        };
    } catch (e) {
        console.error('[Database] Failed to parse DATABASE_URL / MYSQL_URL, falling back to individual variables.');
    }
}

// Fallback or override with individual environment variables
poolConfig.host = process.env.DB_HOST || process.env.MYSQL_HOST || poolConfig.host || 'localhost';
poolConfig.port = parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || poolConfig.port || '3306', 10);
poolConfig.user = process.env.DB_USER || process.env.MYSQL_USER || poolConfig.user || 'root';
poolConfig.password = process.env.DB_PASSWORD !== undefined 
    ? process.env.DB_PASSWORD 
    : (process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : (poolConfig.password || ''));
poolConfig.database = process.env.DB_NAME || process.env.MYSQL_DATABASE || poolConfig.database || 'powertools_db';

// SSL Configuration for Cloud MySQL (e.g. Aiven, TiDB, PlanetScale, Railway)
const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(poolConfig.host.toLowerCase());
const sslRequested = process.env.DB_SSL !== undefined 
    ? (process.env.DB_SSL === 'true' || process.env.DB_SSL === '1') 
    : (!isLocalhost && process.env.NODE_ENV === 'production');

if (sslRequested && !isLocalhost) {
    poolConfig.ssl = {
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true'
    };
}

// Connection Pool Configuration
poolConfig.waitForConnections = true;
poolConfig.connectionLimit = parseInt(process.env.DB_CONNECTION_LIMIT || '15', 10);
poolConfig.queueLimit = 0;
poolConfig.namedPlaceholders = true;
poolConfig.decimalNumbers = true;
poolConfig.timezone = '+00:00';
poolConfig.dateStrings = true;
poolConfig.enableKeepAlive = true;
poolConfig.keepAliveInitialDelay = 10000;

const pool = mysql.createPool(poolConfig);

// Safe startup diagnostics (Never logs passwords or secret connection strings)
const sslStatus = poolConfig.ssl ? 'Enabled' : 'Disabled';
console.log(`[Database] Initializing connection pool (Host: ${poolConfig.host}:${poolConfig.port}, Database: ${poolConfig.database}, User: ${poolConfig.user}, SSL: ${sslStatus})`);

(async () => {
    try {
        const connection = await pool.getConnection();
        console.log(`[Database] Connection verified successfully to '${poolConfig.database}' at ${poolConfig.host}:${poolConfig.port}`);
        connection.release();
    } catch (err) {
        console.error(`[Database] Connection failed: ${err.message} (${err.code || 'UNKNOWN'})`);
        if (isLocalhost && (process.env.NODE_ENV === 'production' || process.env.RENDER)) {
            console.error('[Database] NOTICE: Running on cloud/Render host with localhost/127.0.0.1 database target.');
            console.error('[Database] NOTICE: Render cannot access local XAMPP on your PC. Please set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in Render environment variables.');
        }
    }
})();

module.exports = pool;
