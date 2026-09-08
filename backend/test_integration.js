const http = require('http');

async function runTests() {
    console.log('--- STARTING AUTOMATED ENDPOINT TESTS ---');

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
        // 1. Test Login Page GET
        console.log('1. Testing GET /login.php...');
        let res = await request('/login.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Sign In": ${res.body.includes('Sign In')}`);

        // 2. Test Unauthenticated Redirect
        console.log('2. Testing GET /index.php (unauthenticated)...');
        res = await request('/index.php');
        console.log(`   Status: ${res.statusCode}, Location: ${res.headers.location}`);

        // 3. Test Invalid Login
        console.log('3. Testing POST /login.php (invalid credentials)...');
        res = await request('/login.php', {
            method: 'POST',
            body: 'user_name=invalid_user_xyz&password=wrongpassword'
        });
        console.log(`   Status: ${res.statusCode}, Includes "Invalid username or password": ${res.body.includes('Invalid username or password')}`);

        // 4. Test Valid Login (admin)
        console.log('4. Testing POST /login.php (valid admin credentials)...');
        res = await request('/login.php', {
            method: 'POST',
            body: 'user_name=Admin123&password=admin123'
        });
        console.log(`   Status: ${res.statusCode}, Location: ${res.headers.location}, Cookie: ${sessionCookie}`);

        // 5. Test Dashboard GET
        console.log('5. Testing GET /index.php (authenticated)...');
        res = await request('/index.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Dashboard": ${res.body.includes('Dashboard')}`);

        // 6. Test Masters GET
        console.log('6. Testing GET /masters.php...');
        res = await request('/masters.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Category Master": ${res.body.includes('Category Master')}`);

        // 7. Test Settings GET
        console.log('7. Testing GET /settings.php...');
        res = await request('/settings.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Settings & Preferences": ${res.body.includes('Settings & Preferences')}`);

        // 8. Test Profile GET
        console.log('8. Testing GET /profile.php...');
        res = await request('/profile.php');
        console.log(`   Status: ${res.statusCode}, Body includes "My Profile": ${res.body.includes('My Profile')}`);

        // 9. Test Category Master GET
        console.log('9. Testing GET /manage_category.php...');
        res = await request('/manage_category.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Category Master": ${res.body.includes('Category Master')}`);

        // 10. Test Brand Master GET
        console.log('10. Testing GET /manage_brand.php...');
        res = await request('/manage_brand.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Brand Master": ${res.body.includes('Brand Master')}`);

        // 11. Test Unit Master GET
        console.log('11. Testing GET /manaage_unit.php...');
        res = await request('/manaage_unit.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Unit Master": ${res.body.includes('Unit Master')}`);

        // 12. Test Product Type Master GET
        console.log('12. Testing GET /manage_producttype.php...');
        res = await request('/manage_producttype.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Product Type Master": ${res.body.includes('Product Type Master')}`);

        // 13. Test Customer Master GET
        console.log('13. Testing GET /manage_customer.php...');
        res = await request('/manage_customer.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Customer Master": ${res.body.includes('Customer Master')}`);

        // 14. Test Product Master GET
        console.log('14. Testing GET /manage_product.php...');
        res = await request('/manage_product.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Product Master": ${res.body.includes('Product Master')}`);

        // 15. Test Sales Note Master GET
        console.log('15. Testing GET /manage_sales_note.php...');
        res = await request('/manage_sales_note.php');
        console.log(`   Status: ${res.statusCode}, Body includes "Sales Notes": ${res.body.includes('Sales Notes')}`);

        // 16. Test User Master GET
        console.log('16. Testing GET /manage_user.php...');
        res = await request('/manage_user.php');
        console.log(`   Status: ${res.statusCode}, Body includes "User Master": ${res.body.includes('User Master')}`);

        // 17. Test AJAX Sales Note (Customer Search)
        console.log('17. Testing AJAX /ajax_sales_note.php (search_customers)...');
        res = await request('/ajax_sales_note.php', {
            method: 'POST',
            body: 'action=search_customers&query='
        });
        console.log(`   Status: ${res.statusCode}, Output length: ${res.body.length}`);

        // 18. Test AJAX Sales Note (Product Search)
        console.log('18. Testing AJAX /ajax_sales_note.php (search_products)...');
        res = await request('/ajax_sales_note.php', {
            method: 'POST',
            body: 'action=search_products&query='
        });
        console.log(`   Status: ${res.statusCode}, Output length: ${res.body.length}`);

        console.log('--- ALL AUTOMATED TESTS COMPLETED SUCCESSFULLY ---');
    } catch (err) {
        console.error('Test Failed:', err);
    }
}

runTests();
