require('dotenv').config();
const pool = require('./config/db');
const assert = require('assert');
const http = require('http');

let sessionCookie = '';

function makeRequest(path, method = 'GET', data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, 'http://localhost:3000');
        const reqHeaders = { ...headers };
        if (sessionCookie) {
            reqHeaders['Cookie'] = sessionCookie;
        }

        let payload = null;
        if (data) {
            if (reqHeaders['Content-Type'] === 'application/x-www-form-urlencoded') {
                payload = new URLSearchParams(data).toString();
            } else if (reqHeaders['Content-Type'] === 'application/json') {
                payload = JSON.stringify(data);
            } else {
                payload = new URLSearchParams(data).toString();
                reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
            }
            reqHeaders['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = http.request(url, { method, headers: reqHeaders }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.headers['set-cookie']) {
                    for (const rawCookie of res.headers['set-cookie']) {
                        const cookie = rawCookie.split(';')[0];
                        if (cookie.includes('=')) {
                            sessionCookie = cookie;
                        }
                    }
                }
                let json = null;
                try { json = JSON.parse(body); } catch (e) {}
                resolve({ status: res.statusCode, headers: res.headers, body, json });
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function runTests() {
    console.log('=== Starting Sun PowerTools ERP Product Type & Filtering Verification ===\n');

    let testSalesProdId = null;
    let testRentalProdId = null;

    try {
        // 1. Verify schema column
        console.log('[Test 1] Checking product_master table for product_type column...');
        const [columns] = await pool.query(`SHOW COLUMNS FROM product_master LIKE 'product_type'`);
        assert.strictEqual(columns.length, 1, 'Column product_type must exist in product_master');
        console.log('✓ product_type column exists: Type =', columns[0].Type);

        // Fetch valid brand and category for test insertions
        const [cats] = await pool.query('SELECT id FROM category_master WHERE status = 1 LIMIT 1');
        const [brands] = await pool.query('SELECT id FROM brand_master WHERE status = 1 LIMIT 1');
        const categoryId = cats.length ? cats[0].id : 1;
        const brandId = brands.length ? brands[0].id : 1;

        // 2. Insert test Sales Product
        console.log('\n[Test 2] Inserting Test Sales Product...');
        const [salesRes] = await pool.query(
            `INSERT INTO product_master (
                product_code, product_name, short_name, category_id, brand_id,
                product_type, sale_available, rental_available, selling_price, stock_quantity, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ['TEST-SALES-001', 'Test Cordless Drill (Sales)', 'Drill Sales', categoryId, brandId, 'Sales', 1, 0, 4500.00, 10, 1]
        );
        testSalesProdId = salesRes.insertId;
        console.log('✓ Inserted Test Sales Product ID:', testSalesProdId);

        // 3. Insert test Rental Product
        console.log('\n[Test 3] Inserting Test Rental Product...');
        const [rentalRes] = await pool.query(
            `INSERT INTO product_master (
                product_code, product_name, short_name, category_id, brand_id,
                product_type, sale_available, rental_available, selling_price, stock_quantity, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ['TEST-RENTAL-001', 'Test Demolition Hammer (Rental)', 'Hammer Rental', categoryId, brandId, 'Rental', 0, 1, 0.00, 5, 1]
        );
        testRentalProdId = rentalRes.insertId;
        console.log('✓ Inserted Test Rental Product ID:', testRentalProdId);

        // 4. Verify DB flags
        console.log('\n[Test 4] Verifying database flags...');
        const [salesProdRow] = await pool.query('SELECT product_type, sale_available, rental_available FROM product_master WHERE id = ?', [testSalesProdId]);
        assert.strictEqual(salesProdRow[0].product_type, 'Sales');
        assert.strictEqual(salesProdRow[0].sale_available, 1);
        assert.strictEqual(salesProdRow[0].rental_available, 0);
        console.log('✓ Sales Product flags verified: product_type=Sales, sale_available=1, rental_available=0');

        const [rentalProdRow] = await pool.query('SELECT product_type, sale_available, rental_available FROM product_master WHERE id = ?', [testRentalProdId]);
        assert.strictEqual(rentalProdRow[0].product_type, 'Rental');
        assert.strictEqual(rentalProdRow[0].sale_available, 0);
        assert.strictEqual(rentalProdRow[0].rental_available, 1);
        console.log('✓ Rental Product flags verified: product_type=Rental, sale_available=0, rental_available=1');

        // 5. Test Sales Note query filter (must include Sales product, exclude Rental product)
        console.log('\n[Test 5] Testing Sales Note product query...');
        const [salesQueryRows] = await pool.query(`
            SELECT id, product_code, product_name, product_type, sale_available 
            FROM product_master p
            WHERE p.status = 1 AND (p.product_type = 'Sales' OR (p.sale_available = 1 AND (p.product_type IS NULL OR p.product_type = '')))
            AND p.id IN (?, ?)
        `, [testSalesProdId, testRentalProdId]);
        
        assert.strictEqual(salesQueryRows.length, 1, 'Only the Sales product should be returned in Sales Note query');
        assert.strictEqual(salesQueryRows[0].id, testSalesProdId, 'Returned product must be the Sales product');
        console.log('✓ Sales Note query correctly includes Sales product and excludes Rental product');

        // 6. Test Rental Checkout query filter (must include Rental product, exclude Sales product)
        console.log('\n[Test 6] Testing Rental Checkout product query...');
        const [rentalQueryRows] = await pool.query(`
            SELECT id, product_code, product_name, product_type, rental_available 
            FROM product_master p
            WHERE p.status = 1 AND (p.product_type = 'Rental' OR (p.rental_available = 1 AND (p.product_type IS NULL OR p.product_type = '')))
            AND p.stock_quantity > 0
            AND p.id IN (?, ?)
        `, [testSalesProdId, testRentalProdId]);

        assert.strictEqual(rentalQueryRows.length, 1, 'Only the Rental product should be returned in Rental Checkout query');
        assert.strictEqual(rentalQueryRows[0].id, testRentalProdId, 'Returned product must be the Rental product');
        console.log('✓ Rental Checkout query correctly includes Rental product and excludes Sales product');

        // Login first for authenticated API tests
        console.log('\n[Test 7] Authenticating as Admin for HTTP API...');
        const loginRes = await makeRequest('/login.php', 'POST', {
            user_name: 'Admin123',
            password: 'admin123'
        });
        assert([200, 302].includes(loginRes.status), 'Admin login successful');
        console.log('✓ Admin authenticated successfully');

        // 8. Test HTTP API endpoint /api/products?type=sales
        console.log('\n[Test 8] Testing HTTP API GET /api/products?type=sales...');
        const apiSales = await makeRequest('/api/products?type=sales&q=TEST-');
        assert.strictEqual(apiSales.status, 200, 'Status must be 200 OK');
        assert.strictEqual(apiSales.json && apiSales.json.success, true, 'API response success must be true');
        const foundSalesInSales = apiSales.json.products.some(p => p.id === testSalesProdId);
        const foundRentalInSales = apiSales.json.products.some(p => p.id === testRentalProdId);
        assert.strictEqual(foundSalesInSales, true, 'API /api/products?type=sales must return the Sales product');
        assert.strictEqual(foundRentalInSales, false, 'API /api/products?type=sales must NOT return the Rental product');
        console.log('✓ GET /api/products?type=sales correctly filtered only Sales products');

        // 9. Test HTTP API endpoint /api/products?type=rental
        console.log('\n[Test 9] Testing HTTP API GET /api/products?type=rental...');
        const apiRental = await makeRequest('/api/products?type=rental&q=TEST-');
        assert.strictEqual(apiRental.status, 200, 'Status must be 200 OK');
        assert.strictEqual(apiRental.json && apiRental.json.success, true, 'API response success must be true');
        const foundSalesInRental = apiRental.json.products.some(p => p.id === testSalesProdId);
        const foundRentalInRental = apiRental.json.products.some(p => p.id === testRentalProdId);
        assert.strictEqual(foundSalesInRental, false, 'API /api/products?type=rental must NOT return the Sales product');
        assert.strictEqual(foundRentalInRental, true, 'API /api/products?type=rental must return the Rental product');
        console.log('✓ GET /api/products?type=rental correctly filtered only Rental products');

        console.log('\n======================================================');
        console.log('ALL 9 PRODUCT TYPE & AVAILABILITY TESTS PASSED!');
        console.log('======================================================');
    } finally {
        // Cleanup test products
        if (testSalesProdId) {
            await pool.query('DELETE FROM product_master WHERE id = ?', [testSalesProdId]);
        }
        if (testRentalProdId) {
            await pool.query('DELETE FROM product_master WHERE id = ?', [testRentalProdId]);
        }
        await pool.end();
    }
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
