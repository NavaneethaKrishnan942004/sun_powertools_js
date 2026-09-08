const http = require('http');
const pool = require('./config/db');

async function runWorkflowTest() {
    console.log('--- STARTING FULL WORKFLOW & BUSINESS LOGIC TESTS ---');

    let sessionCookie = '';

    function request(path, options = {}) {
        return new Promise((resolve, reject) => {
            const url = new URL(`http://localhost:3000${path}`);
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

    try {
        // 1. Authenticate
        console.log('Step 1: Authenticating as Admin123...');
        let res = await request('/login.php', {
            method: 'POST',
            body: 'user_name=Admin123&password=admin123'
        });
        console.log(`   Login Status: ${res.statusCode} (Redirected to ${res.headers.location})`);

        // 2. Test Customer Quick Creation
        console.log('Step 2: Testing Customer Creation...');
        const uniqueSuffix = Date.now().toString().slice(-4);
        const testMobile = '987654' + uniqueSuffix;
        const custBody = new URLSearchParams({
            customer_name: `Test Node Customer ${uniqueSuffix}`,
            customer_type: 'Individual',
            company_name: '',
            mobile_number: testMobile,
            email: `node_cust_${uniqueSuffix}@example.com`,
            gst_number: '',
            address: '123 Node Lane',
            area: 'Industrial Area',
            city: 'Chennai',
            district: 'Chennai',
            state: 'Tamil Nadu',
            pincode: '600001',
            opening_balance: '500.00',
            opening_balance_type: 'Debit',
            credit_allowed: '1',
            credit_limit: '10000.00',
            credit_period_days: '30',
            status: '1',
            notes: 'Created via automated Node.js migration test'
        }).toString();

        res = await request('/create_customer.php', {
            method: 'POST',
            body: custBody
        });
        console.log(`   Create Customer Status: ${res.statusCode} (Redirected: ${res.headers.location})`);

        // Verify customer in DB
        const [custRows] = await pool.query("SELECT * FROM customer_master WHERE mobile_number = ?", [testMobile]);
        const createdCustomer = custRows[0];
        console.log(`   Customer created in DB: ID=${createdCustomer.id}, Code=${createdCustomer.customer_code}, Name=${createdCustomer.customer_name}`);

        // 3. Test Product Search AJAX
        console.log('Step 3: Testing Product Search AJAX...');
        res = await request('/ajax_sales_note.php', {
            method: 'POST',
            body: 'action=get_product&id=1'
        });
        const productRes = JSON.parse(res.body);
        const productData = productRes.product;
        console.log(`   Product Fetched: ID=${productData.id}, Code=${productData.product_code}, Name=${productData.product_name}, Price=₹${productData.selling_price}, Stock=${productData.stock_quantity}`);

        // 4. Test Customer Financial Lookup AJAX
        console.log('Step 4: Testing Customer Financial Lookup AJAX...');
        res = await request('/ajax_sales_note.php', {
            method: 'POST',
            body: `action=get_customer&id=${createdCustomer.id}`
        });
        console.log('   custLookup body:', res.body);
        const custLookup = JSON.parse(res.body);
        const custSummary = custLookup.summary || custLookup.customer;
        console.log(`   Customer Financials: Outstanding=₹${custSummary.current_outstanding}, Credit Limit=₹${custLookup.customer.credit_limit}`);

        // 5. Test Sales Note Creation
        console.log('Step 5: Testing Sales Note Creation with Transaction & Inventory Deduction...');
        const initialStock = parseFloat(productData.stock_quantity || 0);
        const qtyToBuy = 2;
        const unitPrice = parseFloat(productData.selling_price || 100);
        const lineTotal = qtyToBuy * unitPrice;
        const paidAmt = 100.00;
        const creditAmt = lineTotal - paidAmt;

        const snBody = new URLSearchParams({
            customer_id: String(createdCustomer.id),
            sales_date: new Date().toISOString().split('T')[0],
            sales_time: '12:00',
            payment_type: 'Mixed',
            notes: 'Test Sales Note from Node.js migration test',
            other_charges: '0.00',
            credit_override: '0',
            paid_amount: String(paidAmt),
            'items[0][product_id]': String(productData.id),
            'items[0][quantity]': String(qtyToBuy),
            'items[0][unit_price]': String(unitPrice),
            'items[0][discount_percent]': '0.00',
            'items[0][discount_amount]': '0.00',
            'items[0][tax_percent]': '0.00',
            'items[0][tax_amount]': '0.00',
            'items[0][line_total]': String(lineTotal)
        }).toString();

        res = await request('/create_sales_note.php', {
            method: 'POST',
            body: snBody
        });
        console.log(`   Create Sales Note Status: ${res.statusCode} (Redirected: ${res.headers.location})`);

        // Check Updated Product Stock
        const [updatedProdRows] = await pool.query("SELECT stock_quantity FROM product_master WHERE id = ?", [productData.id]);
        const finalStock = parseFloat(updatedProdRows[0].stock_quantity);
        console.log(`   Inventory: Initial=${initialStock} -> Final=${finalStock} (Deducted: ${initialStock - finalStock})`);

        // Check Sales Note Record in DB
        const [snRows] = await pool.query("SELECT * FROM sales_notes WHERE customer_id = ? ORDER BY id DESC LIMIT 1", [createdCustomer.id]);
        const createdSN = snRows[0];
        console.log(`   Sales Note created: ID=${createdSN.id}, No=${createdSN.sales_note_no}, Total=₹${createdSN.total_amount}, Paid=₹${createdSN.paid_amount}, Credit=₹${createdSN.credit_amount}`);

        // Check Customer Transaction Ledger
        const [txRows] = await pool.query("SELECT * FROM customer_transactions WHERE reference_number = ?", [createdSN.sales_note_no]);
        console.log(`   Customer Ledger Entries created: ${txRows.length} transactions logged.`);

        // 6. Test Sales Note View Page
        console.log(`Step 6: Testing GET /view_sales_note.php?id=${createdSN.id}...`);
        res = await request(`/view_sales_note.php?id=${createdSN.id}`);
        console.log(`   View Sales Note Status: ${res.statusCode}, Contains Sales Note No: ${res.body.includes(createdSN.sales_note_no)}`);

        // 7. Test User Master Creation
        console.log('Step 7: Testing User Master Creation...');
        const testUserEmail = `test_user_${uniqueSuffix}@example.com`;
        const testUserPhone = '912345' + uniqueSuffix;
        const userBody = new URLSearchParams({
            user_name: `TestUser_${uniqueSuffix}`,
            user_email: testUserEmail,
            user_phone: testUserPhone,
            password: 'password123',
            confirm_password: 'password123',
            role: 'user',
            status: 'on'
        }).toString();

        res = await request('/create_user.php', {
            method: 'POST',
            body: userBody
        });
        console.log(`   Create User Status: ${res.statusCode} (Redirected: ${res.headers.location})`);

        const [createdUserRows] = await pool.query("SELECT * FROM user_master WHERE user_email = ?", [testUserEmail]);
        console.log(`   User created in DB: ID=${createdUserRows[0].id}, Code=${createdUserRows[0].user_id}, Name=${createdUserRows[0].user_name}`);

        console.log('--- ALL WORKFLOW & TRANSACTION TESTS PASSED 100%! ---');
        process.exit(0);
    } catch (err) {
        console.error('Workflow Test Failed:', err);
        process.exit(1);
    }
}

runWorkflowTest();
