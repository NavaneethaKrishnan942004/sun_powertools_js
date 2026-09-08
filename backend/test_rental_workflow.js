const http = require('http');
const pool = require('./config/db');
const app = require('./server');

async function runRentalTests() {
    console.log('====================================================');
    console.log('  STARTING RENTAL MANAGEMENT AUTOMATED TEST SUITE   ');
    console.log('====================================================\n');

    let server;
    const PORT = 3001; // Use port 3001 for test runner to avoid conflicts

    await new Promise((resolve) => {
        server = app.listen(PORT, () => {
            console.log(`[Test Server] Listening on http://localhost:${PORT}`);
            resolve();
        });
    });

    let sessionCookie = '';

    function request(path, options = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(`http://localhost:${PORT}${path}`);
            const reqOptions = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: options.method || 'GET',
                headers: {
                    ...(options.headers || {})
                }
            };

            if (sessionCookie) {
                reqOptions.headers['Cookie'] = sessionCookie;
            }

            if (options.body) {
                reqOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                reqOptions.headers['Content-Length'] = Buffer.byteLength(options.body);
            }

            const req = http.request(reqOptions, (res) => {
                let data = '';
                if (res.headers['set-cookie']) {
                    sessionCookie = res.headers['set-cookie'][0].split(';')[0];
                }
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: data
                    });
                });
            });

            req.on('error', reject);
            if (options.body) req.write(options.body);
            req.end();
        });
    }

    let passedTests = 0;
    let failedTests = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  [PASS] ${message}`);
            passedTests++;
        } else {
            console.error(`  [FAIL] ${message}`);
            failedTests++;
        }
    }

    try {
        // STEP 1: Authentication
        console.log('Step 1: Authenticating as Admin123...');
        let res = await request('/login.php', {
            method: 'POST',
            body: 'user_name=Admin123&password=admin123'
        });
        assert(res.statusCode === 302, 'Login redirect status 302');
        assert(Boolean(sessionCookie), 'Session cookie acquired');

        // STEP 2: Manage Rentals Page GET
        console.log('\nStep 2: Testing GET /manage_rental.php...');
        res = await request('/manage_rental.php');
        assert(res.statusCode === 200, 'Manage rentals status 200');
        assert(res.body.includes('Rental Management'), 'Body contains "Rental Management" heading');
        assert(res.body.includes('Create Rental Checkout'), 'Body contains "Create Rental Checkout" button');

        // STEP 3: Create Rental Form GET
        console.log('\nStep 3: Testing GET /create_rental.php (Rental Checkout Form)...');
        res = await request('/create_rental.php');
        assert(res.statusCode === 200, 'Create rental form status 200');
        assert(res.body.includes('Rental Checkout'), 'Body contains "Rental Checkout"');
        assert(res.body.includes('Advance Rental Amount'), 'Body contains "Advance Rental Amount" field');
        assert(res.body.includes('check_in_datetime'), 'Body contains check-in datetime input');
        assert(res.body.includes('expected_checkout_datetime'), 'Body contains expected checkout datetime input');

        // STEP 4: AJAX Customer Lookup
        console.log('\nStep 4: Testing AJAX /ajax_rental.php?action=get_customer...');
        res = await request('/ajax_rental.php?action=get_customer&customer_id=1');
        assert(res.statusCode === 200, 'Customer AJAX status 200');
        const custJson = JSON.parse(res.body);
        assert(custJson.success === true, 'Customer AJAX returned success: true');
        assert(Boolean(custJson.customer && custJson.customer.customer_name), `Customer name fetched: ${custJson.customer?.customer_name}`);

        // STEP 5: AJAX Product Lookup
        console.log('\nStep 5: Testing AJAX /ajax_rental.php?action=get_product...');
        res = await request('/ajax_rental.php?action=get_product&product_id=1');
        assert(res.statusCode === 200, 'Product AJAX status 200');
        const prodJson = JSON.parse(res.body);
        assert(prodJson.success === true, 'Product AJAX returned success: true');
        assert(prodJson.product.rental_available === 1, 'Product is marked as rental available');
        assert(Array.isArray(prodJson.product.rates), `Product has ${prodJson.product.rates?.length} configured rental rate period(s)`);

        // STEP 6: AJAX Estimate Calculation
        console.log('\nStep 6: Testing AJAX /ajax_rental.php?action=calculate_estimate...');
        res = await request('/ajax_rental.php?action=calculate_estimate&period_type=daily&rate=150.00&check_in=2026-09-08T10:00&check_out=2026-09-11T10:00');
        assert(res.statusCode === 200, 'Estimate AJAX status 200');
        const estJson = JSON.parse(res.body);
        assert(estJson.success === true, 'Estimate returned success: true');
        assert(estJson.estimate.units === 3, 'Calculated duration: 3 days');
        assert(estJson.estimate.totalEstimated === 450, 'Calculated total: ₹450');

        // STEP 7: Form Validation Tests
        console.log('\nStep 7: Testing Rental Validation Rules...');
        // 7a: Negative advance amount
        res = await request('/create_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                customer_id: '1',
                product_id: '1',
                check_in_datetime: '2026-09-08T10:00',
                expected_checkout_datetime: '2026-09-09T10:00',
                advance_rental_amount: '-100.00',
                rental_rate: '150.00'
            }).toString()
        });
        assert(res.body.includes('Advance Rental Amount cannot be negative'), 'Properly rejected negative advance amount');

        // 7b: Check-out earlier than check-in
        res = await request('/create_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                customer_id: '1',
                product_id: '1',
                check_in_datetime: '2026-09-09T10:00',
                expected_checkout_datetime: '2026-09-08T10:00',
                advance_rental_amount: '100.00',
                rental_rate: '150.00'
            }).toString()
        });
        assert(res.body.includes('must be later than Check-In Date & Time'), 'Properly rejected checkout date earlier than checkin');

        // STEP 8: Valid Rental Creation Transaction
        console.log('\nStep 8: Testing Valid Rental Submission...');
        // Get initial product stock
        const [initialProd] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 1');
        const initialStock = parseInt(initialProd[0].stock_quantity, 10);
        console.log(`   Initial stock of Product 1: ${initialStock}`);

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const checkInStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const checkOutStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;

        res = await request('/create_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                customer_id: '1',
                product_id: '1',
                rental_period_type: 'daily',
                rental_rate: '150.00',
                security_deposit: '500.00',
                check_in_datetime: checkInStr,
                expected_checkout_datetime: checkOutStr,
                advance_rental_amount: '300.00',
                total_rental_amount: '650.00',
                payment_method: 'Cash',
                notes: 'Automated test rental submission'
            }).toString()
        });

        assert(res.statusCode === 302, 'Rental submission status 302 redirect');
        const redirectUrl = res.headers.location;
        assert(redirectUrl.includes('/view_rental.php?id='), `Redirected to view rental: ${redirectUrl}`);

        const rentalIdMatch = redirectUrl.match(/id=(\d+)/);
        const createdRentalId = rentalIdMatch ? parseInt(rentalIdMatch[1], 10) : 0;
        assert(createdRentalId > 0, `Created Rental ID: ${createdRentalId}`);

        // Verify in Database
        const [rentalRows] = await pool.query('SELECT * FROM rentals WHERE id = ?', [createdRentalId]);
        assert(rentalRows.length > 0, 'Rental record found in database');
        const createdRental = rentalRows[0];
        assert(createdRental.rental_status === 'Active', `Rental status is Active (Actual: ${createdRental.rental_status})`);
        assert(parseFloat(createdRental.advance_rental_amount) === 300.00, 'Advance rental amount stored correctly (₹300.00)');
        assert(Boolean(createdRental.rental_no), `Rental number generated: ${createdRental.rental_no}`);

        // Verify product stock decremented by 1
        const [decrementedProd] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 1');
        const afterStock = parseInt(decrementedProd[0].stock_quantity, 10);
        assert(afterStock === initialStock - 1, `Product stock decremented from ${initialStock} to ${afterStock}`);

        // Verify Customer Transaction created
        const [txRows] = await pool.query('SELECT * FROM customer_transactions WHERE reference_number = ? AND transaction_type = "rental"', [createdRental.rental_no]);
        assert(txRows.length > 0, 'Customer transaction ledger record created');
        if (txRows.length > 0) {
            assert(parseFloat(txRows[0].paid_amount) === 300.00, 'Ledger paid amount recorded as advance (₹300.00)');
        }

        // STEP 9: View Rental Details
        console.log('\nStep 9: Testing GET /view_rental.php...');
        res = await request(`/view_rental.php?id=${createdRentalId}`);
        assert(res.statusCode === 200, 'View rental page status 200');
        assert(res.body.includes(createdRental.rental_no), `Page contains Rental No: ${createdRental.rental_no}`);
        assert(res.body.includes('Active'), 'Page displays Active status badge');
        assert(res.body.includes('Return Product'), 'Page contains Return Product action');

        // STEP 10: Return Rental Product
        console.log('\nStep 10: Testing Return Product Action...');
        res = await request('/return_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                id: String(createdRentalId),
                actual_return_datetime: checkOutStr,
                total_rental_amount: '150.00',
                additional_charges: '0.00',
                refund_amount: '500.00',
                notes: 'Tool returned in perfect condition'
            }).toString()
        });

        assert(res.statusCode === 302, 'Return action status 302 redirect');

        // Verify DB update after return
        const [returnedRows] = await pool.query('SELECT * FROM rentals WHERE id = ?', [createdRentalId]);
        const returnedRental = returnedRows[0];
        assert(returnedRental.rental_status === 'Returned', `Rental status updated to Returned (Actual: ${returnedRental.rental_status})`);
        assert(Boolean(returnedRental.actual_return_datetime), `Actual return datetime recorded: ${returnedRental.actual_return_datetime}`);

        // Verify product stock restored (+1)
        const [restoredProd] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 1');
        const restoredStock = parseInt(restoredProd[0].stock_quantity, 10);
        assert(restoredStock === initialStock, `Product stock restored to initial value: ${restoredStock}`);

        // STEP 11: Cancel Rental Workflow Test
        console.log('\nStep 11: Testing Cancel Rental Action...');
        // Create a 2nd rental to cancel
        const res2 = await request('/create_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                customer_id: '1',
                product_id: '1',
                rental_period_type: 'daily',
                rental_rate: '150.00',
                security_deposit: '0.00',
                check_in_datetime: checkInStr,
                expected_checkout_datetime: checkOutStr,
                advance_rental_amount: '150.00',
                total_rental_amount: '150.00',
                payment_method: 'Cash',
                notes: 'Test rental to be cancelled'
            }).toString()
        });

        const cancelRentalIdMatch = res2.headers.location?.match(/id=(\d+)/);
        const cancelRentalId = cancelRentalIdMatch ? parseInt(cancelRentalIdMatch[1], 10) : 0;
        assert(cancelRentalId > 0, `Created 2nd Rental ID for cancellation: ${cancelRentalId}`);

        // Cancel it
        const cancelRes = await request('/cancel_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                id: String(cancelRentalId),
                reason: 'Customer cancelled booking'
            }).toString()
        });
        assert(cancelRes.statusCode === 302, 'Cancel action status 302 redirect');

        const [cancelledRows] = await pool.query('SELECT * FROM rentals WHERE id = ?', [cancelRentalId]);
        assert(cancelledRows[0].rental_status === 'Cancelled', `Rental status is Cancelled (Actual: ${cancelledRows[0].rental_status})`);

        // STEP 12: Existing Features Non-Regression Check
        console.log('\nStep 12: Checking existing Sales Note & Product features non-regression...');
        const prodRes = await request('/manage_product.php');
        assert(prodRes.statusCode === 200, 'GET /manage_product.php returns 200');
        assert(prodRes.body.includes('Product Master'), 'Product master page renders intact');

        const salesRes = await request('/manage_sales_note.php');
        assert(salesRes.statusCode === 200, 'GET /manage_sales_note.php returns 200');
        assert(salesRes.body.includes('Sales Notes'), 'Sales notes page renders intact');

        console.log('\n====================================================');
        console.log(`  RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
        console.log('====================================================');

    } catch (err) {
        console.error('Test suite uncaught error:', err);
        failedTests++;
    } finally {
        server.close();
        process.exit(failedTests > 0 ? 1 : 0);
    }
}

runRentalTests();
