const assert = require('assert');
const http = require('http');
const pool = require('./config/db');
const { calculateRentalEstimate, calculateExpectedReturn } = require('./utils/rentalHelper');

const BASE_URL = 'http://localhost:3000';
let sessionCookie = '';

function makeRequest(path, method = 'GET', data = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const reqHeaders = { ...headers };
        if (sessionCookie) reqHeaders['Cookie'] = sessionCookie;

        let payload = null;
        if (data) {
            if (headers['Content-Type'] === 'application/json') {
                payload = JSON.stringify(data);
            } else if (headers['Content-Type'] === 'application/x-www-form-urlencoded') {
                payload = typeof data === 'string' ? data : new URLSearchParams(data).toString();
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
                resolve({ status: res.statusCode, headers: res.headers, body });
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function runRentalReportsSuite() {
    console.log('========================================================================');
    console.log('   RENTAL MULTI-UNIT, ADVANCE & REPORTS AUTOMATED INTEGRATION SUITE    ');
    console.log('========================================================================\n');

    let passed = 0;
    let failed = 0;

    async function test(name, fn) {
        try {
            await fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name} -> ${err.message}`);
            failed++;
        }
    }

    // --- 1. Login ---
    await test('Authentication with Admin account', async () => {
        const loginRes = await makeRequest('/login.php', 'POST', {
            user_name: 'Admin123',
            password: 'admin123'
        }, { 'Content-Type': 'application/x-www-form-urlencoded' });
        assert.strictEqual([200, 302].includes(loginRes.status), true, 'Login should succeed');
        assert.strictEqual(Boolean(sessionCookie), true, 'Session cookie should be obtained');
    });

    // --- 2. Unit Calculation Logic for Hour, Day, Week, Month ---
    await test('Rental Rate calculation for Hourly unit', async () => {
        const res = calculateRentalEstimate('hourly', 150, null, null, 5);
        assert.strictEqual(res.units, 5, 'Should bill 5 hours');
        assert.strictEqual(res.totalEstimated, 750, 'Total should be 5 * 150 = 750');
    });

    await test('Rental Rate calculation for Daily unit', async () => {
        const res = calculateRentalEstimate('daily', 500, null, null, 3);
        assert.strictEqual(res.units, 3, 'Should bill 3 days');
        assert.strictEqual(res.totalEstimated, 1500, 'Total should be 3 * 500 = 1500');
    });

    await test('Rental Rate calculation for Weekly unit', async () => {
        const res = calculateRentalEstimate('weekly', 2500, null, null, 2);
        assert.strictEqual(res.units, 2, 'Should bill 2 weeks');
        assert.strictEqual(res.totalEstimated, 5000, 'Total should be 2 * 2500 = 5000');
    });

    await test('Rental Rate calculation for Monthly unit', async () => {
        const res = calculateRentalEstimate('monthly', 9000, null, null, 1);
        assert.strictEqual(res.units, 1, 'Should bill 1 month');
        assert.strictEqual(res.totalEstimated, 9000, 'Total should be 1 * 9000 = 9000');
    });

    // --- 3. Compute Expected Checkout Datetime for all period types ---
    await test('calculateExpectedReturn computes correct timestamps for all units', async () => {
        const base = '2026-09-10T09:00';
        const hOut = calculateExpectedReturn(base, 'hourly', 4);
        assert.strictEqual(hOut, '2026-09-10T13:00', 'Hourly duration check');

        const dOut = calculateExpectedReturn(base, 'daily', 2);
        assert.strictEqual(dOut, '2026-09-12T09:00', 'Daily duration check');

        const wOut = calculateExpectedReturn(base, 'weekly', 1);
        assert.strictEqual(wOut, '2026-09-17T09:00', 'Weekly duration check');

        const mOut = calculateExpectedReturn(base, 'monthly', 1);
        assert.strictEqual(mOut, '2026-10-10T09:00', 'Monthly duration check');
    });

    // --- 4. Rental Checkout Creation & Advance Payment Tests ---
    // Fetch a test customer and rental-available product from DB
    const [custRows] = await pool.query('SELECT id, customer_name FROM customer_master WHERE status = 1 LIMIT 1');
    const [prodRows] = await pool.query('SELECT id, product_name FROM product_master WHERE status = 1 AND rental_available = 1 LIMIT 1');
    assert.strictEqual(custRows.length > 0, true, 'Need at least 1 active customer in DB');
    assert.strictEqual(prodRows.length > 0, true, 'Need at least 1 rental-available product in DB');

    const testCustomerId = custRows[0].id;
    const testProductId = prodRows[0].id;

    await test('Rental Checkout: Overpayment rejection when advance > estimated rental fee', async () => {
        // Duration: 2 days @ 500 = 1000. Try advance of 1500 (overpayment)
        const checkIn = new Date().toISOString().slice(0, 16);
        const res = await makeRequest('/rentals/create', 'POST', {
            customer_id: testCustomerId,
            product_id: testProductId,
            check_in_datetime: checkIn,
            rental_period_type: 'daily',
            estimated_duration: 2,
            rental_duration: 2,
            rental_rate: 500,
            advance_rental_amount: 1500, // OVERPAYMENT!
            security_deposit: 0,
            notes: 'Test overpayment prevention'
        }, { 'Content-Type': 'application/x-www-form-urlencoded' });

        // Controller should re-render or return error message
        assert.strictEqual(
            res.body.toLowerCase().includes('cannot exceed estimated rental amount') || res.status === 400,
            true,
            'Should display overpayment validation error'
        );
    });

    let createdRentalId = null;
    await test('Rental Checkout: Successful creation with valid partial advance payment', async () => {
        // Duration: 3 days @ 400 = 1200. Advance = 400 (remaining = 800)
        const checkIn = new Date().toISOString().slice(0, 16);
        const res = await makeRequest('/rentals/create', 'POST', {
            customer_id: testCustomerId,
            product_id: testProductId,
            check_in_datetime: checkIn,
            rental_period_type: 'daily',
            estimated_duration: 3,
            rental_duration: 3,
            rental_rate: 400,
            advance_rental_amount: 400,
            security_deposit: 100,
            notes: 'Automated Test Rental Suite'
        }, { 'Content-Type': 'application/x-www-form-urlencoded' });

        assert.strictEqual([200, 302].includes(res.status), true, 'Rental creation should succeed');

        // Check the database
        const [recentRentals] = await pool.query(
            'SELECT id, rental_no, total_rental_amount, advance_rental_amount, rental_status FROM rentals WHERE notes = ? ORDER BY id DESC LIMIT 1',
            ['Automated Test Rental Suite']
        );
        assert.strictEqual(recentRentals.length, 1, 'Rental record should be inserted in DB');
        createdRentalId = recentRentals[0].id;
        assert.strictEqual(Number(recentRentals[0].advance_rental_amount), 400, 'Advance amount should be stored as 400');
        assert.strictEqual(Number(recentRentals[0].total_rental_amount), 1200, 'Total estimated rental amount should be 1200');
    });

    // --- 5. Reports Dashboard GET /reports ---
    await test('GET /reports renders Rentals report dashboard with 200 OK', async () => {
        const res = await makeRequest('/reports?report_type=rentals');
        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        assert.strictEqual(res.body.includes('Reports &amp; Analytics') || res.body.includes('Reports & Analytics'), true, 'Should render title');
        assert.strictEqual(res.body.includes('Rentals Report'), true, 'Should contain Rentals Report tab');
        assert.strictEqual(res.body.includes('Export Excel'), true, 'Should contain Export Excel button');
        assert.strictEqual(res.body.includes('Export Word'), true, 'Should contain Export Word button');
        assert.strictEqual(res.body.includes('Print / PDF'), true, 'Should contain Print / PDF button');
        assert.strictEqual(res.body.includes('Estimated Rental Revenue'), true, 'Should contain KPI card');
    });

    await test('GET /reports renders Sales Notes report dashboard with 200 OK', async () => {
        const res = await makeRequest('/reports?report_type=sales');
        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        assert.strictEqual(res.body.includes('Sales Notes Report'), true, 'Should contain Sales Notes Report tab');
        assert.strictEqual(res.body.includes('Total Sales Value'), true, 'Should contain Total Sales Value KPI card');
        assert.strictEqual(res.body.includes('Credit / Outstanding'), true, 'Should contain Credit KPI card');
    });

    await test('Reports filter: Customer & Rental Status filter', async () => {
        const res = await makeRequest(`/reports?report_type=rentals&customer_id=${testCustomerId}&status=Active`);
        assert.strictEqual(res.status, 200, 'Filtered reports should return HTTP 200');
        assert.strictEqual(res.body.includes('rentalsReportTable'), true, 'Should render rentals report table');
    });

    await test('Reports filter: Empty state displays correctly without broken totals', async () => {
        const res = await makeRequest('/reports?report_type=rentals&from_date=2099-01-01&to_date=2099-01-02');
        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        assert.strictEqual(res.body.includes('No records found for the selected filters'), true, 'Should show clean empty state message');
    });

    // --- 6. Export Endpoints ---
    await test('GET /reports/export/excel returns valid SpreadsheetML XML with Excel headers', async () => {
        const res = await makeRequest('/reports/export/excel?report_type=rentals');
        assert.strictEqual(res.status, 200, 'Excel export should return HTTP 200');
        assert.strictEqual(res.headers['content-type'].includes('application/vnd.ms-excel'), true, 'Content-Type should be ms-excel');
        assert.strictEqual(res.headers['content-disposition'].includes('attachment'), true, 'Content-Disposition should be attachment');
        assert.strictEqual(res.body.includes('urn:schemas-microsoft-com:office:spreadsheet'), true, 'Body should contain SpreadsheetML namespace');
        assert.strictEqual(res.body.includes('<Workbook'), true, 'Body should contain <Workbook> tag');
    });

    await test('GET /reports/export/excel for sales returns valid SpreadsheetML XML', async () => {
        const res = await makeRequest('/reports/export/excel?report_type=sales');
        assert.strictEqual(res.status, 200, 'Excel export for sales should return HTTP 200');
        assert.strictEqual(res.headers['content-type'].includes('application/vnd.ms-excel'), true, 'Content-Type should be ms-excel');
        assert.strictEqual(res.body.includes('<Workbook'), true, 'Body should contain <Workbook>');
    });

    await test('GET /reports/export/word returns valid Word document format', async () => {
        const res = await makeRequest('/reports/export/word?report_type=rentals');
        assert.strictEqual(res.status, 200, 'Word export should return HTTP 200');
        assert.strictEqual(res.headers['content-type'].includes('application/msword'), true, 'Content-Type should be msword');
        assert.strictEqual(res.headers['content-disposition'].includes('attachment'), true, 'Content-Disposition should be attachment');
        assert.strictEqual(res.body.includes('urn:schemas-microsoft-com:office:word'), true, 'Body should contain Word document namespace');
    });

    await test('GET /reports/export/pdf returns printable report HTML with print styles', async () => {
        const res = await makeRequest('/reports/export/pdf?report_type=rentals');
        assert.strictEqual(res.status, 200, 'PDF export should return HTTP 200');
        assert.strictEqual(res.headers['content-type'].includes('text/html'), true, 'Content-Type should be text/html');
        assert.strictEqual(res.body.includes('@media print'), true, 'Should include print stylesheet');
        assert.strictEqual(res.body.includes('window.print()'), true, 'Should trigger window.print()');
    });

    // --- 7. Sidebar Integration Verification ---
    await test('Sidebar navigation contains link to Reports module', async () => {
        const res = await makeRequest('/reports');
        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        assert.strictEqual(res.body.includes('href="/reports"'), true, 'Sidebar should contain link to /reports');
        assert.strictEqual(res.body.includes('bi-file-earmark-bar-graph'), true, 'Sidebar should have Reports icon');
    });

    // Clean up created test rental
    if (createdRentalId) {
        await pool.query('DELETE FROM rentals WHERE id = ?', [createdRentalId]);
        await pool.query('UPDATE product_master SET stock_quantity = stock_quantity + 1 WHERE id = ?', [testProductId]);
    }

    console.log('\n========================================================================');
    console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runRentalReportsSuite().catch(err => {
    console.error('Fatal error running test suite:', err);
    process.exit(1);
});
