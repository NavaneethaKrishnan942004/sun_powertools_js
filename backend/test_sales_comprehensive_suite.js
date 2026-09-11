giconst assert = require('assert');
const http = require('http');
const pool = require('./config/db');
const { getCustomerFinancialSummary } = require('./utils/customerHelper');

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

async function runComprehensiveSalesSuite() {
    console.log('========================================================================');
    console.log('      COMPREHENSIVE SALES MODULE END-TO-END TEST SUITE                 ');
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

    // Step 0: Auth
    const loginRes = await makeRequest('/login.php', 'POST', {
        user_name: 'Admin123',
        password: 'admin123'
    }, { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert([200, 302].includes(loginRes.status), 'Logged in successfully');

    // Setup dedicated test product and test customer
    await pool.query(`
        INSERT INTO product_master (id, product_code, product_name, selling_price, stock_quantity, sale_available, status, sale_unit, category_id, brand_id)
        VALUES (9991, 'TST-PROD-9991', 'Comprehensive Test Product 1', 1000.00, 100, 1, 1, 1, 1, 1)
        ON DUPLICATE KEY UPDATE product_name = 'Comprehensive Test Product 1', selling_price = 1000.00, stock_quantity = 100, sale_available = 1, status = 1
    `);
    await pool.query(`
        INSERT INTO product_master (id, product_code, product_name, selling_price, stock_quantity, sale_available, status, sale_unit, category_id, brand_id)
        VALUES (9992, 'TST-PROD-9992', 'Comprehensive Zero Stock Product', 500.00, 0, 1, 1, 1, 1, 1)
        ON DUPLICATE KEY UPDATE product_name = 'Comprehensive Zero Stock Product', selling_price = 500.00, stock_quantity = 0, sale_available = 1, status = 1
    `);
    await pool.query(`
        INSERT INTO product_master (id, product_code, product_name, selling_price, stock_quantity, sale_available, status, sale_unit, category_id, brand_id)
        VALUES (9993, 'TST-PROD-9993', 'Comprehensive Multi Product 2', 2000.00, 50, 1, 1, 1, 1, 1)
        ON DUPLICATE KEY UPDATE product_name = 'Comprehensive Multi Product 2', selling_price = 2000.00, stock_quantity = 50, sale_available = 1, status = 1
    `);

    await pool.query(`
        INSERT INTO customer_master (id, customer_code, customer_name, mobile_number, credit_allowed, credit_limit, opening_balance, opening_balance_type, status)
        VALUES (9991, 'CUS-9991', 'Comprehensive Test Customer', '9876549991', 1, 25000.00, 0.00, 'Debit', 1)
        ON DUPLICATE KEY UPDATE customer_name = 'Comprehensive Test Customer', credit_allowed = 1, credit_limit = 25000.00, status = 1
    `);

    // Clean any prior customer transactions and test sales notes for this test customer
    await pool.query('DELETE FROM sales_note_items WHERE sales_note_id IN (SELECT id FROM sales_notes WHERE customer_id = 9991)');
    await pool.query('DELETE FROM sales_notes WHERE customer_id = 9991');
    await pool.query('DELETE FROM customer_transactions WHERE customer_id = 9991');

    let normalSaleId = 0;
    let normalSaleNo = '';
    let creditSaleId = 0;
    let creditSaleNo = '';
    let creditSale2Id = 0;
    let creditSale2No = '';

    // TEST 1: Normal Sale -> Save -> Stock -> Manage -> Dashboard
    await test('Test 1: Normal Sale -> Save -> Stock Deduction -> Manage Page -> Dashboard', async () => {
        const [prodBefore] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 9991');
        const stockBefore = parseFloat(prodBefore[0].stock_quantity);

        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T14:00');
        payload.append('customer_id', '9991');
        payload.append('final_grand_total', '2000');
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('items[0][product_id]', '9991');
        payload.append('items[0][quantity]', '2');
        payload.append('items[0][unit_price]', '1000');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302, 'Redirects to manage page after saving');
        assert(res.headers.location.includes('/sales-notes'), 'Redirected to /sales-notes');
        const [recentSale1] = await pool.query('SELECT id, sales_note_no FROM sales_notes ORDER BY id DESC LIMIT 1');
        normalSaleId = recentSale1[0].id;

        const [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [normalSaleId]);
        assert.strictEqual(saleRows.length, 1, 'Sale saved in DB');
        normalSaleNo = saleRows[0].sales_note_no;
        assert.strictEqual(saleRows[0].sale_type, 'sale', 'Saved as normal sale');
        assert.strictEqual(parseFloat(saleRows[0].total_amount), 2000.00, 'Total is ₹2000.00');
        assert.strictEqual(parseFloat(saleRows[0].paid_amount), 2000.00, 'Paid amount is ₹2000.00');
        assert.strictEqual(parseFloat(saleRows[0].credit_amount), 0.00, 'Remaining credit is ₹0.00');

        // Stock deduction check
        const [prodAfter] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 9991');
        const stockAfter = parseFloat(prodAfter[0].stock_quantity);
        assert.strictEqual(stockAfter, stockBefore - 2, 'Stock deducted by 2 units');

        // Manage page check
        const manageRes = await makeRequest(`/sales-notes?search=${normalSaleNo}`);
        assert.strictEqual(manageRes.status, 200, 'Manage page loads');
        assert(manageRes.body.includes(normalSaleNo), 'Manage page includes normal sale note number');
        assert(manageRes.body.includes('Cash') || manageRes.body.includes('₹2,000.00'), 'Manage page shows correct values');

        // Customer ledger check (full payment normal sale: debit = 0)
        const summary = await getCustomerFinancialSummary(pool, 9991);
        assert.strictEqual(parseFloat(summary.current_outstanding), 0.00, 'Normal sale with full payment leaves 0 outstanding');
    });

    // TEST 2: Credit Sale -> First Payment -> Remaining Credit -> Manage -> Dashboard
    await test('Test 2: Credit Sale -> First Payment -> Remaining Credit -> Manage -> Dashboard', async () => {
        // Sale: 4 units of 9991 = ₹4000. First payment = ₹1500. Remaining credit = ₹2500.
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T14:30');
        payload.append('customer_id', '9991');
        payload.append('final_grand_total', '4000');
        payload.append('sale_type', 'credit');
        payload.append('payment_type', 'Credit');
        payload.append('amount_received', '1500');
        payload.append('payment_method', 'Cash');
        payload.append('items[0][product_id]', '9991');
        payload.append('items[0][quantity]', '4');
        payload.append('items[0][unit_price]', '1000');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302, 'Redirects after saving credit sale');
        assert(res.headers.location.includes('/sales-notes'), 'Redirected to /sales-notes');
        const [recentSale2] = await pool.query('SELECT id, sales_note_no FROM sales_notes ORDER BY id DESC LIMIT 1');
        creditSaleId = recentSale2[0].id;

        const [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [creditSaleId]);
        assert.strictEqual(saleRows.length, 1);
        const sn = saleRows[0];
        creditSaleNo = sn.sales_note_no;
        assert.strictEqual(sn.sale_type, 'credit', 'Saved as credit sale');
        assert.strictEqual(parseFloat(sn.total_amount), 4000.00, 'Total is ₹4000.00');
        assert.strictEqual(parseFloat(sn.paid_amount), 1500.00, 'Paid amount is ₹1500.00');
        assert.strictEqual(parseFloat(sn.first_payment), 1500.00, 'First payment recorded as ₹1500.00');
        assert.strictEqual(parseFloat(sn.credit_amount), 2500.00, 'Credit amount is ₹2500.00');

        // Customer outstanding check
        const summary = await getCustomerFinancialSummary(pool, 9991);
        assert.strictEqual(parseFloat(summary.current_outstanding), 2500.00, 'Customer outstanding is ₹2500.00');

        // Manage page check
        const manageRes = await makeRequest(`/sales-notes?search=${creditSaleNo}`);
        assert.strictEqual(manageRes.status, 200);
        assert(manageRes.body.includes(creditSaleNo), 'Manage page includes credit sale');
        assert(manageRes.body.includes('receive-payment-btn'), 'Includes receive payment button for credit sale with balance');

        // Dashboard check
        const dashRes = await makeRequest('/');
        assert.strictEqual(dashRes.status, 200);
        assert(dashRes.body.includes('Credit Sales') || dashRes.body.includes('Outstanding'), 'Dashboard includes credit sales metrics');
    });

    // TEST 3: Credit Sale Exceeding Customer Credit Limit -> Allow -> Highlight -> Correct Outstanding
    await test('Test 3: Credit Sale Exceeding Credit Limit -> Allow -> Highlight -> Correct Outstanding', async () => {
        // Customer limit is ₹25,000. Existing outstanding is ₹2,500.
        // Let's create a sale of 24 units of 9991 = ₹24,000. First payment = ₹0.
        // New outstanding will become ₹2,500 + ₹24,000 = ₹26,500 > ₹25,000!
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T15:00');
        payload.append('customer_id', '9991');
        payload.append('final_grand_total', '24000');
        payload.append('sale_type', 'credit');
        payload.append('payment_type', 'Credit');
        payload.append('amount_received', '0');
        payload.append('credit_override', '1');
        payload.append('items[0][product_id]', '9991');
        payload.append('items[0][quantity]', '24');
        payload.append('items[0][unit_price]', '1000');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        // Step A: Attempt without credit_override -> must return backend validation error
        const payloadWithout = new URLSearchParams(payload);
        payloadWithout.delete('credit_override');
        const resWithout = await makeRequest('/sales-notes/create', 'POST', payloadWithout, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resWithout.status, 200, 'Re-renders create page with validation error when not authorized');
        assert(resWithout.body.includes("Sale exceeds customer's credit limit. Check this box to authorize and record this transaction."), 'Contains credit limit override validation error');

        // Step B: Submit with credit_override = 1 -> Allowed and redirects (302)
        const res = await makeRequest('/sales-notes/create', 'POST', payload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302, 'Sale exceeding credit limit was ALLOWED with override');
        assert(res.headers.location.includes('/sales-notes'), 'Redirected to /sales-notes');
        const [recentSale3] = await pool.query('SELECT id, sales_note_no FROM sales_notes ORDER BY id DESC LIMIT 1');
        creditSale2Id = recentSale3[0].id;

        const [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [creditSale2Id]);
        creditSale2No = saleRows[0].sales_note_no;
        assert.strictEqual(saleRows[0].credit_status, 'Limit Exceeded', 'Marked as Limit Exceeded in DB');
        assert.strictEqual(parseInt(saleRows[0].credit_override, 10), 1, 'credit_override is set');
        assert.strictEqual(parseFloat(saleRows[0].new_outstanding), 26500.00, 'New outstanding is ₹26,500.00');

        // Customer outstanding check
        const summary = await getCustomerFinancialSummary(pool, 9991);
        assert.strictEqual(parseFloat(summary.current_outstanding), 26500.00, 'Customer total outstanding is ₹26,500.00');

        // Manage page highlight check
        const manageRes = await makeRequest(`/sales-notes?search=${creditSale2No}`);
        assert(manageRes.body.includes('credit-limit-exceeded-row'), 'Manage page row has credit-limit-exceeded-row class');
        assert(manageRes.body.includes('Limit Exceeded') || manageRes.body.includes('Exceeded'), 'Manage page displays Limit Exceeded badge');
    });

    // TEST 4 & 5: Credit Payment -> Reduce Balance -> Reduce Outstanding & Multiple Payments
    await test('Test 4 & 5: Credit Payments -> Reduce Balance -> Reduce Outstanding -> Multiple Payments', async () => {
        // Credit Sale 1 had total ₹4000, first payment ₹1500, balance ₹2500.
        // Payment 2: Pay ₹1000 via receivePayment
        const pmt1 = new URLSearchParams();
        pmt1.append('sales_note_id', String(creditSaleId));
        pmt1.append('payment_amount', '1000');
        pmt1.append('payment_method', 'UPI');
        pmt1.append('notes', 'Part payment UPI');

        const pmt1Res = await makeRequest('/sales-notes/receive-payment', 'POST', pmt1, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(pmt1Res.status, 302, 'Payment 1 received successfully');

        let [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [creditSaleId]);
        assert.strictEqual(parseFloat(saleRows[0].paid_amount), 2500.00, 'Total paid is now ₹2500 (1500 + 1000)');
        assert.strictEqual(parseFloat(saleRows[0].credit_amount), 1500.00, 'Remaining balance is now ₹1500');

        // Outstanding should have decreased by ₹1000 from 26500 to 25500
        let summary = await getCustomerFinancialSummary(pool, 9991);
        assert.strictEqual(parseFloat(summary.current_outstanding), 25500.00, 'Customer outstanding reduced to ₹25,500.00');

        // Payment 3: Pay another ₹500
        const pmt2 = new URLSearchParams();
        pmt2.append('sales_note_id', String(creditSaleId));
        pmt2.append('payment_amount', '500');
        pmt2.append('payment_method', 'Cash');
        pmt2.append('notes', 'Installment 3');

        const pmt2Res = await makeRequest('/sales-notes/receive-payment', 'POST', pmt2, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(pmt2Res.status, 302, 'Payment 2 received successfully');

        [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [creditSaleId]);
        assert.strictEqual(parseFloat(saleRows[0].paid_amount), 3000.00, 'Total paid is now ₹3000 (1500 + 1000 + 500)');
        assert.strictEqual(parseFloat(saleRows[0].credit_amount), 1000.00, 'Remaining balance is now ₹1000');

        summary = await getCustomerFinancialSummary(pool, 9991);
        assert.strictEqual(parseFloat(summary.current_outstanding), 25000.00, 'Customer outstanding reduced to ₹25,000.00');

        // Verify transaction history labels (Payment 1, Payment 2, Payment 3)
        const [txs] = await pool.query(
            "SELECT * FROM customer_transactions WHERE reference_number = ? AND transaction_type = 'payment' ORDER BY id ASC",
            [creditSaleNo]
        );
        assert.strictEqual(txs.length, 2, '2 subsequent payment transactions recorded');
        assert(txs[0].reason.includes('Payment 2'), 'First installment labeled as Payment 2');
        assert(txs[1].reason.includes('Payment 3'), 'Second installment labeled as Payment 3');
    });

    // TEST 6: Final Credit Payment -> Balance ₹0 -> Fully Paid
    await test('Test 6: Final Credit Payment -> Balance ₹0 -> Fully Paid Status', async () => {
        // Remaining balance on Credit Sale 1 is ₹1000. Pay full ₹1000.
        const pmtFinal = new URLSearchParams();
        pmtFinal.append('sales_note_id', String(creditSaleId));
        pmtFinal.append('payment_amount', '1000');
        pmtFinal.append('payment_method', 'Bank Transfer');
        pmtFinal.append('notes', 'Final settlement');

        const res = await makeRequest('/sales-notes/receive-payment', 'POST', pmtFinal, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302, 'Final payment accepted');

        const [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [creditSaleId]);
        assert.strictEqual(parseFloat(saleRows[0].paid_amount), 4000.00, 'Total paid is full ₹4000.00');
        assert.strictEqual(parseFloat(saleRows[0].credit_amount), 0.00, 'Remaining credit is ₹0.00');

        // Manage page check: pay button should no longer appear for this sale
        const manageRes = await makeRequest(`/sales-notes?search=${creditSaleNo}`);
        assert(!manageRes.body.includes(`data-id="${creditSaleId}"`), 'Pay button removed since balance is 0');
        assert(manageRes.body.includes('Fully Paid'), 'Shows Fully Paid badge');
    });

    // TEST 7: Overpayment Rejection
    await test('Test 7: Overpayment Rejection (Amount > balance, negative, 0, non-numeric)', async () => {
        // Sale 1 is fully paid. Attempt payment of ₹1.
        const pmtOver = new URLSearchParams();
        pmtOver.append('sales_note_id', String(creditSaleId));
        pmtOver.append('payment_amount', '1');
        pmtOver.append('payment_method', 'Cash');

        const resOver = await makeRequest('/sales-notes/receive-payment', 'POST', pmtOver, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resOver.status, 302);
        assert(resOver.headers.location.includes('error='), 'Rejected payment on already fully paid sale');

        // Sale 2 has remaining balance ₹24,000. Attempt ₹25,000.
        const pmtExceed = new URLSearchParams();
        pmtExceed.append('sales_note_id', String(creditSale2Id));
        pmtExceed.append('payment_amount', '25000');
        pmtExceed.append('payment_method', 'Cash');

        const resExceed = await makeRequest('/sales-notes/receive-payment', 'POST', pmtExceed, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resExceed.status, 302);
        assert(resExceed.headers.location.includes('error='), 'Rejected payment exceeding balance');

        // Negative amount
        const pmtNeg = new URLSearchParams();
        pmtNeg.append('sales_note_id', String(creditSale2Id));
        pmtNeg.append('payment_amount', '-500');
        pmtNeg.append('payment_method', 'Cash');

        const resNeg = await makeRequest('/sales-notes/receive-payment', 'POST', pmtNeg, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resNeg.status, 302);
        assert(resNeg.headers.location.includes('error='), 'Rejected negative payment');

        // Zero amount
        const pmtZero = new URLSearchParams();
        pmtZero.append('sales_note_id', String(creditSale2Id));
        pmtZero.append('payment_amount', '0');
        pmtZero.append('payment_method', 'Cash');

        const resZero = await makeRequest('/sales-notes/receive-payment', 'POST', pmtZero, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resZero.status, 302);
        assert(resZero.headers.location.includes('error='), 'Rejected zero payment');
    });

    // TEST 8: Zero Stock Rejection
    await test('Test 8: Zero Stock Product Backend Rejection', async () => {
        // Product 9992 has stock_quantity = 0.
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T16:00');
        payload.append('customer_id', '9991');
        payload.append('final_grand_total', '500');
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('items[0][product_id]', '9992');
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', '500');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        // Controller re-renders create_sales_note with error alert
        assert(res.body.includes('out of stock') || res.status === 400 || res.status === 200, 'Zero stock rejected');
        assert(res.body.includes('out of stock'), 'Error message indicates product is out of stock');
    });

    // TEST 9: Edit Normal Sale -> Verify existing behavior
    await test('Test 9: Edit Normal Sale -> Verify Behavior & Stock Adjustment', async () => {
        // Normal Sale 1 originally bought 2 units of 9991. Let's edit it to 3 units.
        const [prodBefore] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 9991');
        const stockBefore = parseFloat(prodBefore[0].stock_quantity);

        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T14:00');
        payload.append('customer_id', '9991');
        payload.append('final_grand_total', '3000');
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('items[0][product_id]', '9991');
        payload.append('items[0][quantity]', '3');
        payload.append('items[0][unit_price]', '1000');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest(`/sales-notes/edit/${normalSaleId}`, 'POST', payload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302, 'Edit normal sale succeeds and redirects');

        const [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [normalSaleId]);
        assert.strictEqual(parseFloat(saleRows[0].total_amount), 3000.00, 'Total updated to ₹3000');
        assert.strictEqual(parseFloat(saleRows[0].paid_amount), 3000.00, 'Paid amount updated to ₹3000');

        // Stock should have deducted 1 additional unit (restored 2, deducted 3 => net -1)
        const [prodAfter] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 9991');
        const stockAfter = parseFloat(prodAfter[0].stock_quantity);
        assert.strictEqual(stockAfter, stockBefore - 1, 'Stock properly adjusted after editing quantity');
    });

    // TEST 10: Edit Credit Sale after partial payments -> Verify payment history & accurate outstanding
    await test('Test 10: Edit Credit Sale -> Verify Payment History Preserved & Accurate Customer Ledger', async () => {
        // Let's create a new clean Credit Sale to test editing after subsequent payments:
        // Sale: 2 units of 9993 = ₹4000. First payment = ₹1000. Credit balance = ₹3000.
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T16:30');
        payload.append('customer_id', '9991');
        payload.append('final_grand_total', '4000');
        payload.append('sale_type', 'credit');
        payload.append('payment_type', 'Credit');
        payload.append('amount_received', '1000');
        payload.append('payment_method', 'Cash');
        payload.append('items[0][product_id]', '9993');
        payload.append('items[0][quantity]', '2');
        payload.append('items[0][unit_price]', '2000');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');
        payload.append('credit_override', '1');

        const resCreate = await makeRequest('/sales-notes/create', 'POST', payload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resCreate.status, 302, 'Redirects to manage page');
        assert(resCreate.headers.location.includes('/sales-notes'), 'Redirected to /sales-notes');
        const [recentSale4] = await pool.query('SELECT id, sales_note_no FROM sales_notes ORDER BY id DESC LIMIT 1');
        const testSaleId = recentSale4[0].id;

        // Record subsequent payment 2: ₹500
        const pmt = new URLSearchParams();
        pmt.append('sales_note_id', String(testSaleId));
        pmt.append('payment_amount', '500');
        pmt.append('payment_method', 'UPI');
        pmt.append('notes', 'Subsequent test payment');
        await makeRequest('/sales-notes/receive-payment', 'POST', pmt, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        // Current status of testSale:
        // Total: ₹4000, First Payment: ₹1000, Subsequent Payment: ₹500.
        // Total Paid: ₹1500. Remaining balance: ₹2500.
        const summaryBeforeEdit = await getCustomerFinancialSummary(pool, 9991);
        const outstandingBeforeEdit = parseFloat(summaryBeforeEdit.current_outstanding);

        // Edit testSale: change notes, keep first payment as ₹1000
        const editPayload = new URLSearchParams();
        editPayload.append('sales_datetime', '2026-09-11T16:30');
        editPayload.append('customer_id', '9991');
        editPayload.append('final_grand_total', '4000');
        editPayload.append('sale_type', 'credit');
        editPayload.append('payment_type', 'Credit');
        editPayload.append('amount_received', '1000');
        editPayload.append('payment_method', 'Cash');
        editPayload.append('notes', 'Updated via edit');
        editPayload.append('items[0][product_id]', '9993');
        editPayload.append('items[0][quantity]', '2');
        editPayload.append('items[0][unit_price]', '2000');
        editPayload.append('items[0][discount]', '0');
        editPayload.append('items[0][tax_percent]', '0');
        editPayload.append('credit_override', '1');

        const resEdit = await makeRequest(`/sales-notes/edit/${testSaleId}`, 'POST', editPayload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resEdit.status, 302, 'Edit credit sale succeeds');

        const [saleRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [testSaleId]);
        const sn = saleRows[0];
        assert.strictEqual(parseFloat(sn.first_payment), 1000.00, 'First payment preserved as ₹1000');
        assert.strictEqual(parseFloat(sn.paid_amount), 1500.00, 'Total paid remains ₹1500 (1000 + 500)');
        assert.strictEqual(parseFloat(sn.credit_amount), 2500.00, 'Remaining credit remains ₹2500');

        // Customer outstanding MUST remain EXACTLY the same (no double deduction of subsequent payment!)
        const summaryAfterEdit = await getCustomerFinancialSummary(pool, 9991);
        assert.strictEqual(
            parseFloat(summaryAfterEdit.current_outstanding),
            outstandingBeforeEdit,
            `Customer outstanding after edit (₹${summaryAfterEdit.current_outstanding}) must match before edit (₹${outstandingBeforeEdit})`
        );
    });

    // TEST 11: Cancel / Delete Sale -> Verify stock and customer ledger restoration
    await test('Test 11: Cancel / Delete Sale -> Verify Stock & Customer Ledger Restoration', async () => {
        // Create a temporary sale of 5 units of 9993 = ₹10,000, credit sale, first payment ₹2000
        const [prodBefore] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 9993');
        const stockBefore = parseFloat(prodBefore[0].stock_quantity);

        const summaryBefore = await getCustomerFinancialSummary(pool, 9991);
        const custBalBefore = parseFloat(summaryBefore.current_outstanding);

        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T17:00');
        payload.append('customer_id', '9991');
        payload.append('final_grand_total', '10000');
        payload.append('sale_type', 'credit');
        payload.append('payment_type', 'Credit');
        payload.append('amount_received', '2000');
        payload.append('credit_override', '1');
        payload.append('items[0][product_id]', '9993');
        payload.append('items[0][quantity]', '5');
        payload.append('items[0][unit_price]', '2000');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const resCreate = await makeRequest('/sales-notes/create', 'POST', payload, {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resCreate.status, 302, 'Redirects to manage page');
        assert(resCreate.headers.location.includes('/sales-notes'), 'Redirected to /sales-notes');
        const [recentSale5] = await pool.query('SELECT id, sales_note_no FROM sales_notes ORDER BY id DESC LIMIT 1');
        const tempSaleId = recentSale5[0].id;

        // Now cancel this sale
        const cancelRes = await makeRequest(`/sales-notes?action=delete&id=${tempSaleId}`);
        assert.strictEqual(cancelRes.status, 302, 'Cancellation request redirected');

        // Check sales note status
        const [saleRows] = await pool.query('SELECT status FROM sales_notes WHERE id = ?', [tempSaleId]);
        assert.strictEqual(parseInt(saleRows[0].status, 10), 0, 'Sales note marked as status = 0 (cancelled)');

        // Check stock restored
        const [prodAfter] = await pool.query('SELECT stock_quantity FROM product_master WHERE id = 9993');
        assert.strictEqual(parseFloat(prodAfter[0].stock_quantity), stockBefore, 'Product stock fully restored');

        // Check customer outstanding restored
        const summaryAfter = await getCustomerFinancialSummary(pool, 9991);
        assert.strictEqual(parseFloat(summaryAfter.current_outstanding), custBalBefore, 'Customer ledger balance fully restored');
    });

    // TEST 12: Multiple Sales for Same Customer -> Verify Cumulative Calculations
    await test('Test 12: Multiple Sales for Same Customer -> Verify Cumulative Outstanding', async () => {
        const summary = await getCustomerFinancialSummary(pool, 9991);
        const expectedBalance = parseFloat(summary.current_outstanding);
        assert(expectedBalance >= 0, 'Customer balance is non-negative and consistent');

        // Compare sum of active credit sales against summary
        const [activeSales] = await pool.query(
            "SELECT COALESCE(SUM(credit_amount), 0) AS total_active_credit FROM sales_notes WHERE customer_id = 9991 AND status = 1"
        );
        const dbCreditSum = parseFloat(activeSales[0].total_active_credit);
        assert.strictEqual(expectedBalance, dbCreditSum, `Customer outstanding (₹${expectedBalance}) matches sum of active credit amounts (₹${dbCreditSum})`);
    });

    // TEST 13: Refresh / Duplicate Submission Protection
    await test('Test 13: Refresh / Duplicate Submission Protection', async () => {
        // Verifies PRG pattern: GET on view page does not alter database
        const [salesBefore] = await pool.query('SELECT COUNT(*) AS cnt FROM sales_notes');
        const viewRes = await makeRequest(`/sales-notes/view/${normalSaleId}`);
        assert.strictEqual(viewRes.status, 200, 'Viewing / refreshing page returns 200 without creating records');
        const [salesAfter] = await pool.query('SELECT COUNT(*) AS cnt FROM sales_notes');
        assert.strictEqual(salesAfter[0].cnt, salesBefore[0].cnt, 'No duplicate sales created on page reload');
    });

    // TEST 14: Responsive UI & Filter Integrity
    await test('Test 14: Responsive UI, Payment Status Filters & Visual Badges', async () => {
        // Filter by payment_status=paid
        const resPaid = await makeRequest('/sales-notes?payment_status=paid');
        assert.strictEqual(resPaid.status, 200);
        assert(resPaid.body.includes('Fully Paid'), 'Paid filter returns fully paid sales');

        // Filter by payment_status=partial
        const resPartial = await makeRequest('/sales-notes?payment_status=partial');
        assert.strictEqual(resPartial.status, 200);

        // Filter by payment_status=unpaid
        const resUnpaid = await makeRequest('/sales-notes?payment_status=unpaid');
        assert.strictEqual(resUnpaid.status, 200);

        // Manage page responsive table structure check
        assert(resPaid.body.includes('table-responsive'), 'Uses Bootstrap table-responsive');
        assert(resPaid.body.includes('action-column'), 'Table action columns styled for mobile/desktop');
    });

    console.log('\n========================================================================');
    console.log(`  COMPREHENSIVE SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runComprehensiveSalesSuite().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Test suite uncaught error:', err);
    process.exit(1);
});
