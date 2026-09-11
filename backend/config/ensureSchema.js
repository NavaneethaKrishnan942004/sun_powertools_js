const pool = require('./db');

/**
 * Table schemas with proper AUTO_INCREMENT PRIMARY KEY definitions
 * Used for creating or migrating tables, especially compatible with TiDB Cloud & MySQL.
 */
const TABLE_DEFINITIONS = {
    brand_master: `
        CREATE TABLE IF NOT EXISTS \`brand_master\` (
            \`id\` int(11) NOT NULL AUTO_INCREMENT,
            \`brand_code\` varchar(20) NOT NULL,
            \`brand_name\` varchar(100) NOT NULL,
            \`description\` varchar(200) DEFAULT NULL,
            \`status\` tinyint(1) NOT NULL DEFAULT 1,
            \`created_by\` int(11) NOT NULL,
            \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_by\` int(11) DEFAULT NULL,
            \`updated_at\` datetime DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`brand_code\` (\`brand_code\`),
            UNIQUE KEY \`brand_name\` (\`brand_name\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `,
    category_master: `
        CREATE TABLE IF NOT EXISTS \`category_master\` (
            \`id\` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
            \`category_code\` varchar(20) NOT NULL,
            \`category_name\` varchar(100) NOT NULL,
            \`description\` varchar(200) DEFAULT NULL,
            \`status\` tinyint(1) NOT NULL DEFAULT 1,
            \`created_by\` int(10) UNSIGNED NOT NULL,
            \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_by\` int(10) UNSIGNED DEFAULT NULL,
            \`updated_at\` datetime DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`category_code\` (\`category_code\`),
            UNIQUE KEY \`uq_category_name\` (\`category_name\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `,
    customer_master: `
        CREATE TABLE IF NOT EXISTS \`customer_master\` (
            \`id\` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
            \`customer_code\` varchar(20) NOT NULL,
            \`customer_name\` varchar(150) NOT NULL,
            \`customer_type\` enum('Individual','Business') NOT NULL DEFAULT 'Individual',
            \`company_name\` varchar(150) DEFAULT NULL,
            \`mobile_number\` varchar(20) NOT NULL,
            \`alternate_mobile_number\` varchar(20) DEFAULT NULL,
            \`email\` varchar(150) DEFAULT NULL,
            \`gst_number\` varchar(30) DEFAULT NULL,
            \`address\` text DEFAULT NULL,
            \`area\` varchar(100) DEFAULT NULL,
            \`city\` varchar(100) DEFAULT NULL,
            \`district\` varchar(100) DEFAULT NULL,
            \`state\` varchar(100) DEFAULT NULL,
            \`pincode\` varchar(10) DEFAULT NULL,
            \`billing_address\` text DEFAULT NULL,
            \`shipping_address\` text DEFAULT NULL,
            \`credit_allowed\` tinyint(1) NOT NULL DEFAULT 0,
            \`credit_limit\` decimal(12,2) NOT NULL DEFAULT 0.00,
            \`payment_terms\` varchar(50) DEFAULT 'Immediate',
            \`opening_balance\` decimal(12,2) NOT NULL DEFAULT 0.00,
            \`opening_balance_type\` enum('Debit','Credit') NOT NULL DEFAULT 'Debit',
            \`status\` tinyint(1) NOT NULL DEFAULT 1,
            \`created_by\` int(10) UNSIGNED DEFAULT NULL,
            \`created_at\` datetime NOT NULL,
            \`updated_by\` int(10) UNSIGNED DEFAULT NULL,
            \`updated_at\` datetime DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`customer_code\` (\`customer_code\`),
            KEY \`idx_customer_mobile\` (\`mobile_number\`),
            KEY \`idx_customer_status\` (\`status\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    customer_transactions: `
        CREATE TABLE IF NOT EXISTS \`customer_transactions\` (
            \`id\` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
            \`customer_id\` int(10) UNSIGNED NOT NULL,
            \`transaction_type\` enum('sale','rental','payment','return','adjustment') NOT NULL,
            \`reference_number\` varchar(50) NOT NULL,
            \`transaction_date\` datetime NOT NULL,
            \`due_date\` date DEFAULT NULL,
            \`total_amount\` decimal(12,2) NOT NULL DEFAULT 0.00,
            \`paid_amount\` decimal(12,2) NOT NULL DEFAULT 0.00,
            \`debit_amount\` decimal(12,2) NOT NULL DEFAULT 0.00,
            \`credit_amount\` decimal(12,2) NOT NULL DEFAULT 0.00,
            \`payment_method\` varchar(50) DEFAULT NULL,
            \`payment_status\` enum('Paid','Partial','Unpaid','Settled') DEFAULT 'Unpaid',
            \`reason\` varchar(255) DEFAULT NULL,
            \`notes\` text DEFAULT NULL,
            \`created_by\` int(10) UNSIGNED DEFAULT NULL,
            \`created_at\` datetime NOT NULL,
            PRIMARY KEY (\`id\`),
            KEY \`idx_cust_trans\` (\`customer_id\`),
            KEY \`idx_trans_type\` (\`transaction_type\`),
            KEY \`idx_trans_date\` (\`transaction_date\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
    product_images: `
        CREATE TABLE IF NOT EXISTS \`product_images\` (
            \`id\` int(11) NOT NULL AUTO_INCREMENT,
            \`product_id\` int(11) NOT NULL,
            \`image_name\` varchar(255) NOT NULL,
            \`image_path\` varchar(500) NOT NULL,
            \`is_primary\` tinyint(1) NOT NULL DEFAULT 0,
            \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`id\`),
            KEY \`product_id\` (\`product_id\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `,
    product_master: `
        CREATE TABLE IF NOT EXISTS \`product_master\` (
            \`id\` int(11) NOT NULL AUTO_INCREMENT,
            \`product_code\` varchar(20) NOT NULL,
            \`product_name\` varchar(200) NOT NULL,
            \`short_name\` varchar(100) NOT NULL,
            \`category_id\` int(11) NOT NULL,
            \`brand_id\` int(11) NOT NULL,
            \`description\` text DEFAULT NULL,
            \`sale_available\` tinyint(1) NOT NULL DEFAULT 0,
            \`stock_quantity\` int(11) NOT NULL DEFAULT 50,
            \`purchase_price\` decimal(12,2) DEFAULT NULL,
            \`selling_price\` decimal(12,2) DEFAULT NULL,
            \`discount_allowed\` tinyint(1) NOT NULL DEFAULT 0,
            \`discount_percent\` decimal(5,2) DEFAULT NULL,
            \`sale_unit\` decimal(12,2) DEFAULT NULL,
            \`rental_available\` tinyint(1) NOT NULL DEFAULT 0,
            \`power_rating\` varchar(100) DEFAULT NULL,
            \`voltage\` varchar(100) DEFAULT NULL,
            \`rpm\` varchar(100) DEFAULT NULL,
            \`chuck_disc_size\` varchar(100) DEFAULT NULL,
            \`weight\` varchar(100) DEFAULT NULL,
            \`battery_capacity\` varchar(100) DEFAULT NULL,
            \`warranty_period\` varchar(100) DEFAULT NULL,
            \`warranty_applicable\` tinyint(1) NOT NULL DEFAULT 0,
            \`warranty_months\` int(11) DEFAULT NULL,
            \`status\` tinyint(1) NOT NULL DEFAULT 1,
            \`created_by\` int(11) NOT NULL,
            \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_by\` int(11) DEFAULT NULL,
            \`updated_at\` datetime DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`product_code\` (\`product_code\`),
            KEY \`idx_category_id\` (\`category_id\`),
            KEY \`idx_brand_id\` (\`brand_id\`),
            KEY \`idx_status\` (\`status\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `,
    product_rental_rates: `
        CREATE TABLE IF NOT EXISTS \`product_rental_rates\` (
            \`id\` int(11) NOT NULL AUTO_INCREMENT,
            \`product_id\` int(11) NOT NULL,
            \`rental_period\` enum('hourly','daily','weekly','monthly') NOT NULL,
            \`available\` tinyint(1) NOT NULL DEFAULT 0,
            \`rental_unit_id\` int(11) DEFAULT NULL,
            \`security_deposit\` decimal(12,2) DEFAULT NULL,
            \`rental_rate\` decimal(12,2) DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`unique_product_period\` (\`product_id\`,\`rental_period\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `,
    product_type_master: `
        CREATE TABLE IF NOT EXISTS \`product_type_master\` (
            \`id\` int(11) NOT NULL AUTO_INCREMENT,
            \`product_type_code\` varchar(20) NOT NULL,
            \`product_type_name\` varchar(100) NOT NULL,
            \`description\` varchar(200) DEFAULT NULL,
            \`status\` tinyint(1) NOT NULL DEFAULT 1,
            \`created_by\` int(11) NOT NULL,
            \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_by\` int(11) DEFAULT NULL,
            \`updated_at\` datetime DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`product_type_code\` (\`product_type_code\`),
            UNIQUE KEY \`product_type_name\` (\`product_type_name\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `,
    unit_master: `
        CREATE TABLE IF NOT EXISTS \`unit_master\` (
            \`id\` int(11) NOT NULL AUTO_INCREMENT,
            \`unit_code\` varchar(20) NOT NULL,
            \`unit_name\` varchar(100) NOT NULL,
            \`description\` varchar(200) DEFAULT NULL,
            \`status\` tinyint(1) NOT NULL DEFAULT 1,
            \`created_by\` int(11) NOT NULL,
            \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
            \`updated_by\` int(11) DEFAULT NULL,
            \`updated_at\` datetime DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`unit_code\` (\`unit_code\`),
            UNIQUE KEY \`unit_name\` (\`unit_name\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
    `,
    user_master: `
        CREATE TABLE IF NOT EXISTS \`user_master\` (
            \`id\` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
            \`user_id\` varchar(20) NOT NULL,
            \`first_name\` varchar(50) DEFAULT NULL,
            \`last_name\` varchar(50) DEFAULT NULL,
            \`gender\` enum('Male','Female','Other') DEFAULT NULL,
            \`date_of_birth\` date DEFAULT NULL,
            \`user_name\` varchar(100) NOT NULL,
            \`user_email\` varchar(150) NOT NULL,
            \`user_phone\` varchar(20) NOT NULL,
            \`address\` text DEFAULT NULL,
            \`city\` varchar(100) DEFAULT NULL,
            \`state\` varchar(100) DEFAULT NULL,
            \`pincode\` varchar(10) DEFAULT NULL,
            \`avatar\` varchar(255) DEFAULT NULL,
            \`password\` varchar(255) NOT NULL,
            \`role\` enum('user','admin') NOT NULL DEFAULT 'user',
            \`status\` tinyint(1) NOT NULL DEFAULT 1,
            \`created_at\` datetime NOT NULL,
            \`updated_at\` datetime DEFAULT NULL,
            \`last_login_at\` datetime DEFAULT NULL,
            PRIMARY KEY (\`id\`),
            UNIQUE KEY \`uk_user_id\` (\`user_id\`),
            UNIQUE KEY \`uk_user_email\` (\`user_email\`),
            UNIQUE KEY \`uk_user_phone\` (\`user_phone\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `
};

