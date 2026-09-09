const pool = require('../config/db');

async function migrate() {
    try {
        console.log('[Migration] Checking sale_type column...');
        const [cols] = await pool.query("SHOW COLUMNS FROM sales_notes LIKE 'sale_type'");
        if (cols.length === 0) {
            console.log('[Migration] Adding sale_type column to sales_notes...');
            await pool.query("ALTER TABLE sales_notes ADD COLUMN sale_type ENUM('sale', 'credit') NOT NULL DEFAULT 'sale' AFTER sales_time");
            console.log('[Migration] Column sale_type added successfully.');
        } else {
            console.log('[Migration] Column sale_type already exists.');
        }

        console.log('[Migration] Updating historical records...');
        const [updateRes] = await pool.query(
            "UPDATE sales_notes SET sale_type = 'credit' WHERE credit_amount > 0 OR payment_type = 'Credit'"
        );
        console.log(`[Migration] Updated ${updateRes.affectedRows} records to 'credit'.`);

        const [verify] = await pool.query(
            "SELECT id, sales_note_no, sale_type, payment_type, total_amount, paid_amount, credit_amount FROM sales_notes ORDER BY id DESC LIMIT 5"
        );
        console.log('[Migration] Sample records:', verify);
        process.exit(0);
    } catch (err) {
        console.error('[Migration] Failed:', err);
        process.exit(1);
    }
}

migrate();
