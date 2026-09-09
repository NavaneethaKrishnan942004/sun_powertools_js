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

async function runTests() {
    console.log('================================================================');
    console.log('  STARTING CREDIT SALE, EDIT & PAYMENT STATUS TEST SUITE        ');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    function test(name, fn) {
        try {
            fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name}: ${err.message}`);
            failed++;
        }
    }

    async function testAsync(name, fn) {
        try {
            await fn();
            console.log(`  [PASS] ${name}`);
            passed++;
        } catch (err) {
            console.error(`  [FAIL] ${name}: ${err.message}`);
            failed++;
        }
    }

    // --- GROUP 1: Helper Unit Logic ---
    console.log('--- TEST GROUP 1: Payment Status & Sale Type Helper Logic ---');
    test('Full Payment detected when paid equals grand total', () => {
        const info = getPaymentStatusInfo(10000, 10000);
        assert.strictEqual(info.status, 'FULL PAYMENT');
        assert.strictEqual(info.code, 'FULL_PAYMENT');
        assert.strictEqual(info.balance, 0);
    });

    test('Full Payment detected when paid exceeds grand total', () => {
        const info = getPaymentStatusInfo(12000, 10000);
        assert.strictEqual(info.status, 'FULL PAYMENT');
        assert.strictEqual(info.balance, 0);
    });

    test('Partially Paid detected when 0 < paid < grand total', () => {
        const info = getPaymentStatusInfo(4000, 10000);
        assert.strictEqual(info.status, 'PARTIALLY PAID');
        assert.strictEqual(info.code, 'PARTIALLY_PAID');
        assert.strictEqual(info.balance, 6000);
    });

    test('Unpaid detected when paid is 0 and total > 0', () => {
        const info = getPaymentStatusInfo(0, 10000);
        assert.strictEqual(info.status, 'UNPAID');
        assert.strictEqual(info.code, 'UNPAID');
        assert.strictEqual(info.balance, 10000);
    });

    test('Sale Type helper identifies credit sale', () => {
        const info = getSaleTypeInfo('credit', 0);
        assert.strictEqual(info.type, 'credit');
        assert.strictEqual(info.label, 'CREDIT SALE');
    });

    test('Sale Type helper identifies normal sale', () => {
        const info = getSaleTypeInfo('sale', 0);
        assert.strictEqual(info.type, 'sale');
        assert.strictEqual(info.label, 'SALE');
    });

    test('Sale Type helper backward-compatibility: credit_amount > 0 infers credit sale', () => {
        const info = getSaleTypeInfo('sale', 1500);
        assert.strictEqual(info.type, 'credit');
        assert.strictEqual(info.label, 'CREDIT SALE');
    });

    // --- GROUP 2: Authentication ---
    console.log('\n--- TEST GROUP 2: Authentication & DB Connection ---');
    await testAsync('Login to ERP session', async () => {
        const res = await makeRequest('/login.php', 'POST', {
            user_name: 'Admin123',
            password: 'admin123'
        }, { 'Content-Type': 'application/x-www-form-urlencoded' });
        assert([200, 302].includes(res.status), `Login response status was ${res.status}`);
    });

    await testAsync('Verify sales_notes table has sale_type column in MySQL', async () => {
        const [cols] = await pool.query("SHOW COLUMNS FROM sales_notes LIKE 'sale_type'");
        assert(cols.length > 0, 'sale_type column exists in sales_notes table');
    });

    // --- GROUP 3: Create Credit Sale & Verify DB Persistence ---
    console.log('\n--- TEST GROUP 3: Create Credit Sale & Verify DB Persistence ---');
    const [products] = await pool.query("SELECT * FROM product_master WHERE status = 1 AND sale_available = 1 AND stock_quantity >= 5 ORDER BY id ASC LIMIT 1");
    assert(products.length > 0, 'Available product found');
    const testProduct = products[0];

    const [customers] = await pool.query("SELECT * FROM customer_master WHERE status = 1 AND credit_allowed = 1 AND credit_limit >= 5000 ORDER BY credit_limit DESC LIMIT 1");
    assert(customers.length > 0, 'Credit allowed customer found');
    const testCustomer = customers[0];

    let createdCreditSaleId = 0;
    let createdCreditSaleNo = '';

    await testAsync('Create Credit Sale with partial payment and adjusted final total', async () => {
        const unitPrice = parseFloat(testProduct.selling_price);
        const qty = 1;
        const lineTotal = unitPrice * qty;
        const finalGrandTotal = lineTotal - 100; // ₹100 discount applied
        const amountReceived = 500; // Partial payment

        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-09T17:00');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('final_grand_total', String(finalGrandTotal));
        payload.append('sale_type', 'credit');
        payload.append('amount_received', String(amountReceived));
        payload.append('payment_method', 'Cash');
        payload.append('credit_override', '1');
        payload.append('notes', 'Automated Credit Sale Persistence Test');
        payload.append('items[0][product_id]', String(testProduct.id));
        payload.append('items[0][quantity]', String(qty));
        payload.append('items[0][unit_price]', String(unitPrice));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest('/create_sales_note.php', 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        assert([302, 200].includes(res.status), `Unexpected status ${res.status}`);
        const [latest] = await pool.query("SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1");
        assert(latest.length > 0, 'Latest sales note found');
        createdCreditSaleId = latest[0].id;
        createdCreditSaleNo = latest[0].sales_note_no;

        assert.strictEqual(latest[0].sale_type, 'credit', `sale_type must be permanently stored as 'credit' (got ${latest[0].sale_type})`);
        assert.strictEqual(parseFloat(latest[0].total_amount), finalGrandTotal, 'total_amount matches finalGrandTotal');
        assert.strictEqual(parseFloat(latest[0].paid_amount), amountReceived, 'paid_amount matches amountReceived');
        assert.strictEqual(parseFloat(latest[0].credit_amount), finalGrandTotal - amountReceived, 'credit_amount matches balance');
        assert.strictEqual(latest[0].status, 1, 'Sales note is active (status = 1)');
    });

    await testAsync('Verify customer transaction recorded debit_amount for Credit Sale', async () => {
        const [txs] = await pool.query(
            "SELECT * FROM customer_transactions WHERE reference_number = ? AND transaction_type = 'sale' LIMIT 1",
            [createdCreditSaleNo]
        );
        assert(txs.length > 0, 'Customer transaction found for credit sale');
        assert.strictEqual(parseFloat(txs[0].debit_amount), parseFloat(testProduct.selling_price) - 100 - 500, 'Debit matches balance');
        assert.strictEqual(txs[0].payment_status, 'Partial', 'Transaction marked Partial');
    });

    // --- GROUP 4: Edit Mode Shows Correct Credit Sale Details ---
    console.log('\n--- TEST GROUP 4: Edit Sales Note Loads Credit Sale & Payment Details ---');
    await testAsync('GET /edit_sales_note.php loads Credit Sale as checked and pre-populates financials', async () => {
        const res = await makeRequest(`/edit_sales_note.php?id=${createdCreditSaleId}`);
        assert.strictEqual(res.status, 200, 'Edit page loaded successfully');

        // Verify Credit Sale radio is checked
        assert(res.body.includes('id="saleTypeCredit" value="credit" checked'), 'Credit Sale radio is checked');
        assert(!res.body.includes('id="saleTypeNormal" value="sale" checked'), 'Normal Sale radio is NOT checked');

        // Verify prefilled financial fields
        const expectedFinal = parseFloat(testProduct.selling_price) - 100;
        assert(res.body.includes(`value="${expectedFinal.toFixed(2)}"`), 'Final Grand Total is prefilled');
        assert(res.body.includes('value="500.00"'), 'Amount Received is prefilled with 500.00');

        // Verify prominent Balance to Pay box is present
        assert(res.body.includes('id="balanceHighlightBox"'), 'Balance highlight card exists in HTML');
        assert(res.body.includes('Balance to Pay'), 'Balance to Pay title exists');
    });

    // --- GROUP 5: Update Credit Sale (Partial Payment -> Full Payment) ---
    console.log('\n--- TEST GROUP 5: Edit Mode Transitions & Customer Ledger Synchronization ---');
    await testAsync('Update Credit Sale to Full Payment via Edit', async () => {
        const expectedFinal = parseFloat(testProduct.selling_price) - 100;
        const payload = new URLSearchParams();
        payload.append('id', String(createdCreditSaleId));
        payload.append('sales_date', '2026-09-09');
        payload.append('sales_time', '17:30');
        payload.append('customer_id', String(testCustomer.id));
        payload.append('sale_type', 'credit'); // Stays Credit Sale
        payload.append('final_grand_total', String(expectedFinal));
        payload.append('amount_received', String(expectedFinal)); // Fully paid now!
        payload.append('payment_method', 'Cash');
        payload.append('notes', 'Fully Paid Later Credit Sale Test');
        payload.append('items[0][product_id]', String(testProduct.id));
        payload.append('items[0][quantity]', '1');
        payload.append('items[0][unit_price]', String(testProduct.selling_price));
        payload.append('items[0][discount]', '0');
        payload.append('items[0][tax_percent]', '0');

        const res = await makeRequest(`/edit_sales_note.php?id=${createdCreditSaleId}`, 'POST', payload.toString(), {
            'Content-Type': 'application/x-www-form-urlencoded'
        });

        assert([302, 200].includes(res.status), `Unexpected status ${res.status}`);
        const [updated] = await pool.query("SELECT * FROM sales_notes WHERE id = ?", [createdCreditSaleId]);
        assert.strictEqual(updated[0].sale_type, 'credit', 'sale_type permanently remains credit');
        assert.strictEqual(parseFloat(updated[0].paid_amount), expectedFinal, 'paid_amount equals final grand total');
        assert.strictEqual(parseFloat(updated[0].credit_amount), 0, 'credit_amount is now 0');

        // Verify customer ledger update
        const [txs] = await pool.query(
            "SELECT * FROM customer_transactions WHERE reference_number = ? AND transaction_type = 'sale'",
            [createdCreditSaleNo]
        );
        assert.strictEqual(txs.length, 1, 'Only one customer transaction exists (no duplicates)');
        assert.strictEqual(parseFloat(txs[0].debit_amount), 0, 'Debit is now 0 (fully paid)');
        assert.strictEqual(txs[0].payment_status, 'Paid', 'Transaction status is Paid');
    });

    // --- GROUP 6: Manage Sales Notes Table Display ---
    console.log('\n--- TEST GROUP 6: Manage Sales Notes Table Columns & Status Badges ---');
    await testAsync('Manage Sales Notes table displays separate Sale Type, Balance, and Payment Status', async () => {
        const res = await makeRequest('/manage_sales_note.php');
        assert.strictEqual(res.status, 200, 'Manage page loaded');

        // Verify table headers
        assert(res.body.includes('>Sale Type<'), 'Table has Sale Type column');
        assert(res.body.includes('>Balance<'), 'Table has Balance column');
        assert(res.body.includes('>Payment Status<'), 'Table has Payment Status column');

        // Verify status badges are present in HTML
        assert(res.body.includes('CREDIT SALE'), 'CREDIT SALE badge rendered');
        assert(res.body.includes('FULL PAYMENT'), 'FULL PAYMENT badge rendered');

        // Verify sticky action column is preserved
        assert(res.body.includes('action-column-wide'), 'Sticky action column class action-column-wide present');
    });

    // --- GROUP 7: Normal Sale Creation & Edit ---
    console.log('\n--- TEST GROUP 7: Normal Sale Create & Edit Verification ---');
    let normalSaleId = 0;
    await testAsync('Create Normal Sale', async () => {
        const unitPrice = parseFloat(testProduct.selling_price);
        const payload = new URLSearchParams();
        payload.append('sales_datetime', '2026-09-09T18:00');
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
        normalSaleId = latest[0].id;
        assert.strictEqual(latest[0].sale_type, 'sale', 'Normal sale saved as sale_type = sale');
        assert.strictEqual(parseFloat(latest[0].credit_amount), 0, 'Credit amount is 0');
    });

    await testAsync('GET /edit_sales_note.php for Normal Sale shows Normal Sale checked', async () => {
        const res = await makeRequest(`/edit_sales_note.php?id=${normalSaleId}`);
        assert.strictEqual(res.status, 200);
        assert(res.body.includes('id="saleTypeNormal" value="sale" checked'), 'Normal Sale radio is checked');
        assert(!res.body.includes('id="saleTypeCredit" value="credit" checked'), 'Credit Sale radio is NOT checked');
    });

    // --- GROUP 8: View Sales Note Verification ---
    console.log('\n--- TEST GROUP 8: View Sales Note Page ---');
    await testAsync('View Sales Note page displays Sale Type and Payment Status badges', async () => {
        const res = await makeRequest(`/view_sales_note.php?id=${createdCreditSaleId}`);
        assert.strictEqual(res.status, 200);
        assert(res.body.includes('CREDIT SALE'), 'CREDIT SALE badge shown on view page');
        assert(res.body.includes('FULL PAYMENT'), 'FULL PAYMENT badge shown on view page');
        assert(res.body.includes('Balance to Pay:'), 'Balance to Pay row shown on view page');
    });

    console.log('\n================================================================');
    console.log(`  FINAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});
