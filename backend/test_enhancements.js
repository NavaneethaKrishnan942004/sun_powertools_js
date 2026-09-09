const pool = require('./config/db');
const fs = require('fs');
const path = require('path');
const salesNoteController = require('./controllers/salesNoteController');

async function runTests() {
    console.log('====================================================');
    console.log('Starting Test Suite: Responsive & Sales Note Enhancements');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(cond, msg) {
        if (cond) {
            console.log(`✅ PASS: ${msg}`);
            passed++;
        } else {
            console.error(`❌ FAIL: ${msg}`);
            failed++;
        }
    }

    try {
        // TEST 1: Check Database Schema for sales_notes.customer_id
        console.log('--- Test 1: DB Schema Verification ---');
        const [colRows] = await pool.query(`
            SELECT IS_NULLABLE, COLUMN_TYPE 
            FROM information_schema.COLUMNS 
            WHERE TABLE_SCHEMA = 'powertools_db' 
              AND TABLE_NAME = 'sales_notes' 
              AND COLUMN_NAME = 'customer_id'
        `);
        assert(colRows.length > 0 && colRows[0].IS_NULLABLE === 'YES', 'sales_notes.customer_id is nullable (DEFAULT NULL)');

        // TEST 2: Check CSS for Sticky Action Column and Wide Action Column
        console.log('\n--- Test 2: CSS Styles Verification ---');
        const cssContent = fs.readFileSync(path.join(__dirname, '../assets/css/style.css'), 'utf8');
        assert(cssContent.includes('.action-column-wide'), 'style.css includes .action-column-wide');
        assert(cssContent.includes('position: sticky !important;') && cssContent.includes('right: 0 !important;'), 'style.css sets position: sticky and right: 0 for .action-column');
        assert(cssContent.includes('.file-preview-card') && cssContent.includes('.modal-preview-img'), 'style.css includes file preview and modal preview classes');

        // TEST 3: Check Manage Views for action-column-wide
        console.log('\n--- Test 3: Manage Tables Action Column Verification ---');
        const manageSalesContent = fs.readFileSync(path.join(__dirname, 'views/manage_sales_note.ejs'), 'utf8');
        assert(manageSalesContent.includes('action-column-wide'), 'manage_sales_note.ejs uses action-column-wide');
        const manageRentalContent = fs.readFileSync(path.join(__dirname, 'views/manage_rental.ejs'), 'utf8');
        assert(manageRentalContent.includes('action-column-wide'), 'manage_rental.ejs uses action-column-wide');

        // TEST 4: Check Footer & JS for File Preview Modal
        console.log('\n--- Test 4: File Upload Preview & Modal Verification ---');
        const footerContent = fs.readFileSync(path.join(__dirname, 'views/includes/footer.ejs'), 'utf8');
        assert(footerContent.includes('id="filePreviewModal"'), 'footer.ejs includes #filePreviewModal');
        const mainJsContent = fs.readFileSync(path.join(__dirname, '../assets/js/main.js'), 'utf8');
        assert(mainJsContent.includes('openFilePreview') && mainJsContent.includes('file-preview-zone'), 'main.js includes universal openFilePreview and file preview handler');

        // TEST 5: Check create_sales_note.ejs for single sales_datetime and Sale vs Credit Sale
        console.log('\n--- Test 5: Create Sales Note View Verification ---');
        const createSalesView = fs.readFileSync(path.join(__dirname, 'views/create_sales_note.ejs'), 'utf8');
        assert(createSalesView.includes('name="sales_datetime"'), 'create_sales_note.ejs includes single sales_datetime field');
        assert(createSalesView.includes('type="datetime-local"'), 'sales_datetime uses type="datetime-local"');
        assert(createSalesView.includes('name="sale_type"'), 'create_sales_note.ejs includes sale_type selector');
        assert(createSalesView.includes('id="saleTypeNormal"') && createSalesView.includes('id="saleTypeCredit"'), 'create_sales_note.ejs has Normal Sale and Credit Sale options');
        assert(createSalesView.includes('id="amountReceivedInput"') && createSalesView.includes('id="dispCreditAmount"'), 'create_sales_note.ejs has Amount Received and Credit Amount displays');
        assert(createSalesView.includes('Walk-in / Retail Customer'), 'create_sales_note.ejs includes Walk-in / Retail customer option');

        // TEST 6: Controller Tests - Create Sales Note Scenarios
        console.log('\n--- Test 6: Sales Note Controller Unit / Logic Tests ---');

        // Get an active product with stock
        const [products] = await pool.query('SELECT id, product_code, product_name, selling_price, stock_quantity FROM product_master WHERE status = 1 AND sale_available = 1 AND stock_quantity >= 5 LIMIT 1');
        assert(products.length > 0, `Active product found for testing (ID: ${products[0]?.id}, Code: ${products[0]?.product_code})`);
        const testProduct = products[0];

        // Get an active customer with credit allowed
        const [customers] = await pool.query('SELECT id, customer_code, customer_name, credit_allowed, credit_limit FROM customer_master WHERE status = 1 AND credit_allowed = 1 LIMIT 1');
        assert(customers.length > 0, `Active customer found for testing (ID: ${customers[0]?.id}, Code: ${customers[0]?.customer_code})`);
        const testCustomer = customers[0];

        // 6A: Normal Sale without customer (Walk-in)
        console.log('\n--> Testing 6A: Normal Sale without customer (Walk-in Customer)...');
        let renderedTemplate = null;
        let renderedData = null;
        let redirectUrl = null;

        const mockReqWalkin = {
            body: {
                sale_type: 'sale',
                customer_id: '',
                sales_datetime: '2026-09-09T14:30',
                payment_type: 'Cash',
                items: [
                    { product_id: testProduct.id, quantity: 1, discount: 0, tax_percent: 0 }
                ]
            },
            session: { user_id: 1 }
        };

        const mockResWalkin = {
            render: (tpl, data) => { renderedTemplate = tpl; renderedData = data; },
            redirect: (url) => { redirectUrl = url; },
            status: () => mockResWalkin,
            send: (msg) => console.log('Response send:', msg)
        };

        await salesNoteController.createSalesNote(mockReqWalkin, mockResWalkin);
        assert(redirectUrl && redirectUrl.includes('view_sales_note.php'), `Walk-in Normal Sale created successfully (redirected to ${redirectUrl})`);

        if (redirectUrl) {
            const snIdMatch = redirectUrl.match(/id=(\d+)/);
            if (snIdMatch) {
                const snId = parseInt(snIdMatch[1], 10);
                const [snRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [snId]);
                assert(snRows.length > 0, 'Sales note record exists in DB');
                assert(snRows[0].customer_id === null, 'Walk-in sales note customer_id is null');
                assert(Number(snRows[0].status) === 1, 'Sales note status is 1 (completed)');
                assert(parseFloat(snRows[0].credit_amount) === 0, 'Walk-in sales note credit_amount is 0.00');
                assert(parseFloat(snRows[0].paid_amount) === parseFloat(snRows[0].total_amount), 'Walk-in sales note paid_amount equals total_amount');
                const dateStr = snRows[0].sales_date instanceof Date ? snRows[0].sales_date.toISOString().split('T')[0] : String(snRows[0].sales_date).split('T')[0];
                assert(dateStr.includes('2026-09-09'), 'sales_date parsed accurately from sales_datetime');
                assert(snRows[0].sales_time.substring(0, 5) === '14:30', 'sales_time parsed accurately from sales_datetime');

                // Clean up test walk-in sale
                await pool.query('UPDATE product_master SET stock_quantity = stock_quantity + 1 WHERE id = ?', [testProduct.id]);
                await pool.query('DELETE FROM sales_note_items WHERE sales_note_id = ?', [snId]);
                await pool.query('DELETE FROM sales_notes WHERE id = ?', [snId]);
            }
        }

        // 6B: Credit Sale WITHOUT customer -> Must fail validation
        console.log('\n--> Testing 6B: Credit Sale WITHOUT customer (Should fail validation)...');
        renderedTemplate = null;
        renderedData = null;
        redirectUrl = null;

        const mockReqCreditNoCust = {
            body: {
                sale_type: 'credit',
                customer_id: '',
                sales_datetime: '2026-09-09T14:30',
                amount_received: '0.00',
                items: [
                    { product_id: testProduct.id, quantity: 1, discount: 0, tax_percent: 0 }
                ]
            },
            session: { user_id: 1 }
        };

        const mockResCreditNoCust = {
            render: (tpl, data) => { renderedTemplate = tpl; renderedData = data; },
            redirect: (url) => { redirectUrl = url; }
        };

        await salesNoteController.createSalesNote(mockReqCreditNoCust, mockResCreditNoCust);
        assert(renderedTemplate === 'create_sales_note', 'Credit sale without customer re-rendered create_sales_note form');
        assert(renderedData && renderedData.errors && renderedData.errors.some(e => e.includes('Customer selection is required for Credit Sale')), 'Validation error returned: Customer selection is required for Credit Sale');

        // 6C: Credit Sale with Amount Received > Grand Total -> Must fail validation
        console.log('\n--> Testing 6C: Credit Sale with Amount Received > Grand Total (Should fail validation)...');
        renderedTemplate = null;
        renderedData = null;
        redirectUrl = null;

        const mockReqExcessiveReceived = {
            body: {
                sale_type: 'credit',
                customer_id: testCustomer.id,
                sales_datetime: '2026-09-09T14:30',
                amount_received: '999999.00',
                items: [
                    { product_id: testProduct.id, quantity: 1, discount: 0, tax_percent: 0 }
                ]
            },
            session: { user_id: 1 }
        };

        const mockResExcessiveReceived = {
            render: (tpl, data) => { renderedTemplate = tpl; renderedData = data; },
            redirect: (url) => { redirectUrl = url; }
        };

        await salesNoteController.createSalesNote(mockReqExcessiveReceived, mockResExcessiveReceived);
        assert(renderedTemplate === 'create_sales_note', 'Credit sale with excessive amount received re-rendered form');
        assert(renderedData && renderedData.errors && renderedData.errors.some(e => e.includes('cannot be greater than Grand Total')), 'Validation error returned: Amount Received cannot be greater than Grand Total');

        // 6D: Credit Sale with Customer and Partial Payment -> Must succeed & update ledger
        console.log('\n--> Testing 6D: Credit Sale with Customer and Partial Payment...');
        renderedTemplate = null;
        renderedData = null;
        redirectUrl = null;

        const itemRate = parseFloat(testProduct.selling_price);
        const partialReceived = Math.max(0, itemRate - 10);
        const expectedCredit = itemRate - partialReceived;

        const mockReqCreditValid = {
            body: {
                sale_type: 'credit',
                customer_id: testCustomer.id,
                sales_datetime: '2026-09-09T15:45',
                amount_received: partialReceived.toString(),
                credit_override: '1',
                items: [
                    { product_id: testProduct.id, quantity: 1, discount: 0, tax_percent: 0 }
                ]
            },
            session: { user_id: 1 }
        };

        const mockResCreditValid = {
            render: (tpl, data) => { renderedTemplate = tpl; renderedData = data; },
            redirect: (url) => { redirectUrl = url; }
        };

        await salesNoteController.createSalesNote(mockReqCreditValid, mockResCreditValid);
        assert(redirectUrl && redirectUrl.includes('view_sales_note.php'), `Valid Credit Sale created successfully (redirected to ${redirectUrl})`);

        if (redirectUrl) {
            const snIdMatch = redirectUrl.match(/id=(\d+)/);
            if (snIdMatch) {
                const snId = parseInt(snIdMatch[1], 10);
                const [snRows] = await pool.query('SELECT * FROM sales_notes WHERE id = ?', [snId]);
                assert(snRows.length > 0, 'Credit Sales note record exists in DB');
                assert(snRows[0].customer_id === testCustomer.id, 'Credit Sales note linked to correct customer_id');
                assert(Number(snRows[0].status) === 1, 'Credit Sales note status is 1 (completed)');
                assert(Math.abs(parseFloat(snRows[0].credit_amount) - expectedCredit) < 0.01, `Credit amount auto-calculated correctly (₹${parseFloat(snRows[0].credit_amount).toFixed(2)})`);
                assert(Math.abs(parseFloat(snRows[0].paid_amount) - partialReceived) < 0.01, `Paid amount recorded correctly (₹${parseFloat(snRows[0].paid_amount).toFixed(2)})`);

                const [txRows] = await pool.query('SELECT * FROM customer_transactions WHERE reference_number = ?', [snRows[0].sales_note_no]);
                assert(txRows.length > 0, 'Customer financial transaction logged in customer_transactions');
                if (txRows.length > 0) {
                    console.log('   [DEBUG] txRows[0]:', txRows[0]);
                    console.log('   [DEBUG] expectedCredit:', expectedCredit, 'actual debit_amount:', txRows[0].debit_amount);
                    assert(Math.abs(parseFloat(txRows[0].debit_amount) - expectedCredit) < 0.01, 'Customer ledger debited with exact credit amount');
                }

                // Clean up test credit sale
                await pool.query('UPDATE product_master SET stock_quantity = stock_quantity + 1 WHERE id = ?', [testProduct.id]);
                await pool.query('DELETE FROM customer_transactions WHERE reference_number = ?', [snRows[0].sales_note_no]);
                await pool.query('DELETE FROM sales_note_items WHERE sales_note_id = ?', [snId]);
                await pool.query('DELETE FROM sales_notes WHERE id = ?', [snId]);
            }
        }

    } catch (e) {
        console.error('Test execution error:', e);
        failed++;
    } finally {
        console.log('\n====================================================');
        console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
        console.log('====================================================');
        await pool.end();
        process.exit(failed > 0 ? 1 : 0);
    }
}

runTests();