/**
 * Ensures all database tables have AUTO_INCREMENT PRIMARY KEY on their 'id' column.
 * Handles TiDB Cloud (which rejects ALTER TABLE ... MODIFY id AUTO_INCREMENT)
 * by safely recreating and swapping tables while preserving existing rows and IDs.
 */
async function ensureSchema() {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('[Schema] Checking database schema for AUTO_INCREMENT compliance...');

        // Get list of existing tables in the database
        const [tablesResult] = await conn.query('SHOW TABLES');
        const existingTables = tablesResult.map(row => Object.values(row)[0]);

        for (const [tableName, createSql] of Object.entries(TABLE_DEFINITIONS)) {
            // If table doesn't exist yet, create it directly
            if (!existingTables.includes(tableName)) {
                console.log(`[Schema] Table '${tableName}' does not exist. Creating...`);
                await conn.query(createSql);
                console.log(`[Schema] Table '${tableName}' created with AUTO_INCREMENT.`);
                continue;
            }

            // Inspect 'id' column
            const [cols] = await conn.query(`SHOW COLUMNS FROM \`${tableName}\` LIKE 'id'`);
            if (cols.length === 0) {
                console.warn(`[Schema] Table '${tableName}' has no 'id' column. Skipping.`);
                continue;
            }

            const idCol = cols[0];
            const hasAutoIncrement = (idCol.Extra || '').toLowerCase().includes('auto_increment');

            if (hasAutoIncrement) {
                // Table already has auto_increment
                continue;
            }

            console.log(`[Schema] Table '${tableName}' id column lacks AUTO_INCREMENT. Starting repair...`);

            // Attempt 1: Standard MySQL ALTER TABLE
            let alterSuccess = false;
            try {
                const idType = idCol.Type; // e.g. int(11) or int(10) unsigned
                if (idCol.Key !== 'PRI') {
                    await conn.query(`ALTER TABLE \`${tableName}\` ADD PRIMARY KEY (\`id\`)`);
                }
                await conn.query(`ALTER TABLE \`${tableName}\` MODIFY \`id\` ${idType} NOT NULL AUTO_INCREMENT`);
                console.log(`[Schema] Table '${tableName}' updated via ALTER TABLE successfully.`);
                alterSuccess = true;
            } catch (alterErr) {
                console.warn(`[Schema] Standard ALTER TABLE failed on '${tableName}': ${alterErr.message}. Falling back to TiDB table migration...`);
            }

            // Attempt 2: TiDB-compatible table migration (Create new -> Copy -> Rename)
            if (!alterSuccess) {
                try {
                    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

                    const fixTable = `_schema_fix_${tableName}`;
                    const backupTable = `_schema_old_${tableName}`;

                    // 1. Drop any leftover temp tables
                    await conn.query(`DROP TABLE IF EXISTS \`${fixTable}\``);
                    await conn.query(`DROP TABLE IF EXISTS \`${backupTable}\``);

                    // 2. Create the fix table using the clean DDL
                    const fixCreateSql = createSql.replace(`\`${tableName}\``, `\`${fixTable}\``);
                    await conn.query(fixCreateSql);

                    // 3. Copy existing records into fix table (preserves all IDs)
                    await conn.query(`INSERT INTO \`${fixTable}\` SELECT * FROM \`${tableName}\``);

                    // 4. Atomically swap tables
                    await conn.query(`RENAME TABLE \`${tableName}\` TO \`${backupTable}\`, \`${fixTable}\` TO \`${tableName}\``);

                    // 5. Drop old backup table
                    await conn.query(`DROP TABLE IF EXISTS \`${backupTable}\``);

                    // 6. Restore foreign key checks
                    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

                    console.log(`[Schema] Table '${tableName}' successfully migrated to AUTO_INCREMENT via TiDB table swap.`);
                } catch (tidbErr) {
                    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
                    console.error(`[Schema] Error migrating '${tableName}' in TiDB:`, tidbErr.message);
                }
            }
        }

        console.log('[Schema] Schema verification completed.');
    } catch (err) {
        console.error('[Schema] Unexpected error during schema verification:', err.message);
    } finally {
        if (conn) conn.release();
    }
}

module.exports = { ensureSchema, TABLE_DEFINITIONS };
