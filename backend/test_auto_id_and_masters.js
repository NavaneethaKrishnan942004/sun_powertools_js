const pool = require('./config/db');
const { getNextId } = require('./utils/idHelper');
const { ensureSchema } = require('./config/ensureSchema');

async function testAll() {
    console.log('====================================================');
    console.log(' TESTING AUTO-ID, SCHEMA REPAIR & STRICT MODE INSERT');
    console.log('====================================================');

    // 1. Run ensureSchema
    console.log('\n[1] Running ensureSchema()...');
    await ensureSchema();
    console.log('ensureSchema() succeeded.');

    const conn = await pool.getConnection();
    try {
        // Enforce STRICT_ALL_TABLES
        await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
        console.log('\n[2] Session sql_mode set to STRICT_ALL_TABLES.');

        // Test Category insert
        console.log('\n[3] Testing Category insert with getNextId in strict mode...');
        const catId = await getNextId(conn, 'category_master');
        const catCode = `CAT-TST-${Date.now().toString().slice(-4)}`;
        await conn.query(
            'INSERT INTO category_master (id, category_code, category_name, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [catId, catCode, `Test Category ${catId}`, 'Test Desc', 1, 1]
        );
        const [catCheck] = await conn.query('SELECT * FROM category_master WHERE id = ?', [catId]);
        console.log('   [PASS] Inserted Category:', catCheck[0].category_code, 'with ID:', catCheck[0].id);
        await conn.query('DELETE FROM category_master WHERE id = ?', [catId]);

        // Test Brand insert
        console.log('\n[4] Testing Brand insert with getNextId in strict mode...');
        const brandId = await getNextId(conn, 'brand_master');
        const brandCode = `BRA-TST-${Date.now().toString().slice(-4)}`;
        await conn.query(
            'INSERT INTO brand_master (id, brand_code, brand_name, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [brandId, brandCode, `Test Brand ${brandId}`, 'Test Desc', 1, 1]
        );
        const [brandCheck] = await conn.query('SELECT * FROM brand_master WHERE id = ?', [brandId]);
        console.log('   [PASS] Inserted Brand:', brandCheck[0].brand_code, 'with ID:', brandCheck[0].id);
        await conn.query('DELETE FROM brand_master WHERE id = ?', [brandId]);

        // Test Unit insert
        console.log('\n[5] Testing Unit insert with getNextId in strict mode...');
        const unitId = await getNextId(conn, 'unit_master');
        const unitCode = `UNT-TST-${Date.now().toString().slice(-4)}`;
        await conn.query(
            'INSERT INTO unit_master (id, unit_code, unit_name, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [unitId, unitCode, `Test Unit ${unitId}`, 'Test Desc', 1, 1]
        );
        const [unitCheck] = await conn.query('SELECT * FROM unit_master WHERE id = ?', [unitId]);
        console.log('   [PASS] Inserted Unit:', unitCheck[0].unit_code, 'with ID:', unitCheck[0].id);
        await conn.query('DELETE FROM unit_master WHERE id = ?', [unitId]);

        // Test Product Type insert
        console.log('\n[6] Testing Product Type insert with getNextId in strict mode...');
        const ptId = await getNextId(conn, 'product_type_master');
        const ptCode = `PT-TST-${Date.now().toString().slice(-4)}`;
        await conn.query(
            'INSERT INTO product_type_master (id, product_type_code, product_type_name, description, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [ptId, ptCode, `Test Product Type ${ptId}`, 'Test Desc', 1, 1]
        );
        const [ptCheck] = await conn.query('SELECT * FROM product_type_master WHERE id = ?', [ptId]);
        console.log('   [PASS] Inserted Product Type:', ptCheck[0].product_type_code, 'with ID:', ptCheck[0].id);
        await conn.query('DELETE FROM product_type_master WHERE id = ?', [ptId]);

        // Test Customer insert
        console.log('\n[7] Testing Customer insert with getNextId in strict mode...');
        const custId = await getNextId(conn, 'customer_master');
        const custCode = `CUS-TST-${Date.now().toString().slice(-4)}`;
        await conn.query(
            `INSERT INTO customer_master (
                id, customer_code, customer_name, customer_type, mobile_number,
                credit_allowed, credit_limit, opening_balance, opening_balance_type, status, created_by, created_at
            ) VALUES (?, ?, ?, 'Individual', ?, 0, 0.00, 0.00, 'Debit', 1, 1, NOW())`,
            [custId, custCode, `Test Customer ${custId}`, '9876543210']
        );
        const [custCheck] = await conn.query('SELECT * FROM customer_master WHERE id = ?', [custId]);
        console.log('   [PASS] Inserted Customer:', custCheck[0].customer_code, 'with ID:', custCheck[0].id);
        await conn.query('DELETE FROM customer_master WHERE id = ?', [custId]);

        // Test Product insert
        console.log('\n[8] Testing Product insert with getNextId in strict mode...');
        const prodId = await getNextId(conn, 'product_master');
        const prodCode = `PRO-TST-${Date.now().toString().slice(-4)}`;
        await conn.query(
            `INSERT INTO product_master (
                id, product_code, product_name, short_name, category_id, brand_id,
                sale_available, purchase_price, selling_price, status, created_by, created_at
            ) VALUES (?, ?, ?, ?, 1, 1, 1, 100.00, 150.00, 1, 1, NOW())`,
            [prodId, prodCode, `Test Product ${prodId}`, 'Test Prod']
        );
        const [prodCheck] = await conn.query('SELECT * FROM product_master WHERE id = ?', [prodId]);
        console.log('   [PASS] Inserted Product:', prodCheck[0].product_code, 'with ID:', prodCheck[0].id);
        await conn.query('DELETE FROM product_master WHERE id = ?', [prodId]);

        // Test Customer Transaction insert
        console.log('\n[9] Testing Customer Transaction insert with getNextId in strict mode...');
        const txId = await getNextId(conn, 'customer_transactions');
        await conn.query(
            `INSERT INTO customer_transactions (
                id, customer_id, transaction_type, reference_number, transaction_date,
                total_amount, paid_amount, debit_amount, credit_amount, payment_method, payment_status, created_at
            ) VALUES (?, 1, 'sale', 'REF-TEST', NOW(), 100.00, 100.00, 0.00, 0.00, 'Cash', 'Paid', NOW())`,
            [txId]
        );
        const [txCheck] = await conn.query('SELECT * FROM customer_transactions WHERE id = ?', [txId]);
        console.log('   [PASS] Inserted Transaction with ID:', txCheck[0].id);
        await conn.query('DELETE FROM customer_transactions WHERE id = ?', [txId]);

        console.log('\n====================================================');
        console.log(' ALL 9 STRICT MODE TESTS PASSED PERFECTLY!');
        console.log('====================================================');
    } finally {
        conn.release();
    }
}

testAll().then(() => process.exit(0)).catch(err => {
    console.error('FATAL TEST ERROR:', err);
    process.exit(1);
});
