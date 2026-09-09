/**
 * Automated Verification Test Suite for Sales Note v2 Enhancements:
 * - Editable Final Grand Total
 * - Real-time Discount Percentage & Discount Amount
 * - Preventing Invalid Final Grand Total (> Calculated or <= 0)
 * - Sale / Credit Sale using Final Grand Total
 * - Clear Credit Sale Balance to Pay Handling
 * - Conditional Customer Validation (Optional for Normal, Required for Credit)
 * - Sales Note Closes (Status = 1) after Credit Sale
 * - AJAX Quick Customer Creation
 */

require('dotenv').config();
const http = require('http');
const pool = require('./config/db');

let cookie = '';
let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  [PASS] ${message}`);
        passedCount++;
    } else {
        console.error(`  [FAIL] ${message}`);
        failedCount++;
    }
}

function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        if (cookie) {
            reqOptions.headers['Cookie'] = cookie;
        }

        const req = http.request(reqOptions, (res) => {
            let data = '';
            const setCookie = res.headers['set-cookie'];
            if (setCookie) {
                cookie = setCookie.map(c => c.split(';')[0]).join('; ');
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

        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

function urlEncode(obj) {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(obj)) {
        if (Array.isArray(val)) {
            val.forEach(item => {
                if (typeof item === 'object') {
                    for (const [subKey, subVal] of Object.entries(item)) {
                        params.append(`${key}[${subKey}]`, subVal);
                    }
                } else {
                    params.append(key, item);
                }
            });
        } else if (typeof val === 'object' && val !== null) {
            for (const [subKey, subVal] of Object.entries(val)) {
                params.append(`${key}[${subKey}]`, subVal);
            }
        } else if (val !== undefined && val !== null) {
            params.append(key, val);
        }
    }
    return params.toString();
}

async function runTests() {
    console.log('================================================================');
    console.log('  STARTING SALES NOTE V2 ENHANCEMENTS AUTOMATED TEST SUITE      ');
    console.log('================================================================');

    try {
        // 1. Authentication
        console.log('\n--- TEST GROUP 1: Authentication ---');
        const loginData = urlEncode({
            user_name: 'Admin123',
            password: 'admin123'
        });

        const loginRes = await request('/login.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: loginData
        });
        assert(loginRes.statusCode === 302, 'Login succeeded with redirect status 302');

        // Get a test product and customer from DB
        const [products] = await pool.query('SELECT * FROM product_master WHERE status = 1 AND sale_available = 1 AND stock_quantity >= 5 LIMIT 1');
        assert(products.length > 0, 'Found available product for testing: ' + products[0].product_name);
        const testProduct = products[0];

        const [customers] = await pool.query('SELECT * FROM customer_master WHERE status = 1 AND credit_allowed = 1 LIMIT 1');
        assert(customers.length > 0, 'Found credit-allowed customer: ' + customers[0].customer_name);
        const testCustomer = customers[0];

        // 2. AJAX Quick Customer Creation
        console.log('\n--- TEST GROUP 2: Quick Add Customer AJAX Endpoint ---');
        const quickCustName = 'Quick Test Customer ' + Date.now();
        const quickCustMobile = '98' + Math.floor(10000000 + Math.random() * 90000000);
        const quickCustomerPayload = JSON.stringify({
            ajax: '1',
            customer_name: quickCustName,
            customer_type: 'Individual',
            mobile_number: quickCustMobile,
            credit_allowed: 1,
            credit_limit: '15000.00',
            address: '123 Quick Way',
            status: 1
        });

        const quickCustRes = await request('/create_customer.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: quickCustomerPayload
        });

        assert(quickCustRes.statusCode === 200, 'Quick add customer returned 200 OK');
        const quickJson = JSON.parse(quickCustRes.body);
        assert(quickJson.success === true, 'Quick customer creation reported success');
        assert(quickJson.customer && quickJson.customer.customer_name === quickCustName, 'Created customer name matches input');
        const newlyCreatedCustId = quickJson.customer.id;

        // 3. Normal Sale without Customer (Walk-in)
        console.log('\n--- TEST GROUP 3: Normal Sale without Customer (Walk-in Retail) ---');
        const unitPrice = parseFloat(testProduct.selling_price);
        const qty = 2;
        const expectedCalcGrandTotal = unitPrice * qty;

        const normalWalkinBody = {
            sales_datetime: '2026-09-09T17:00',
            customer_id: '',
            sale_type: 'sale',
            payment_type: 'Cash',
            final_grand_total: expectedCalcGrandTotal.toFixed(2),
            notes: 'Test Walkin Normal Sale',
            'items[0][product_id]': testProduct.id,
            'items[0][quantity]': qty,
            'items[0][unit_price]': unitPrice,
            'items[0][discount]': '0.00',
            'items[0][tax_percent]': '0.00'
        };

        const postWalkinRes = await request('/create_sales_note.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncode(normalWalkinBody)
        });

        assert(postWalkinRes.statusCode === 302, 'Normal walk-in sale created successfully (redirect 302)');

        // Query database to verify record
        const [recentWalkin] = await pool.query('SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1');
        assert(recentWalkin.length > 0, 'Retrieved latest sales note from DB');
        assert(recentWalkin[0].customer_id === null, 'Walk-in sales note customer_id is stored as NULL');
        assert(recentWalkin[0].status === 1, 'Sales note status is 1 (completed/closed)');
        assert(Number(recentWalkin[0].credit_amount) === 0, 'Credit amount is 0');
        assert(Number(recentWalkin[0].paid_amount) === expectedCalcGrandTotal, 'Paid amount equals total amount: ' + expectedCalcGrandTotal);

        // 4. Adjusted / Final Grand Total with Automatic Discount Calculation
        console.log('\n--- TEST GROUP 4: Adjusted Final Grand Total with Discount ---');
        const originalTotal = unitPrice * qty;
        const finalDiscountedTotal = originalTotal * 0.9; // 10% discount
        const expectedDiscountAmount = originalTotal - finalDiscountedTotal;

        const discountedSaleBody = {
            sales_datetime: '2026-09-09T17:05',
            customer_id: newlyCreatedCustId,
            sale_type: 'sale',
            payment_type: 'UPI',
            final_grand_total: finalDiscountedTotal.toFixed(2),
            notes: 'Test Discounted Sale 10%',
            'items[0][product_id]': testProduct.id,
            'items[0][quantity]': qty,
            'items[0][unit_price]': unitPrice,
            'items[0][discount]': '0.00',
            'items[0][tax_percent]': '0.00'
        };

        const postDiscountRes = await request('/create_sales_note.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncode(discountedSaleBody)
        });

        assert(postDiscountRes.statusCode === 302, 'Discounted sale created successfully (redirect 302)');

        const [recentDiscounted] = await pool.query('SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1');
        assert(Math.abs(Number(recentDiscounted[0].total_amount) - finalDiscountedTotal) < 0.01, 'Sales note total_amount matches Final Grand Total: ' + finalDiscountedTotal);
        assert(Math.abs(Number(recentDiscounted[0].discount) - expectedDiscountAmount) < 0.01, 'Sales note discount accurately recorded: ' + expectedDiscountAmount);
        assert(Number(recentDiscounted[0].paid_amount) === finalDiscountedTotal, 'Full payment collected for Final Grand Total');
        assert(Number(recentDiscounted[0].credit_amount) === 0, 'No credit added for normal discounted sale');

        // 5. Preventing Invalid Final Grand Total (> Calculated or <= 0)
        console.log('\n--- TEST GROUP 5: Prevent Invalid Final Grand Total ---');
        const invalidHigherBody = {
            sales_datetime: '2026-09-09T17:10',
            customer_id: newlyCreatedCustId,
            sale_type: 'sale',
            final_grand_total: (originalTotal + 500).toFixed(2), // Higher than calculated!
            'items[0][product_id]': testProduct.id,
            'items[0][quantity]': qty,
            'items[0][unit_price]': unitPrice,
            'items[0][discount]': '0.00',
            'items[0][tax_percent]': '0.00'
        };

        const postHigherRes = await request('/create_sales_note.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncode(invalidHigherBody)
        });

        assert(postHigherRes.statusCode === 200, 'Invalid higher Final Grand Total rejected (re-rendered with error 200)');
        assert(postHigherRes.body.includes('cannot exceed the calculated Grand Total') || postHigherRes.body.includes('cannot exceed calculated Grand Total'), 'Error message displayed for higher Final Grand Total');

        const invalidZeroBody = {
            sales_datetime: '2026-09-09T17:10',
            customer_id: newlyCreatedCustId,
            sale_type: 'sale',
            final_grand_total: '0.00', // Zero!
            'items[0][product_id]': testProduct.id,
            'items[0][quantity]': qty,
            'items[0][unit_price]': unitPrice,
            'items[0][discount]': '0.00',
            'items[0][tax_percent]': '0.00'
        };

        const postZeroRes = await request('/create_sales_note.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncode(invalidZeroBody)
        });

        assert(postZeroRes.statusCode === 200, 'Invalid zero/negative Final Grand Total rejected (re-rendered with error 200)');
        assert(postZeroRes.body.includes('greater than zero'), 'Error message displayed for zero/negative Final Grand Total');

        // 6. Credit Sale Without Customer - Must Be Rejected
        console.log('\n--- TEST GROUP 6: Credit Sale Customer Validation ---');
        const creditNoCustomerBody = {
            sales_datetime: '2026-09-09T17:15',
            customer_id: '', // Missing customer!
            sale_type: 'credit',
            final_grand_total: originalTotal.toFixed(2),
            amount_received: '0.00',
            'items[0][product_id]': testProduct.id,
            'items[0][quantity]': qty,
            'items[0][unit_price]': unitPrice,
            'items[0][discount]': '0.00',
            'items[0][tax_percent]': '0.00'
        };

        const postCreditNoCustRes = await request('/create_sales_note.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncode(creditNoCustomerBody)
        });

        assert(postCreditNoCustRes.statusCode === 200, 'Credit sale without customer rejected (status 200 re-render)');
        assert(postCreditNoCustRes.body.includes('Customer selection is required for Credit Sale'), 'Error message specifies customer selection is required for Credit Sale');

        // 7. Credit Sale Using Final Grand Total & Status = 1
        console.log('\n--- TEST GROUP 7: Credit Sale Using Final Grand Total & Status = 1 ---');
        const [creditProds] = await pool.query('SELECT * FROM product_master WHERE status = 1 AND sale_available = 1 AND stock_quantity >= 5 ORDER BY id ASC LIMIT 1');
        assert(creditProds.length > 0, 'Found product for credit sale: ' + creditProds[0].product_name);
        const creditProduct = creditProds[0];
        const creditUnitPrice = parseFloat(creditProduct.selling_price);
        const creditQty = 1;
        const creditCalcTotal = creditUnitPrice * creditQty;
        const creditFinalTotal = creditCalcTotal - Math.min(50, creditCalcTotal * 0.1);
        const amountPaidNow = Math.floor(creditFinalTotal * 0.4);
        const expectedBalance = creditFinalTotal - amountPaidNow;

        const validCreditSaleBody = {
            sales_datetime: '2026-09-09T17:20',
            customer_id: newlyCreatedCustId,
            sale_type: 'credit',
            final_grand_total: creditFinalTotal.toFixed(2),
            amount_received: amountPaidNow.toFixed(2),
            payment_method: 'Cash',
            notes: 'Test Valid Credit Sale with Final Grand Total',
            'items[0][product_id]': creditProduct.id,
            'items[0][quantity]': creditQty,
            'items[0][unit_price]': creditUnitPrice,
            'items[0][discount]': '0.00',
            'items[0][tax_percent]': '0.00'
        };

        const postCreditRes = await request('/create_sales_note.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncode(validCreditSaleBody)
        });

        if (postCreditRes.statusCode !== 302) {
            console.log('postCreditRes status:', postCreditRes.statusCode);
            const matches = postCreditRes.body.match(/<li>(.*?)<\/li>/g);
            console.log('Errors returned:', matches);
        }

        assert(postCreditRes.statusCode === 302, 'Credit sale with Final Grand Total created successfully (redirect 302)');

        const [recentCredit] = await pool.query('SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1');
        assert(recentCredit[0].status === 1, 'Credit sale note status is 1 (completed/closed - not pending)');
        assert(Math.abs(Number(recentCredit[0].total_amount) - creditFinalTotal) < 0.01, 'Total amount saved matches Final Grand Total: ' + creditFinalTotal);
        assert(Math.abs(Number(recentCredit[0].paid_amount) - amountPaidNow) < 0.01, 'Paid amount saved matches amount received: ' + amountPaidNow);
        assert(Math.abs(Number(recentCredit[0].credit_amount) - expectedBalance) < 0.01, 'Credit balance matches Final Grand Total - Amount Received: ' + expectedBalance);

        // Verify customer ledger transaction
        const [ledgerEntries] = await pool.query('SELECT * FROM customer_transactions WHERE customer_id = ? ORDER BY id DESC LIMIT 1', [newlyCreatedCustId]);
        assert(ledgerEntries.length > 0, 'Customer ledger transaction recorded');
        assert(Math.abs(Number(ledgerEntries[0].debit_amount) - expectedBalance) < 0.01, 'Customer ledger debit amount equals credit balance: ' + expectedBalance);

        // 8. Fully Paid Credit Sale (Amount Paid = Final Grand Total)
        console.log('\n--- TEST GROUP 8: Fully Paid Credit Sale ---');
        const [fullyPaidProds] = await pool.query('SELECT * FROM product_master WHERE status = 1 AND sale_available = 1 AND stock_quantity >= 5 ORDER BY id DESC LIMIT 1');
        const fullyPaidProduct = fullyPaidProds[0];
        const fullyPaidUnitPrice = parseFloat(fullyPaidProduct.selling_price);

        const fullyPaidBody = {
            sales_datetime: '2026-09-09T17:25',
            customer_id: newlyCreatedCustId,
            sale_type: 'credit',
            final_grand_total: fullyPaidUnitPrice.toFixed(2),
            amount_received: fullyPaidUnitPrice.toFixed(2),
            payment_method: 'Cash',
            'items[0][product_id]': fullyPaidProduct.id,
            'items[0][quantity]': 1,
            'items[0][unit_price]': fullyPaidUnitPrice,
            'items[0][discount]': '0.00',
            'items[0][tax_percent]': '0.00'
        };

        const postFullyPaidRes = await request('/create_sales_note.php', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: urlEncode(fullyPaidBody)
        });

        assert(postFullyPaidRes.statusCode === 302, 'Fully paid credit sale created successfully (302)');
        const [recentFullyPaid] = await pool.query('SELECT * FROM sales_notes ORDER BY id DESC LIMIT 1');
        assert(Number(recentFullyPaid[0].credit_amount) === 0, 'No outstanding credit created for fully paid credit sale');
        assert(recentFullyPaid[0].status === 1, 'Status is 1 (completed)');

        // Summary
        console.log('\n================================================================');
        console.log(`  FINAL RESULTS: ${passedCount} PASSED, ${failedCount} FAILED   `);
        console.log('================================================================');

        process.exit(failedCount > 0 ? 1 : 0);
    } catch (err) {
        console.error('Test Suite Exception:', err);
        process.exit(1);
    }
}

runTests();
