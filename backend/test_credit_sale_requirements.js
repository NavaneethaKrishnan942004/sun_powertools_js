const assert = require('assert');
const http = require('http');
const pool = require('./config/db');
const { getPaymentStatusInfo, getSaleTypeInfo } = require('./utils/salesNoteHelper');

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

async function run11RequirementsVerification() {
    console.log('================================================================');
    console.log('  VERIFYING ALL 11 SPECIFIC REQUIREMENTS FOR CREDIT SALE       ');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    async function test(num, title, fn) {
        try {
            await fn();
            console.log(`  [PASS] Requirement ${num}: ${title}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] Requirement ${num}: ${title} -> ${err.message}`);
            failed++;
        }
    }

    // Step 0: Auth & setup
    const loginRes = await makeRequest('/login.php', 'POST', {
        user_name: 'Admin123',
        password: 'admin123'
    }, { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert([200, 302].includes(loginRes.status), 'Logged in successfully');

    await pool.query("UPDATE product_master SET stock_quantity = 50 WHERE id = 1 AND stock_quantity < 10");
    const [products] = await pool.query("SELECT * FROM product_master WHERE status = 1 AND sale_available = 1 AND stock_quantity >= 5 ORDER BY id ASC LIMIT 1");
    assert(products.length > 0, 'Test product available');
    const testProduct = products[0];
    const unitPrice = parseFloat(testProduct.selling_price);

    await pool.query("UPDATE customer_master SET credit_limit = 50000 WHERE id = 15");
    const [customers] = await pool.query("SELECT * FROM customer_master WHERE status = 1 AND credit_allowed = 1 AND credit_limit >= 1000 ORDER BY id ASC LIMIT 1");
    assert(customers.length > 0, 'Test customer available');
    const testCustomer = customers[0];

    let cashSaleId = 0;
    let zeroPayCreditSaleId = 0;
    let partialPayCreditSaleId = 0;
    let fullPayCreditSaleId = 0;

    // 1. Cash Sale -> existing behavior must remain unchanged
    await test(1, 'Cash Sale -> existing behavior must remain unchanged', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-10T12:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(unitPrice));
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('items[0][product_id]', String(testProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(unitPrice));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/create_sales_note.php', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert([302, 200].includes(res.status));

        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        cashSaleId = latest[0].id;
        assert.strictEqual(latest[0].sale_type, 'sale', 'Saved as regular sale');
        assert.strictEqual(parseFloat(latest[0].paid_amount), unitPrice, 'Paid in full');
        assert.strictEqual(parseFloat(latest[0].credit_amount), 0, 'Balance is 0');
    });

    // 2. Credit Sale with ₹0 payment -> Balance = full amount, Status = Unpaid
    await test(2, 'Credit Sale with ₹0 payment -> Balance = full amount, Status = Unpaid', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-10T12:15');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(unitPrice));
        payload.append('sale_type', 'credit');
        payload.append('amount_received', '0');
        payload.append('credit_override', '1');
        payload.append('items[0][product_id]', String(testProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(unitPrice));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/create_sales_note.php', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert([302, 200].includes(res.status));

        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        zeroPayCreditSaleId = latest[0].id;
        assert.strictEqual(latest[0].sale_type, 'credit', 'Saved as credit sale');
        assert.strictEqual(parseFloat(latest[0].paid_amount), 0, 'Paid is 0');
        assert.strictEqual(parseFloat(latest[0].credit_amount), unitPrice, 'Balance is full amount');

        const pStatus = getPaymentStatusInfo(latest[0].paid_amount, latest[0].total_amount);
        assert.strictEqual(pStatus.status, 'Unpaid', 'Status is Unpaid');
    });

    // 3. Credit Sale with partial payment -> Balance = Total - Paid, Status = Partially Paid
    const partialPaidAmt = Math.round(unitPrice * 0.4);
    const expectedBal = unitPrice - partialPaidAmt;
    await test(3, 'Credit Sale with partial payment -> Balance = Total − Paid, Status = Partially Paid', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-10T12:30');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(unitPrice));
        payload.append('sale_type', 'credit');
        payload.append('amount_received', String(partialPaidAmt));
        payload.append('payment_method', 'Cash');
        payload.append('credit_override', '1');
        payload.append('items[0][product_id]', String(testProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(unitPrice));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/create_sales_note.php', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert([302, 200].includes(res.status));

        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        partialPayCreditSaleId = latest[0].id;
        assert.strictEqual(latest[0].sale_type, 'credit', 'Sale remains recorded as Credit Sale');
        assert.strictEqual(parseFloat(latest[0].paid_amount), partialPaidAmt, 'Paid Now is recorded');
        assert.strictEqual(parseFloat(latest[0].credit_amount), expectedBal, 'Balance = Total - Paid');

        const pStatus = getPaymentStatusInfo(latest[0].paid_amount, latest[0].total_amount);
        assert.strictEqual(pStatus.status, 'Partially Paid', 'Status is Partially Paid');
        assert.strictEqual(pStatus.balance, expectedBal, 'Computed balance matches Total - Paid');
    });

    // 4. Credit Sale with full payment -> Balance = ₹0, Status = Fully Paid
    await test(4, 'Credit Sale with full payment -> Balance = ₹0, Status = Fully Paid', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-10T12:45');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(unitPrice));
        payload.append('sale_type', 'credit');
        payload.append('amount_received', String(unitPrice)); // Paid full at creation
        payload.append('payment_method', 'UPI');
        payload.append('credit_override', '1');
        payload.append('items[0][product_id]', String(testProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(unitPrice));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/create_sales_note.php', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert([302, 200].includes(res.status));

        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        fullPayCreditSaleId = latest[0].id;
        assert.strictEqual(latest[0].sale_type, 'sale', 'When Amount Received == Grand Total, saves as normal sale');
        assert.strictEqual(parseFloat(latest[0].paid_amount), unitPrice, 'Paid in full');
        assert.strictEqual(parseFloat(latest[0].credit_amount), 0, 'Balance is 0');

        const pStatus = getPaymentStatusInfo(latest[0].paid_amount, latest[0].total_amount);
        assert.strictEqual(pStatus.status, 'Fully Paid', 'Status is Fully Paid');
        assert.strictEqual(pStatus.balance, 0, 'Balance is 0');
    });

    // 5. Add another payment -> Balance must decrease correctly
    const secondPayment = Math.round(expectedBal * 0.5);
    await test(5, 'Add another payment -> Balance must decrease correctly', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_note_id', String(partialPayCreditSaleId));
        payload.append('payment_amount', String(secondPayment));
        payload.append('payment_method', 'UPI');
        payload.append('notes', 'Second partial installment');

        const res = await makeRequest('/sales-notes/receive-payment', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert([302, 200].includes(res.status));

        const [sale] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [partialPayCreditSaleId]);
        const expectedNewPaid = partialPaidAmt + secondPayment;
        const expectedNewBal = unitPrice - expectedNewPaid;

        assert.strictEqual(parseFloat(sale[0].paid_amount), expectedNewPaid, 'Paid amount incremented correctly');
        assert.strictEqual(parseFloat(sale[0].credit_amount), expectedNewBal, 'Balance decreased correctly');

        const pStatus = getPaymentStatusInfo(sale[0].paid_amount, sale[0].total_amount);
        assert.strictEqual(pStatus.status, 'Partially Paid', 'Status is still Partially Paid');
    });

    // 6. Payment greater than balance -> must be rejected
    await test(6, 'Payment greater than balance -> must be rejected', async () => {
        const [sale] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [partialPayCreditSaleId]);
        const currentBal = parseFloat(sale[0].credit_amount);
        const overPayment = currentBal + 500;

        const payload = new URLSearchParams();
        payload.append('sales_note_id', String(partialPayCreditSaleId));
        payload.append('payment_amount', String(overPayment));
        payload.append('payment_method', 'Cash');

        const res = await makeRequest('/sales-notes/receive-payment', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        // Redirects with error message
        assert([302, 200].includes(res.status));

        // Verify balance was untouched
        const [saleAfter] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [partialPayCreditSaleId]);
        assert.strictEqual(parseFloat(saleAfter[0].credit_amount), currentBal, 'Balance unchanged after rejected payment');
    });

    // 7. Credit Sale row -> Edit action must be available (New Requirement 5 & 18)
    await test(7, 'Credit Sale row -> Edit action must be available', async () => {
        const res = await makeRequest('/manage_sales_note.php');
        assert.strictEqual(res.status, 200);

        // Edit link for credit sale must BE present
        assert(res.body.includes(`/sales-notes/edit/${partialPayCreditSaleId}`), `Edit button for credit sale ID ${partialPayCreditSaleId} is shown`);
        assert(res.body.includes(`/sales-notes/edit/${zeroPayCreditSaleId}`), `Edit button for credit sale ID ${zeroPayCreditSaleId} is shown`);
        assert(res.body.includes(`/sales-notes/edit/${fullPayCreditSaleId}`), `Edit button for credit sale ID ${fullPayCreditSaleId} is shown`);
    });

    // 8. Credit Sale row -> appropriate payment/view actions must be shown
    await test(8, 'Credit Sale row -> appropriate payment/view actions must be shown', async () => {
        const res = await makeRequest('/manage_sales_note.php');
        assert.strictEqual(res.status, 200);

        // View link must be present
        assert(res.body.includes(`/sales-notes/view/${partialPayCreditSaleId}`), 'View action link is present');
        // Print link must be present
        assert(res.body.includes(`/sales-notes/view/${partialPayCreditSaleId}&print=1`), 'Print action link is present');
        // Receive Payment button must be present for partial credit sale with balance
        assert(res.body.includes(`data-id="${partialPayCreditSaleId}"`), 'Receive payment trigger button is present');
    });

    // 9. Credit Sale row -> must be visually highlighted
    await test(9, 'Credit Sale row -> must be visually highlighted', async () => {
        const res = await makeRequest('/manage_sales_note.php');
        assert.strictEqual(res.status, 200);

        // Verify credit-sale-row class is rendered in the HTML table
        assert(res.body.includes('credit-sale-row'), 'Table rows for Credit Sales include credit-sale-row class');
        assert(res.body.includes('.credit-sale-row {'), 'Style block defines credit-sale-row highlighting rules');
    });

    // 10. Refresh the page -> all amounts and statuses must remain correct
    await test(10, 'Refresh the page -> all amounts and statuses must remain correct', async () => {
        // Query view page
        const viewRes = await makeRequest(`/sales-notes/view/${partialPayCreditSaleId}`);
        assert.strictEqual(viewRes.status, 200);

        const [sale] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [partialPayCreditSaleId]);
        const paid = parseFloat(sale[0].paid_amount);
        const bal = parseFloat(sale[0].credit_amount);

        const formattedPaid = paid.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const formattedBal = bal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        assert(viewRes.body.includes('CREDIT SALE'), 'View page shows CREDIT SALE badge');
        assert(viewRes.body.includes('Partially Paid'), 'View page shows Partially Paid badge');
        assert(viewRes.body.includes(formattedPaid), 'View page shows correct paid amount');
        assert(viewRes.body.includes(formattedBal), 'View page shows correct balance amount');
    });

    // 11. Existing non-credit sales -> must continue working exactly as before
    await test(11, 'Existing non-credit sales -> must continue working exactly as before', async () => {
        const res = await makeRequest('/manage_sales_note.php');
        assert.strictEqual(res.status, 200);

        // Cash Sale row DOES show normal Edit button
        assert(res.body.includes(`/sales-notes/edit/${cashSaleId}`), `Cash sale ID ${cashSaleId} displays normal Edit action`);

        // Cash Sale view page works as before
        const cashViewRes = await makeRequest(`/sales-notes/view/${cashSaleId}`);
        assert.strictEqual(cashViewRes.status, 200);
        assert(cashViewRes.body.includes('Fully Paid'), 'Cash sale shows Fully Paid');
        assert(cashViewRes.body.includes(`/sales-notes/edit/${cashSaleId}`), 'Cash sale view page has Edit button');
    });

    console.log('\n================================================================');
    console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

run11RequirementsVerification().catch(err => {
    console.error('Fatal verification error:', err);
    process.exit(1);
});
