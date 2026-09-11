const assert = require('assert');
const http = require('http');
const pool = require('./config/db');

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

async function runTests() {
    console.log('========================================================================');
    console.log('  INTEGRATION TEST SUITE: CREDIT SALES & SELECTION ENHANCEMENTS        ');
    console.log('========================================================================\n');

    let passed = 0;
    let failed = 0;

    async function test(title, fn) {
        try {
            await fn();
            console.log(`  [PASS] ${title}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${title} -> ${err.message}`);
            failed++;
        }
    }

    // Step 0: Auth
    const loginRes = await makeRequest('/login.php', 'POST', {
        user_name: 'Admin123',
        password: 'admin123'
    }, { 'Content-Type': 'application/x-www-form-urlencoded' });
    assert([200, 302].includes(loginRes.status), 'Logged in successfully');

    // Get an in-stock product
    const [inStockProducts] = await pool.query(
        "SELECT * FROM product_master WHERE status = 1 AND sale_available = 1 AND stock_quantity >= 10 ORDER BY id ASC LIMIT 1"
    );
    assert(inStockProducts.length > 0, 'In-stock product exists');
    const inStockProduct = inStockProducts[0];

    // Ensure we have an out-of-stock product (stock_quantity = 0)
    let [outOfStockProducts] = await pool.query(
        "SELECT * FROM product_master WHERE status = 1 AND stock_quantity = 0 LIMIT 1"
    );
    let outOfStockProduct;
    if (outOfStockProducts.length === 0) {
        const [res] = await pool.query(
            "INSERT INTO product_master (product_code, product_name, selling_price, stock_quantity, status, sale_available, created_at) VALUES ('TEST-OOS-01', 'Test Out of Stock Item', 500.00, 0, 1, 1, NOW())"
        );
        const [inserted] = await pool.query("SELECT * FROM product_master WHERE id = ?", [res.insertId]);
        outOfStockProduct = inserted[0];
    } else {
        outOfStockProduct = outOfStockProducts[0];
    }

    // Ensure we have a customer with sufficient credit limit for standard credit tests
    await pool.query("UPDATE customer_master SET credit_limit = 100000, credit_allowed = 1 WHERE id = 15");
    let [testCustomers] = await pool.query(
        "SELECT * FROM customer_master WHERE id = 15 AND status = 1 LIMIT 1"
    );
    assert(testCustomers.length > 0, 'Customer with credit allowed exists');
    const testCustomer = testCustomers[0];

    // 1. Stock = 0 validation on server: rejects adding out of stock product
    await test('Server rejects creating sales note with Stock = 0 product', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T12:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', '500.00');
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('items[0][product_id]', String(outOfStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', '500.00');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        // Must either return error or redirect with error message
        assert(
            res.body.includes('This product is out of stock and cannot be added to the sale.') ||
            (res.headers.location && res.headers.location.includes(encodeURIComponent('This product is out of stock and cannot be added to the sale.'))),
            'Out of stock message is returned when adding stock = 0 item'
        );
    });

    // 2. Dropdown item display format in create_sales_note.ejs
    await test('Product dropdown in Create Note matches format "Code | Name | Stock: [qty] | ₹[price]" and disables stock=0', async () => {
        const res = await makeRequest('/sales-notes/create');
        assert.strictEqual(res.status, 200);
        // Check for format pattern: Code | Name | Stock: [stock] | ₹[price]
        const pattern = new RegExp(`${inStockProduct.product_code}\\s*\\|\\s*[\\s\\S]*?\\|\\s*Stock:\\s*\\d+\\s*\\|\\s*₹[\\d,]+\\.\\d{2}`);
        assert(pattern.test(res.body), `Contains expected dropdown format matching: Code | Name | Stock: [qty] | ₹[price]`);
        // Check that outOfStockProduct option is disabled
        assert(res.body.includes(`value="${outOfStockProduct.id}"`) && res.body.includes('disabled'), 'Out of stock item is disabled in dropdown');
    });

    // 3. Dropdown item display format in edit_sales_note.ejs
    // Create a temporary valid note to edit
    let createdNoteId = 0;
    let createdNoteNo = '';
    await test('Create valid normal cash sale note', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T12:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(inStockProduct.selling_price));
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(inStockProduct.selling_price));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302, 'Redirects after creation');
        const [rows] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        createdNoteId = rows[0].id;
        createdNoteNo = rows[0].sales_note_no;
        assert(createdNoteId > 0, 'Created note ID found');
    });

    await test('Product dropdown in Edit Note matches format and disables stock=0', async () => {
        const res = await makeRequest(`/sales-notes/edit/${createdNoteId}`);
        assert.strictEqual(res.status, 200);
        const pattern = new RegExp(`${inStockProduct.product_code}\\s*\\|\\s*[\\s\\S]*?\\|\\s*Stock:\\s*\\d+\\s*\\|\\s*₹[\\d,]+\\.\\d{2}`);
        assert(pattern.test(res.body), `Edit page contains expected dropdown format`);
        assert(res.body.includes(`value="${outOfStockProduct.id}"`) && res.body.includes('disabled'), 'Out of stock item is disabled in edit dropdown');
    });

    // 4. Server rejects updating note to include Stock = 0 product
    await test('Server rejects updating note to include Stock = 0 product', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_date', '2026-09-11');
        payload.append('sales_time', '12:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', '500.00');
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('items[0][product_id]', String(outOfStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', '500.00');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest(`/sales-notes/edit/${createdNoteId}`, 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert(
            res.body.includes('This product is out of stock and cannot be added to the sale.') ||
            (res.headers.location && res.headers.location.includes(encodeURIComponent('This product is out of stock and cannot be added to the sale.'))),
            'Out of stock message is returned on edit'
        );
    });

    // 5. Allow credit sales even when customer credit limit is exceeded
    let exceededSaleId = 0;
    let exceededSaleNo = '';
    await test('Allow Credit Sale even when customer credit limit is exceeded', async () => {
        // Find or create customer with small credit limit so normal sale naturally exceeds limit
        const [lowLimitCusts] = await pool.query("SELECT * FROM customer_master WHERE status = 1 AND credit_allowed = 1 AND credit_limit > 0 AND credit_limit < 1000 LIMIT 1");
        let lowLimitCust;
        if (lowLimitCusts.length > 0) {
            lowLimitCust = lowLimitCusts[0];
        } else {
            const [cRes] = await pool.query("INSERT INTO customer_master (customer_code, customer_name, mobile_number, credit_allowed, credit_limit, status, created_at) VALUES ('CUST-T-LIMIT', 'Test Low Limit Customer', '9999900001', 1, 100.00, 1, NOW())");
            const [cRow] = await pool.query("SELECT * FROM customer_master WHERE id = ?", [cRes.insertId]);
            lowLimitCust = cRow[0];
        }

        const saleUnitPrice = parseFloat(inStockProduct.selling_price);
        const saleGrandTotal = saleUnitPrice; // 1200 > 100.00 (Exceeds limit!)

        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T12:00');
        payload.append('customer_id', String(lowLimitCust.id));
        payload.append('final_grand_total', String(saleGrandTotal));
        payload.append('sale_type', 'credit');
        payload.append('amount_received', '0'); // full credit
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(saleUnitPrice));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        // Step A: Attempt without credit_override -> must show backend validation error
        const resWithoutOverride = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(resWithoutOverride.status, 200, 'Re-renders create page with validation error when not authorized');
        assert(resWithoutOverride.body.includes("Sale exceeds customer's credit limit. Check this box to authorize and record this transaction."), 'Includes credit limit override validation error');

        // Step B: Submit WITH credit_override = 1 -> succeeds and records transaction
        payload.append('credit_override', '1');
        const res = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        assert.strictEqual(res.status, 302, 'Credit sale with limit exceeded was successfully allowed and redirected with override');

        const [rows] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        exceededSaleId = rows[0].id;
        exceededSaleNo = rows[0].sales_note_no;

        assert.strictEqual(rows[0].credit_status, 'Limit Exceeded', 'Flagged with credit_status = Limit Exceeded');
        assert.strictEqual(Number(rows[0].credit_override), 1, 'credit_override flag is 1');
        assert.strictEqual(parseFloat(rows[0].first_payment), 0, 'first_payment is 0.00');
        assert.strictEqual(parseFloat(rows[0].credit_amount), saleGrandTotal, 'credit_amount equals grand total');
    });

    // 6. Manage sales note displays Credit Limit Exceeded badge and highlights row
    await test('Manage Sales view shows Credit Limit Exceeded badge and row highlight', async () => {
        const res = await makeRequest('/sales-notes');
        assert.strictEqual(res.status, 200);
        assert(res.body.includes('Credit Limit Exceeded'), 'Manage page includes Credit Limit Exceeded badge');
        assert(res.body.includes('credit-limit-exceeded-row'), 'Manage page includes credit-limit-exceeded-row class');
    });

    // 7. Track First Payment, Subsequent Credit Payments, and Remaining Credit
    let trackSaleId = 0;
    let trackSaleNo = '';
    const itemPrice = parseFloat(inStockProduct.selling_price);
    const trackGrandTotal = itemPrice * 2;
    const trackFirstPayment = Math.floor(trackGrandTotal / 4);
    const trackSecondPayment = Math.floor(trackGrandTotal / 3);

    await test('Create credit sale with initial First Payment', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-11T12:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(trackGrandTotal));
        payload.append('sale_type', 'credit');
        payload.append('amount_received', String(trackFirstPayment));
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '2');
        payload.append('items[0][unit_price]', String(itemPrice));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);

        const [rows] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        trackSaleId = rows[0].id;
        trackSaleNo = rows[0].sales_note_no;

        assert.strictEqual(parseFloat(rows[0].first_payment), trackFirstPayment, 'first_payment is stored correctly');
        assert.strictEqual(parseFloat(rows[0].paid_amount), trackFirstPayment, 'paid_amount equals first_payment');
        assert.strictEqual(parseFloat(rows[0].credit_amount), trackGrandTotal - trackFirstPayment, 'credit_amount is remaining');
    });

    await test('Record subsequent credit installment via Pay Credit Balance', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_note_id', String(trackSaleId));
        payload.append('payment_amount', String(trackSecondPayment));
        payload.append('payment_method', 'Cash');
        payload.append('notes', 'Installment 1');

        const res = await makeRequest('/sales-notes/receive-payment', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302, 'Payment recorded and redirected');

        const [rows] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [trackSaleId]);
        const updatedSale = rows[0];

        // first_payment must REMAIN trackFirstPayment
        assert.strictEqual(parseFloat(updatedSale.first_payment), trackFirstPayment, 'first_payment remains initial amount');
        // paid_amount must be trackFirstPayment + trackSecondPayment
        assert.strictEqual(parseFloat(updatedSale.paid_amount), trackFirstPayment + trackSecondPayment, 'paid_amount is updated');
        // credit_amount must be trackGrandTotal - (trackFirstPayment + trackSecondPayment)
        assert.strictEqual(parseFloat(updatedSale.credit_amount), trackGrandTotal - (trackFirstPayment + trackSecondPayment), 'remaining credit is correct');
    });

    // 8. Overpayment prevention in Pay Credit Balance
    await test('Reject installment payment exceeding remaining credit balance', async () => {
        const payload = new URLSearchParams();
        payload.append('sales_note_id', String(trackSaleId));
        payload.append('payment_amount', '999999.00'); // Remaining is much less
        payload.append('payment_method', 'Cash');

        const res = await makeRequest('/sales-notes/receive-payment', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);
        assert(res.headers.location && res.headers.location.includes(encodeURIComponent('cannot exceed outstanding balance')), 'Rejects overpayment');
    });

    // 9. View Sales Note financial breakdown and payment history
    await test('View Sales Note shows financial breakdown (Original Total, Payment 1, Payment 2, Remaining Balance)', async () => {
        const res = await makeRequest(`/sales-notes/view/${trackSaleId}`);
        assert.strictEqual(res.status, 200);
        assert(res.body.includes('Payment 1') || res.body.includes('Payment 1:'), 'Displays Payment 1 label');
        assert(res.body.includes('Payment 2') || res.body.includes('Payment 2:'), 'Displays Payment 2 label');
        assert(res.body.includes('Installment 1') || res.body.includes('Credit Payment History'), 'Displays installment in payment history table');
        assert(res.body.includes(`/sales-notes/edit/${trackSaleId}`), 'Edit button is present');
        assert(res.body.includes('Pay Credit Balance'), 'Pay Credit Balance button is present when balance remains');
    });

    // 10. Edit Sales Note preserves subsequent payments
    await test('Edit Sales Note pre-populates initial payment and preserves subsequent payments', async () => {
        const editPageRes = await makeRequest(`/sales-notes/edit/${trackSaleId}`);
        assert.strictEqual(editPageRes.status, 200);
        assert(editPageRes.body.includes('Recorded Payments') || editPageRes.body.includes('Payment 1'), 'Edit page shows credit payments breakdown');

        // Submit edit keeping items
        const payload = new URLSearchParams();
        payload.append('sales_date', '2026-09-11');
        payload.append('sales_time', '12:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(trackGrandTotal));
        payload.append('sale_type', 'credit');
        payload.append('amount_received', String(trackFirstPayment)); // unchanged first payment
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '2');
        payload.append('items[0][unit_price]', String(trackGrandTotal / 2));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const editPostRes = await makeRequest(`/sales-notes/edit/${trackSaleId}`, 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(editPostRes.status, 302);

        // Verify sale record in DB
        const [rows] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [trackSaleId]);
        const updatedSale = rows[0];
        const remainingBal = trackGrandTotal - (trackFirstPayment + trackSecondPayment);
        assert.strictEqual(parseFloat(updatedSale.first_payment), trackFirstPayment, 'first_payment preserved');
        assert.strictEqual(parseFloat(updatedSale.paid_amount), trackFirstPayment + trackSecondPayment, 'paid_amount preserved');
        assert.strictEqual(parseFloat(updatedSale.credit_amount), remainingBal, `credit balance preserved at ${remainingBal}`);
    });

    // 11. Pay remaining credit balance to test full payment state
    await test('Pay remaining credit balance and verify Pay Balance button disappears while Edit stays', async () => {
        const remainingBal = trackGrandTotal - (trackFirstPayment + trackSecondPayment);
        const payload = new URLSearchParams();
        payload.append('sales_note_id', String(trackSaleId));
        payload.append('payment_amount', String(remainingBal)); // Pay remaining
        payload.append('payment_method', 'Cash');
        payload.append('notes', 'Final Installment');

        const res = await makeRequest('/sales-notes/receive-payment', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);

        // Check in DB
        const [rows] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [trackSaleId]);
        assert.strictEqual(parseFloat(rows[0].credit_amount), 0.00, 'Remaining credit is 0.00 (Fully Paid)');

        // Check view page: Edit button must still be there, but Pay Balance button should not be displayed
        const viewRes = await makeRequest(`/sales-notes/view/${trackSaleId}`);
        assert(viewRes.body.includes(`/sales-notes/edit/${trackSaleId}`), 'Edit button is still present when fully paid');
        // In view page header, the Pay Balance button is conditioned on remainingCredit > 0
        assert(!viewRes.body.includes('data-bs-target="#payBalanceModal"'), 'Pay Balance button hidden when fully paid');

        // Check manage page: Edit button is present
        const manageRes = await makeRequest('/sales-notes');
        assert(manageRes.body.includes(`/sales-notes/edit/${trackSaleId}`), 'Edit button is present in Manage Sales for credit sale');
    });

    // 12. Dashboard Credit Sales & Receivables section verification
    await test('Dashboard renders Credit Sales & Receivables overview with real-time metrics', async () => {
        const res = await makeRequest('/');
        assert.strictEqual(res.status, 200);
        assert(res.body.includes('Credit Sales &amp; Receivables') || res.body.includes('Credit Sales & Receivables'), 'Dashboard includes Credit Sales section header');
        assert(res.body.includes('Total Credit Sales'), 'Dashboard includes Total Credit Sales metric');
        assert(res.body.includes('Outstanding Credit'), 'Dashboard includes Outstanding Credit metric');
        assert(res.body.includes('Collection Status'), 'Dashboard includes Collection Status breakdown');
        assert(res.body.includes('Limit Exceeded'), 'Dashboard includes Limit Exceeded metric');
    });

    // 13. NaN Error Prevention: Editing with empty other_charges does not fail with "Unknown column 'NaN'"
    await test('Editing sales note with empty other_charges ("") succeeds without Unknown column NaN error', async () => {
        const payload = new URLSearchParams();
        payload.append('id', String(createdNoteId));
        payload.append('sales_date', '2026-09-11');
        payload.append('sales_time', '12:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('other_charges', ''); // Empty string that previously produced NaN
        payload.append('final_grand_total', String(inStockProduct.selling_price));
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(inStockProduct.selling_price));
        payload.append('items[0][discount]', '');
        payload.append('items[0][tax_percent]', '');

        const res = await makeRequest(`/sales-notes/edit/${createdNoteId}`, 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        assert([302, 200].includes(res.status), `Expected 302 redirect on success, got ${res.status}`);
        assert(!String(res.headers.location || '').includes('NaN'), 'Redirect URL should not have NaN error');

        const [rows] = await pool.query("SELECT other_charges, discount, total_amount FROM sales_notes WHERE id = ?", [createdNoteId]);
        assert.strictEqual(parseFloat(rows[0].other_charges), 0.00, 'Empty other_charges saved cleanly as 0.00');
        assert(!isNaN(parseFloat(rows[0].discount)), 'Discount is a valid number and not NaN');
    });

    // 14. Amount Received == Grand Total -> Saves as Normal Sale (sale_type = 'sale')
    let normalConvertedSaleId;
    await test('Amount Received == Grand Total saves as Normal Sale (sale_type = "sale") even if Credit was selected', async () => {
        const price = parseFloat(inStockProduct.selling_price);
        const payload = new URLSearchParams();
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'credit'); // User selected credit in UI
        payload.append('final_grand_total', price.toFixed(2));
        payload.append('amount_received', price.toFixed(2)); // But paid full amount!
        payload.append('payment_method', 'UPI');
        payload.append('other_charges', '');
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', price.toFixed(2));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);

        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        normalConvertedSaleId = latest[0].id;
        assert.strictEqual(latest[0].sale_type, 'sale', 'Saved as normal sale (sale_type = "sale")');
        assert.strictEqual(parseFloat(latest[0].credit_amount), 0.00, 'Credit amount is 0.00');
        assert.strictEqual(parseFloat(latest[0].paid_amount), price, 'Paid amount is full price');
        assert.strictEqual(latest[0].payment_type, 'UPI', 'Payment type preserved as UPI');
    });

    // 15. Amount Received < Grand Total -> Saves as Credit Sale (sale_type = 'credit')
    let partialCreditSaleId;
    await test('Amount Received < Grand Total saves as Credit Sale (sale_type = "credit") with credit balance', async () => {
        const price = parseFloat(inStockProduct.selling_price);
        const halfPrice = Math.round(price / 2);
        const expectedBal = price - halfPrice;

        const payload = new URLSearchParams();
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'credit');
        payload.append('final_grand_total', price.toFixed(2));
        payload.append('amount_received', halfPrice.toFixed(2)); // Paid only half
        payload.append('payment_method', 'Cash');
        payload.append('other_charges', '');
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', price.toFixed(2));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);

        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        partialCreditSaleId = latest[0].id;
        assert.strictEqual(latest[0].sale_type, 'credit', 'Saved as credit sale (sale_type = "credit")');
        assert.strictEqual(parseFloat(latest[0].credit_amount), expectedBal, 'Credit amount matches unpaid balance');
        assert.strictEqual(parseFloat(latest[0].paid_amount), halfPrice, 'Paid amount is half price');
    });

    // 16. Edit Sales Note: paying in full converts sale to Normal Sale without NaN
    await test('Editing sales note to pay in full converts sale to Normal Sale without NaN', async () => {
        const price = parseFloat(inStockProduct.selling_price);

        const payload = new URLSearchParams();
        payload.append('id', String(partialCreditSaleId));
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'credit');
        payload.append('other_charges', '');
        payload.append('final_grand_total', price.toFixed(2));
        payload.append('amount_received', price.toFixed(2)); // Pay in full on edit!
        payload.append('payment_method', 'Card');
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', price.toFixed(2));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest(`/sales-notes/edit/${partialCreditSaleId}`, 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);

        const [updated] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [partialCreditSaleId]);
        assert.strictEqual(updated[0].sale_type, 'sale', 'Updated sale converted to sale_type = "sale"');
        assert.strictEqual(parseFloat(updated[0].credit_amount), 0.00, 'Credit amount is 0.00');
        assert.strictEqual(parseFloat(updated[0].paid_amount), price, 'Paid amount equals total');
    });

    // 17. Multi-installment Credit Sale: Shows all credit payments (Payment 1, 2, 3, 4, etc.)
    await test('Tracks and displays all credit payments 1, 2, 3, 4 etc. across View, Edit and Manage pages', async () => {
        const price = parseFloat(inStockProduct.selling_price);

        // Step 1: Create a credit sale with initial payment (Payment 1)
        const initPay = 100.00;
        const payload = new URLSearchParams();
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'credit');
        payload.append('final_grand_total', price.toFixed(2));
        payload.append('amount_received', initPay.toFixed(2)); // Payment 1
        payload.append('payment_method', 'Cash');
        payload.append('other_charges', '');
        payload.append('items[0][product_id]', String(inStockProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', price.toFixed(2));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const createRes = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(createRes.status, 302);

        const [createdRows] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        const multiSaleId = createdRows[0].id;

        // Step 2: Record Payment 2 (Installment 1)
        const pay2 = new URLSearchParams();
        pay2.append('sales_note_id', String(multiSaleId));
        pay2.append('payment_amount', '50.00');
        pay2.append('payment_method', 'UPI');
        pay2.append('notes', 'Part 2');
        await makeRequest('/sales-notes/receive-payment', 'POST', pay2.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        // Step 3: Record Payment 3 (Installment 2)
        const pay3 = new URLSearchParams();
        pay3.append('sales_note_id', String(multiSaleId));
        pay3.append('payment_amount', '60.00');
        pay3.append('payment_method', 'Card');
        pay3.append('notes', 'Part 3');
        await makeRequest('/sales-notes/receive-payment', 'POST', pay3.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        // Step 4: Record Payment 4 (Installment 3)
        const pay4 = new URLSearchParams();
        pay4.append('sales_note_id', String(multiSaleId));
        pay4.append('payment_amount', '40.00');
        pay4.append('payment_method', 'Bank Transfer');
        pay4.append('notes', 'Part 4');
        await makeRequest('/sales-notes/receive-payment', 'POST', pay4.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        // Step 5: Verify on View Sales Note page
        const viewRes = await makeRequest(`/sales-notes/view/${multiSaleId}`);
        assert.strictEqual(viewRes.status, 200);
        assert(viewRes.body.includes('Payment 1'), 'View page shows Payment 1');
        assert(viewRes.body.includes('Payment 2'), 'View page shows Payment 2');
        assert(viewRes.body.includes('Payment 3'), 'View page shows Payment 3');
        assert(viewRes.body.includes('Payment 4'), 'View page shows Payment 4');

        // Step 6: Verify on Edit Sales Note page
        const editRes = await makeRequest(`/sales-notes/edit/${multiSaleId}`);
        assert.strictEqual(editRes.status, 200);
        assert(editRes.body.includes('Payment 1'), 'Edit page shows Payment 1');
        assert(editRes.body.includes('Payment 2'), 'Edit page shows Payment 2');
        assert(editRes.body.includes('Payment 3'), 'Edit page shows Payment 3');
        assert(editRes.body.includes('Payment 4'), 'Edit page shows Payment 4');

        // Step 7: Verify on Manage Sales Note page
        const manageRes = await makeRequest('/sales-notes');
        assert.strictEqual(manageRes.status, 200);
        assert(manageRes.body.includes('Payment 1:'), 'Manage page shows Payment 1');
        assert(manageRes.body.includes('Payment 2:'), 'Manage page shows Payment 2');
        assert(manageRes.body.includes('Payment 3:'), 'Manage page shows Payment 3');
        assert(manageRes.body.includes('Payment 4:'), 'Manage page shows Payment 4');
    });

    // 18. Round Off: automatically calculates Round Off and rounds total_amount to nearest rupee on Create
    let roundOffSaleId;
    let roundProduct;
    await test('Create sales note with fractional paise automatically calculates Round Off and rounds to nearest rupee', async () => {
        await pool.query(
            "INSERT INTO product_master (product_code, product_name, selling_price, stock_quantity, status, sale_available, created_at) VALUES ('TEST-ROUND-199', 'Test Round Off Item', 199.00, 50, 1, 1, NOW()) ON DUPLICATE KEY UPDATE selling_price = 199.00, stock_quantity = 50, status = 1, sale_available = 1"
        );
        const [pRows] = await pool.query("SELECT id, selling_price FROM product_master WHERE product_code = 'TEST-ROUND-199'");
        roundProduct = pRows[0];

        const payload = new URLSearchParams();
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('other_charges', '');
        payload.append('items[0][product_id]', String(roundProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', '199.00');
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '18');

        // Subtotal = 199.00, Tax 18% = 35.82, Raw Total = 234.82 -> Rounded Grand Total = 235.00, Round Off = +0.18
        const res = await makeRequest('/sales-notes/create', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);

        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        roundOffSaleId = latest[0].id;
        assert.strictEqual(parseFloat(latest[0].subtotal), 199.00, 'Subtotal is 199.00');
        assert.strictEqual(parseFloat(latest[0].tax), 35.82, 'Tax is 35.82');
        assert.strictEqual(parseFloat(latest[0].round_off), 0.18, 'Round off is +0.18');
        assert.strictEqual(parseFloat(latest[0].total_amount), 235.00, 'Grand total is rounded to whole rupee 235.00');
        assert.strictEqual(parseFloat(latest[0].paid_amount), 235.00, 'Paid amount is full rounded total 235.00');

        // Verify on View Sales Note page
        const viewRes = await makeRequest(`/sales-notes/view/${roundOffSaleId}`);
        assert.strictEqual(viewRes.status, 200);
        assert(viewRes.body.includes('Round Off:'), 'View page displays Round Off line');
        assert(viewRes.body.includes('0.18'), 'View page displays +0.18 round off');
    });

    // 19. Round Off: updates Round Off on Edit sales note
    await test('Editing sales note recalculates and saves updated Round Off and rounded total', async () => {
        // Subtotal: 2 * 199 = 398.00. Discount: 15.50. Taxable: 382.50. Tax 18% = 68.85. Raw = 451.35 -> Rounded = 451.00, Round Off = -0.35
        const payload = new URLSearchParams();
        payload.append('id', String(roundOffSaleId));
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'sale');
        payload.append('payment_type', 'Cash');
        payload.append('other_charges', '');
        payload.append('items[0][product_id]', String(roundProduct.id));
        payload.append('items[0][quantity]', '2');
        payload.append('items[0][unit_price]', '199.00');
        payload.append('items[0][discount]', '15.50');
        payload.append('items[0][tax_percent]', '18');

        const res = await makeRequest(`/sales-notes/edit/${roundOffSaleId}`, 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });
        assert.strictEqual(res.status, 302);

        const [updated] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [roundOffSaleId]);
        assert.strictEqual(parseFloat(updated[0].subtotal), 398.00, 'Subtotal is 398.00');
        assert.strictEqual(parseFloat(updated[0].discount), 15.50, 'Discount is 15.50');
        assert.strictEqual(parseFloat(updated[0].tax), 68.85, 'Tax is 68.85');
        assert.strictEqual(parseFloat(updated[0].round_off), -0.35, 'Round off is updated to -0.35');
        assert.strictEqual(parseFloat(updated[0].total_amount), 451.00, 'Grand total is rounded to 451.00');

        // Verify on View Sales Note page
        const viewRes = await makeRequest(`/sales-notes/view/${roundOffSaleId}`);
        assert.strictEqual(viewRes.status, 200);
        assert(viewRes.body.includes('Round Off:'), 'View page displays Round Off line');
        assert(viewRes.body.includes('0.35'), 'View page displays -0.35 round off');
    });

    // 20. Payment Status Filter in Manage Sales Notes (paid, partial, unpaid)
    await test('Manage Sales Notes filters sales notes by Payment Status (paid, partial, unpaid)', async () => {
        for (const pStatus of ['paid', 'partial', 'unpaid']) {
            const res = await makeRequest(`/sales-notes?payment_status=${pStatus}`);
            assert.strictEqual(res.status, 200, `Returns 200 OK for payment_status=${pStatus}`);
            assert(res.body.includes(`value="${pStatus}" selected`), `Dropdown selects option value="${pStatus}"`);
            assert(res.body.includes('Payment Status'), 'Filter label Payment Status is present');
        }
    });

    console.log('\n========================================================================');
    console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Fatal error running tests:', err);
    process.exit(1);
});
