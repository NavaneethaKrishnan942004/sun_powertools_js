const http = require('http');
const pool = require('./config/db');
const app = require('./server');
const rentalHelper = require('./utils/rentalHelper');

async function runRentalTests() {
    console.log('================================================================');
    console.log('  STARTING EXTENSIVE RENTAL MANAGEMENT AUTOMATED TEST SUITE     ');
    console.log('================================================================\n');

    let server;
    const PORT = 3002; // Use port 3002 for test runner

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
        console.log('--- TEST GROUP 1: Authentication & Navigation ---');
        let res = await request('/login.php', {
            method: 'POST',
            body: 'user_name=Admin123&password=admin123'
        });
        assert(res.statusCode === 302, 'Login redirect status 302');
        assert(Boolean(sessionCookie), 'Session cookie acquired');

        res = await request('/manage_rental.php');
        assert(res.statusCode === 200, 'Manage rentals status 200');
        assert(res.body.includes('Rental Management'), 'Body contains "Rental Management" heading');
        assert(res.body.includes('Create Rental Checkout'), 'Body contains "Create Rental Checkout" button');

        res = await request('/create_rental.php');
        assert(res.statusCode === 200, 'Create rental form status 200');
        assert(res.body.includes('Billing Period'), 'Body contains "Billing Period"');
        assert(res.body.includes('Estimated Duration'), 'Body contains "Estimated Duration"');
        assert(res.body.includes('Security Deposit (₹)'), 'Body contains "Security Deposit" field');
        assert(res.body.includes('Advance Rental Amount (₹)'), 'Body contains "Advance Rental Amount" field');
        assert(res.body.includes('Expected Check-Out Date & Time'), 'Body contains "Expected Check-Out Date & Time" (Optional)');

        // STEP 2: DURATION CALCULATION TESTS (Hourly: 1h, 2h, 5h; Daily: 1d, 3d, 7d; Weekly: 1w, 2w; Monthly: 1m, 2m)
        console.log('\n--- TEST GROUP 2: Expected Return Auto-Calculation by Duration ---');

        const baseStart = new Date('2026-09-10T10:00:00');
        const baseStartStr = '2026-09-10T10:00';

        // 2a: Hourly - 1 hour, 2 hours, 5 hours
        let ret1h = rentalHelper.calculateExpectedReturn(baseStart, 'hourly', 1);
        assert(ret1h.includes('11:00'), `Hourly 1 hour calculation gives 11:00 (Actual: ${ret1h})`);
        let ret2h = rentalHelper.calculateExpectedReturn(baseStart, 'hourly', 2);
        assert(ret2h.includes('12:00'), `Hourly 2 hours calculation gives 12:00 (Actual: ${ret2h})`);
        let ret5h = rentalHelper.calculateExpectedReturn(baseStart, 'hourly', 5);
        assert(ret5h.includes('15:00'), `Hourly 5 hours calculation gives 15:00 (Actual: ${ret5h})`);

        // 2b: Daily - 1 day, 3 days, 7 days
        let ret1d = rentalHelper.calculateExpectedReturn(baseStart, 'daily', 1);
        assert(ret1d.startsWith('2026-09-11'), `Daily 1 day calculation gives 2026-09-11 (Actual: ${ret1d})`);
        let ret3d = rentalHelper.calculateExpectedReturn(baseStart, 'daily', 3);
        assert(ret3d.startsWith('2026-09-13'), `Daily 3 days calculation gives 2026-09-13 (Actual: ${ret3d})`);
        let ret7d = rentalHelper.calculateExpectedReturn(baseStart, 'daily', 7);
        assert(ret7d.startsWith('2026-09-17'), `Daily 7 days calculation gives 2026-09-17 (Actual: ${ret7d})`);

        // 2c: Weekly - 1 week, 2 weeks
        let ret1w = rentalHelper.calculateExpectedReturn(baseStart, 'weekly', 1);
        assert(ret1w.startsWith('2026-09-17'), `Weekly 1 week gives 2026-09-17 (Actual: ${ret1w})`);
        let ret2w = rentalHelper.calculateExpectedReturn(baseStart, 'weekly', 2);
        assert(ret2w.startsWith('2026-09-24'), `Weekly 2 weeks gives 2026-09-24 (Actual: ${ret2w})`);

        // 2d: Monthly - 1 month, 2 months
        let ret1m = rentalHelper.calculateExpectedReturn(baseStart, 'monthly', 1);
        assert(ret1m.startsWith('2026-10-10'), `Monthly 1 month gives 2026-10-10 (Actual: ${ret1m})`);
        let ret2m = rentalHelper.calculateExpectedReturn(baseStart, 'monthly', 2);
        assert(ret2m.startsWith('2026-11-10'), `Monthly 2 months gives 2026-11-10 (Actual: ${ret2m})`);

        // Test via AJAX endpoint
        res = await request(`/ajax_rental.php?action=calculate_expected_return&check_in=${encodeURIComponent(baseStartStr)}&period_type=daily&duration=3`);
        assert(res.statusCode === 200, 'AJAX calculate_expected_return returns 200');
        let ajaxRetJson = JSON.parse(res.body);
        assert(ajaxRetJson.success === true && ajaxRetJson.expected_checkout.startsWith('2026-09-13'), 'AJAX 3 days calculation returned 2026-09-13');

        res = await request(`/ajax_rental.php?action=calculate_expected_return&check_in=${encodeURIComponent(baseStartStr)}&period_type=hourly&duration=5`);
        ajaxRetJson = JSON.parse(res.body);
        assert(ajaxRetJson.success === true && ajaxRetJson.expected_checkout.includes('15:00'), 'AJAX 5 hours calculation returned 15:00');

        // STEP 3: SETTLEMENT LOGIC TESTS
        console.log('\n--- TEST GROUP 3: Return Settlement Logic Unit Calculations ---');

        // 3a: On-time return (3 days rented @ ₹150/day, ₹500 deposit, ₹450 advance)
        let sOnTime = rentalHelper.calculateRentalSettlement({
            checkIn: new Date('2026-09-10T10:00:00'),
            expectedReturn: new Date('2026-09-13T10:00:00'),
            actualReturn: new Date('2026-09-13T10:00:00'),
            periodType: 'daily',
            rentalRate: 150.00,
            estimatedDuration: 3,
            advancePaid: 450.00,
            securityDeposit: 500.00,
            additionalCharges: 0,
            depositDeductions: 0
        });
        assert(sOnTime.isOverdue === false, 'On-time return is not overdue');
        assert(sOnTime.overdueAmount === 0, 'On-time return overdue amount is 0');
        assert(sOnTime.originalRentalAmount === 450.00, 'Original rental amount is ₹450');
        assert(sOnTime.totalRentalAmount === 450.00, 'Total rental amount is ₹450');
        assert(sOnTime.depositReturnAmount === 500.00, 'Full deposit ₹500 returned');
        assert(Boolean(sOnTime.depositReturned), 'depositReturned flag is true');
        assert(sOnTime.remainingAmountDue === 0, 'Remaining balance due is 0');

        // 3b: Early return (Rented for 3 days @ ₹150/day, returned in 1 day 2 hours = 2 billable days = ₹300 total)
        let sEarly = rentalHelper.calculateRentalSettlement({
            checkIn: new Date('2026-09-10T10:00:00'),
            expectedReturn: new Date('2026-09-13T10:00:00'),
            actualReturn: new Date('2026-09-11T12:00:00'),
            periodType: 'daily',
            rentalRate: 150.00,
            estimatedDuration: 3,
            advancePaid: 450.00,
            securityDeposit: 500.00,
            additionalCharges: 0,
            depositDeductions: 0
        });
        assert(sEarly.isOverdue === false, 'Early return is not overdue');
        assert(sEarly.actualDurationText.includes('1 Day') && sEarly.actualDurationText.includes('2 Hour'), 'Early actual duration formatted as "1 Day 2 Hours"');
        assert(sEarly.depositReturnAmount === 500.00, 'Full deposit ₹500 returned on early return');

        // 3c: Late / Overdue return (Rented 1 day @ ₹150/day, returned 2 days late = 2 days overdue @ ₹150/day = ₹300 overdue fee)
        let sLate = rentalHelper.calculateRentalSettlement({
            checkIn: new Date('2026-09-10T10:00:00'),
            expectedReturn: new Date('2026-09-11T10:00:00'),
            actualReturn: new Date('2026-09-13T10:00:00'),
            periodType: 'daily',
            rentalRate: 150.00,
            estimatedDuration: 1,
            advancePaid: 150.00,
            securityDeposit: 500.00,
            additionalCharges: 0,
            depositDeductions: 0
        });
        assert(sLate.isOverdue === true, 'Late return marked as overdue');
        assert(sLate.overdueAmount === 300.00, 'Overdue amount is 2 days * ₹150 = ₹300');
        assert(sLate.totalRentalAmount === 450.00, 'Total rental amount is ₹150 base + ₹300 overdue = ₹450');
        assert(sLate.depositUsed === 300.00, 'Deposit used toward overdue fee is ₹300');
        assert(sLate.depositReturnAmount === 200.00, 'Remaining deposit refunded: ₹200 (500 - 300)');

        // 3d: Deposit used with damage deductions + overdue
        let sDamage = rentalHelper.calculateRentalSettlement({
            checkIn: new Date('2026-09-10T10:00:00'),
            expectedReturn: new Date('2026-09-11T10:00:00'),
            actualReturn: new Date('2026-09-11T10:00:00'),
            periodType: 'daily',
            rentalRate: 150.00,
            estimatedDuration: 1,
            advancePaid: 150.00,
            securityDeposit: 500.00,
            additionalCharges: 50.00,
            depositDeductions: 200.00 // Broken chuck
        });
        assert(sDamage.depositDeductions === 200.00, 'Deposit deduction is ₹200');
        assert(sDamage.depositReturnAmount === 250.00, 'Remaining deposit returned: ₹250 (500 - 200 damage - 50 extra charges)');

        // 3e: Deposit less than amount due (Huge overdue / damage exceeding deposit)
        let sExceeding = rentalHelper.calculateRentalSettlement({
            checkIn: new Date('2026-09-10T10:00:00'),
            expectedReturn: new Date('2026-09-11T10:00:00'),
            actualReturn: new Date('2026-09-20T10:00:00'), // 9 days late = ₹1350 overdue
            periodType: 'daily',
            rentalRate: 150.00,
            estimatedDuration: 1,
            advancePaid: 150.00,
            securityDeposit: 500.00,
            additionalCharges: 100.00,
            depositDeductions: 300.00
        });
        assert(sExceeding.depositReturnAmount === 0, 'No deposit returned when charges exceed deposit');
        assert(!sExceeding.depositReturned, 'depositReturned is false');
        assert(sExceeding.depositUsed === 200.00, 'Deposit net used toward charges is ₹200 (500 - 300 deduction)');
        assert(sExceeding.remainingAmountDue > 0, `Remaining amount due from customer calculated: ₹${sExceeding.remainingAmountDue}`);

        // STEP 4: END-TO-END RENTAL CREATION & RETURN WORKFLOWS
        console.log('\n--- TEST GROUP 4: End-to-End Rental Workflows ---');

        // Check initial product stock
        const [p1Rows] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 1');
        const initialStock = parseInt(p1Rows[0].stock_quantity, 10);

        // Scenario A: Create Rental with Optional Checkout Datetime Left Blank (Auto-calculated on backend)
        console.log('\nScenario A: Rental creation with blank checkout datetime (auto-calculated from duration)');
        res = await request('/create_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                customer_id: '1',
                product_id: '1',
                rental_period_type: 'daily',
                rental_rate: '150.00',
                estimated_duration: '3',
                security_deposit: '500.00',
                check_in_datetime: '2026-09-10T10:00',
                expected_checkout_datetime: '', // Blank - controller must auto-calculate
                advance_rental_amount: '450.00',
                payment_method: 'Cash',
                notes: 'Auto-calculated checkout test'
            }).toString()
        });

        assert(res.statusCode === 302, 'Scenario A creation succeeded with 302 redirect');
        const rentalIdMatchA = res.headers.location?.match(/id=(\d+)/);
        const rentalIdA = rentalIdMatchA ? parseInt(rentalIdMatchA[1], 10) : 0;
        assert(rentalIdA > 0, `Created Rental ID: ${rentalIdA}`);

        const [rRowsA] = await pool.query('SELECT * FROM rentals WHERE id = ?', [rentalIdA]);
        const rentalA = rRowsA[0];
        assert(Boolean(rentalA.expected_checkout_datetime), 'Expected checkout datetime auto-populated in DB');
        const expDateStr = rentalA.expected_checkout_datetime instanceof Date ? rentalA.expected_checkout_datetime.toISOString() : String(rentalA.expected_checkout_datetime);
        assert(expDateStr.includes('2026-09-13'), `Expected checkout is +3 days (Actual: ${expDateStr})`);
        assert(parseFloat(rentalA.estimated_duration) === 3.00, 'Estimated duration saved as 3.00');

        // Return Scenario A on time with deposit returned
        res = await request('/return_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                id: String(rentalIdA),
                actual_return_datetime: '2026-09-13T10:00',
                additional_charges: '0.00',
                deposit_deduction_amount: '0.00',
                notes: 'Returned on time'
            }).toString()
        });
        assert(res.statusCode === 302, 'Return of Scenario A succeeded');

        const [returnedA] = await pool.query('SELECT * FROM rentals WHERE id = ?', [rentalIdA]);
        assert(returnedA[0].rental_status === 'Returned', 'Status updated to Returned');
        assert(returnedA[0].deposit_returned === 1, 'deposit_returned flag set to 1 in DB');
        assert(parseFloat(returnedA[0].deposit_return_amount) === 500.00, 'deposit_return_amount recorded as ₹500.00');
        assert(parseFloat(returnedA[0].total_rental_amount) === 450.00, 'total_rental_amount recorded as ₹450.00');

        // Scenario B: Late Return with Overdue Charges and Deposit Applied
        console.log('\nScenario B: Rental creation with late return & overdue calculation');
        res = await request('/create_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                customer_id: '1',
                product_id: '1',
                rental_period_type: 'daily',
                rental_rate: '150.00',
                estimated_duration: '1',
                security_deposit: '500.00',
                check_in_datetime: '2026-09-10T10:00',
                expected_checkout_datetime: '2026-09-11T10:00',
                advance_rental_amount: '150.00',
                payment_method: 'UPI',
                notes: 'Late return test'
            }).toString()
        });

        const rentalIdMatchB = res.headers.location?.match(/id=(\d+)/);
        const rentalIdB = rentalIdMatchB ? parseInt(rentalIdMatchB[1], 10) : 0;
        assert(rentalIdB > 0, `Created Rental B ID: ${rentalIdB}`);

        // Return 2 days late (actual: 2026-09-13T10:00) with damage deduction ₹100
        res = await request('/return_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                id: String(rentalIdB),
                actual_return_datetime: '2026-09-13T10:00',
                additional_charges: '0.00',
                deposit_deduction_amount: '100.00',
                deposit_deduction_reason: 'Worn tool bit replacement',
                notes: 'Returned 2 days late with minor wear'
            }).toString()
        });
        assert(res.statusCode === 302, 'Return of Scenario B succeeded');

        const [returnedB] = await pool.query('SELECT * FROM rentals WHERE id = ?', [rentalIdB]);
        assert(returnedB[0].rental_status === 'Returned', 'Rental B status is Returned');
        assert(parseFloat(returnedB[0].overdue_amount) === 300.00, 'Overdue amount calculated as ₹300.00 (2 days overdue)');
        assert(parseFloat(returnedB[0].total_rental_amount) === 450.00, 'Total rental amount calculated as ₹450.00');
        assert(parseFloat(returnedB[0].deposit_deduction_amount) === 100.00, 'Deposit deduction recorded as ₹100.00');
        assert(returnedB[0].deposit_deduction_reason === 'Worn tool bit replacement', 'Deduction reason saved');
        // Total deposit = 500. Deduction = 100. Overdue = 300. Refund = 100.
        assert(parseFloat(returnedB[0].deposit_return_amount) === 100.00, 'Deposit refund amount recorded as ₹100.00 (500 - 100 - 300)');

        // Scenario C: Deposit Less than Amount Due (Customer Ledger Debt Created)
        console.log('\nScenario C: Deposit less than amount due (Remaining debt billed to customer)');
        res = await request('/create_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                customer_id: '1',
                product_id: '1',
                rental_period_type: 'daily',
                rental_rate: '150.00',
                estimated_duration: '1',
                security_deposit: '200.00',
                check_in_datetime: '2026-09-10T10:00',
                expected_checkout_datetime: '2026-09-11T10:00',
                advance_rental_amount: '150.00',
                payment_method: 'Cash',
                notes: 'Under-deposited rental test'
            }).toString()
        });

        const rentalIdMatchC = res.headers.location?.match(/id=(\d+)/);
        const rentalIdC = rentalIdMatchC ? parseInt(rentalIdMatchC[1], 10) : 0;
        assert(rentalIdC > 0, `Created Rental C ID: ${rentalIdC}`);

        // Return 5 days late (overdue = 5 * 150 = 750, deposit = 200, advance = 150). Remaining due = 750 - 200 = 550.
        res = await request('/return_rental.php', {
            method: 'POST',
            body: new URLSearchParams({
                id: String(rentalIdC),
                actual_return_datetime: '2026-09-16T10:00',
                additional_charges: '0.00',
                deposit_deduction_amount: '0.00',
                notes: 'Very late return'
            }).toString()
        });
        assert(res.statusCode === 302, 'Return of Scenario C succeeded');

        const [returnedC] = await pool.query('SELECT * FROM rentals WHERE id = ?', [rentalIdC]);
        assert(parseFloat(returnedC[0].overdue_amount) === 750.00, 'Overdue amount is ₹750.00');
        assert(parseFloat(returnedC[0].deposit_return_amount) === 0.00, 'Zero deposit refunded');
        assert(returnedC[0].deposit_returned === 0, 'deposit_returned is 0');
        assert(parseFloat(returnedC[0].remaining_amount) === 550.00, 'Remaining balance due calculated as ₹550.00');

        // Verify Customer Transactions for Rental C
        const [txRowsC] = await pool.query('SELECT * FROM customer_transactions WHERE reference_number = ?', [returnedC[0].rental_no]);
        assert(txRowsC.length === 1, `Customer ledger transaction updated for return settlement (Count: ${txRowsC.length})`);
        const returnTx = txRowsC[0];
        assert(Boolean(returnTx), 'Return settlement ledger transaction exists');
        if (returnTx) {
            console.log('   returnTx debug:', { total: returnTx.total_amount, paid: returnTx.paid_amount, debit: returnTx.debit_amount, status: returnTx.payment_status });
            assert(parseFloat(returnTx.debit_amount) === 550.00, 'Ledger debit reflects remaining unpaid balance of ₹550.00');
            assert(parseFloat(returnTx.paid_amount) === 350.00, `Ledger paid reflects advance + deposit used of ₹350.00 (Actual: ${returnTx.paid_amount})`);
            assert(returnTx.payment_status === 'Partial', 'Ledger payment status is Partial');
        }

        // STEP 5: STOCK QUANTITY RESTORATION VERIFICATION
        console.log('\n--- TEST GROUP 5: Stock Quantity Restoration Verification ---');
        const [finalProd] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 1');
        const finalStock = parseInt(finalProd[0].stock_quantity, 10);
        assert(finalStock === initialStock, `All checked-out items returned: Stock accurately restored to ${finalStock}`);

        // STEP 6: NON-REGRESSION OF EXISTING MODULES
        console.log('\n--- TEST GROUP 6: Non-Regression of Existing Features ---');
        res = await request('/manage_product.php');
        assert(res.statusCode === 200, 'GET /manage_product.php is functional (200)');
        assert(res.body.includes('Product Master'), 'Product Master page renders correctly');

        res = await request('/manage_customer.php');
        assert(res.statusCode === 200, 'GET /manage_customer.php is functional (200)');
        assert(res.body.includes('Customer Master'), 'Customer Master page renders correctly');

        res = await request('/manage_sales_note.php');
        assert(res.statusCode === 200, 'GET /manage_sales_note.php is functional (200)');
        assert(res.body.includes('Sales Notes'), 'Sales Notes page renders correctly');

        res = await request('/view_customer.php?id=1');
        assert(res.statusCode === 200, 'GET /view_customer.php is functional (200)');
        assert(res.body.includes('Customer Details') || res.body.includes('Ayyappan N'), 'Customer Details & Ledger render correctly');

        console.log('\n================================================================');
        console.log(`  FINAL RESULTS: ${passedTests} PASSED, ${failedTests} FAILED     `);
        console.log('================================================================\n');

    } catch (err) {
        console.error('Test suite uncaught error:', err);
        failedTests++;
    } finally {
        server.close();
        process.exit(failedTests > 0 ? 1 : 0);
    }
}

runRentalTests();
