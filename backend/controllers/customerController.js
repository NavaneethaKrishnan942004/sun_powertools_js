const pool = require('../config/db');
const { generateCustomerCode, getCustomerFinancialSummary, customerHasTransactions } = require('../utils/customerHelper');

// List customers
exports.manageCustomers = async (req, res) => {
    try {
        const { search = '', customer_type = '', credit_allowed = '', status = '', action, id } = req.query;

        // Handle Status Toggle Action (Activate / Deactivate)
        if (action && id && ['activate', 'deactivate'].includes(action)) {
            const toggleId = parseInt(id, 10);
            if (toggleId > 0) {
                const newStatus = (action === 'activate') ? 1 : 0;
                const updatedBy = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
                const updatedAt = new Date();

                await pool.query(
                    `UPDATE customer_master 
                     SET status = ?, updated_by = ?, updated_at = ? 
                     WHERE id = ?`,
                    [newStatus, updatedBy, updatedAt, toggleId]
                );

                const statusText = (newStatus === 1) ? 'activated' : 'deactivated';
                return res.redirect(`/manage_customer.php?success=${encodeURIComponent(`Customer record ${statusText} successfully.`)}`);
            }
        }

        const page = Math.max(1, parseInt(req.query.page || 1, 10));
        const limit = 10;
        const offset = (page - 1) * limit;

        let whereSql = ' WHERE 1=1';
        const params = [];

        if (search.trim() !== '') {
            whereSql += ` AND (
                cm.customer_code LIKE ? 
                OR cm.customer_name LIKE ? 
                OR cm.company_name LIKE ? 
                OR cm.mobile_number LIKE ?
            )`;
            const searchPattern = `%${search.trim()}%`;
            params.push(searchPattern, searchPattern, searchPattern, searchPattern);
        }

        if (customer_type !== '' && ['Individual', 'Business'].includes(customer_type)) {
            whereSql += ` AND cm.customer_type = ?`;
            params.push(customer_type);
        }

        if (credit_allowed !== '' && ['0', '1'].includes(credit_allowed)) {
            whereSql += ` AND cm.credit_allowed = ?`;
            params.push(parseInt(credit_allowed, 10));
        }

        if (status !== '' && ['0', '1'].includes(status)) {
            whereSql += ` AND cm.status = ?`;
            params.push(parseInt(status, 10));
        }

        // Count total matching records
        const countSql = `SELECT COUNT(*) AS total FROM customer_master cm ${whereSql}`;
        const [countRows] = await pool.query(countSql, params);
        const totalRecords = countRows && countRows.length > 0 ? countRows[0].total : 0;
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

        // Fetch paginated records
        const dataSql = `
            SELECT 
                cm.*,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM customer_master cm
            LEFT JOIN user_master creator ON creator.id = cm.created_by
            LEFT JOIN user_master updater ON updater.id = cm.updated_by
            ${whereSql}
            ORDER BY cm.id DESC
            LIMIT ? OFFSET ?
        `;

        const [customers] = await pool.query(dataSql, [...params, limit, offset]);

        for (const c of customers) {
            c.summary = await getCustomerFinancialSummary(pool, c.id);
        }

        res.render('manage_customer', {
            pageTitle: 'Customer Master',
            customers,
            search,
            customerTypeFilter: customer_type,
            creditAllowedFilter: credit_allowed,
            statusFilter: status,
            page,
            limit,
            totalRecords,
            totalPages,
            queryParams: req.query
        });
    } catch (err) {
        console.error('manageCustomers error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Show create customer form
exports.createCustomerForm = async (req, res) => {
    res.render('create_customer', {
        pageTitle: 'Create Customer',
        formData: {
            customer_name: '',
            customer_type: 'Individual',
            company_name: '',
            mobile_number: '',
            alternate_mobile_number: '',
            email: '',
            gst_number: '',
            address: '',
            area: '',
            city: '',
            district: '',
            state: '',
            pincode: '',
            billing_address: '',
            shipping_address: '',
            same_as_billing: 0,
            credit_allowed: 0,
            credit_limit: '0.00',
            payment_terms: 'Immediate',
            opening_balance: '0.00',
            opening_balance_type: 'Debit',
            status: 1
        },
        errors: [],
        customerNameError: '',
        customerTypeError: '',
        companyNameError: '',
        mobileNumberError: '',
        emailError: '',
        gstError: '',
        creditLimitError: '',
        paymentTermsError: '',
        openingBalanceError: ''
    });
};

// Process create customer
exports.createCustomer = async (req, res) => {
    try {
        const body = req.body || {};
        const formData = {
            customer_name: (body.customer_name || '').trim(),
            customer_type: ['Individual', 'Business'].includes(body.customer_type) ? body.customer_type : 'Individual',
            company_name: (body.company_name || '').trim(),
            mobile_number: (body.mobile_number || '').trim(),
            alternate_mobile_number: (body.alternate_mobile_number || '').trim(),
            email: (body.email || '').trim(),
            gst_number: (body.gst_number || '').trim().toUpperCase(),
            address: (body.address || '').trim(),
            area: (body.area || '').trim(),
            city: (body.city || '').trim(),
            district: (body.district || '').trim(),
            state: (body.state || '').trim(),
            pincode: (body.pincode || '').trim(),
            billing_address: (body.billing_address || '').trim(),
            shipping_address: (body.shipping_address || '').trim(),
            same_as_billing: body.same_as_billing ? 1 : 0,
            credit_allowed: body.credit_allowed ? 1 : 0,
            credit_limit: (body.credit_limit || '0.00').trim(),
            payment_terms: (body.payment_terms || 'Immediate').trim(),
            opening_balance: (body.opening_balance || '0.00').trim(),
            opening_balance_type: ['Debit', 'Credit'].includes(body.opening_balance_type) ? body.opening_balance_type : 'Debit',
            status: body.status !== undefined ? 1 : 0
        };

        if (formData.same_as_billing) {
            formData.shipping_address = formData.billing_address;
        }

        const submitAction = body.submit_action || 'save';
        const errors = [];
        let customerNameError = '';
        let customerTypeError = '';
        let companyNameError = '';
        let mobileNumberError = '';
        let emailError = '';
        let gstError = '';
        let creditLimitError = '';
        let paymentTermsError = '';
        let openingBalanceError = '';

        // Validation
        if (formData.customer_name === '') {
            customerNameError = 'Customer Name is required.';
            errors.push(customerNameError);
        } else if (formData.customer_name.length < 2) {
            customerNameError = 'Customer Name must be at least 2 characters.';
            errors.push(customerNameError);
        }

        if (formData.customer_type === 'Business' && formData.company_name === '') {
            companyNameError = 'Company Name is required when Customer Type is Business.';
            errors.push(companyNameError);
        }

        if (formData.mobile_number === '') {
            mobileNumberError = 'Mobile Number is required.';
            errors.push(mobileNumberError);
        } else if (!/^[0-9+\-\s]{7,20}$/.test(formData.mobile_number)) {
            mobileNumberError = 'Please enter a valid mobile number (7-20 digits).';
            errors.push(mobileNumberError);
        }

        if (formData.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            emailError = 'Please enter a valid email address.';
            errors.push(emailError);
        }

        if (formData.gst_number !== '' && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(formData.gst_number)) {
            gstError = 'Invalid GST format (e.g. 22AAAAA0000A1Z5).';
            errors.push(gstError);
        }

        if (formData.credit_allowed) {
            if (isNaN(Number(formData.credit_limit)) || Number(formData.credit_limit) < 0) {
                creditLimitError = 'Credit Limit must be a valid positive amount.';
                errors.push(creditLimitError);
            }
            if (formData.payment_terms === '') {
                paymentTermsError = 'Payment Terms are required when credit is allowed.';
                errors.push(paymentTermsError);
            }
        } else {
            formData.credit_limit = '0.00';
        }

        if (isNaN(Number(formData.opening_balance)) || Number(formData.opening_balance) < 0) {
            openingBalanceError = 'Opening Balance must be a valid non-negative number.';
            errors.push(openingBalanceError);
        }

        if (errors.length > 0) {
            const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || body.ajax === '1';
            if (isAjax) {
                return res.status(400).json({ success: false, errors, message: errors.join(', ') });
            }
            return res.render('create_customer', {
                pageTitle: 'Create Customer',
                formData,
                errors,
                customerNameError,
                customerTypeError,
                companyNameError,
                mobileNumberError,
                emailError,
                gstError,
                creditLimitError,
                paymentTermsError,
                openingBalanceError
            });
        }

        const customerCode = await generateCustomerCode();
        const createdBy = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
        const createdAt = new Date();

        const [insertResult] = await pool.query(
            `INSERT INTO customer_master (
                customer_code,
                customer_name,
                customer_type,
                company_name,
                mobile_number,
                alternate_mobile_number,
                email,
                gst_number,
                address,
                area,
                city,
                district,
                state,
                pincode,
                billing_address,
                shipping_address,
                credit_allowed,
                credit_limit,
                payment_terms,
                opening_balance,
                opening_balance_type,
                status,
                created_by,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                customerCode,
                formData.customer_name,
                formData.customer_type,
                formData.company_name || null,
                formData.mobile_number,
                formData.alternate_mobile_number || null,
                formData.email || null,
                formData.gst_number || null,
                formData.address || null,
                formData.area || null,
                formData.city || null,
                formData.district || null,
                formData.state || null,
                formData.pincode || null,
                formData.billing_address || null,
                formData.shipping_address || null,
                formData.credit_allowed,
                parseFloat(formData.credit_limit),
                formData.payment_terms || null,
                parseFloat(formData.opening_balance),
                formData.opening_balance_type,
                formData.status,
                createdBy,
                createdAt
            ]
        );

        const successMsg = `Customer ${customerCode} created successfully.`;

        const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || body.ajax === '1';
        if (isAjax) {
            const newCustId = insertResult.insertId;
            return res.json({
                success: true,
                message: successMsg,
                customer: {
                    id: newCustId,
                    customer_code: customerCode,
                    customer_name: formData.customer_name,
                    company_name: formData.company_name || '',
                    mobile_number: formData.mobile_number,
                    credit_allowed: formData.credit_allowed,
                    credit_limit: parseFloat(formData.credit_limit || 0),
                    current_outstanding: parseFloat(formData.opening_balance || 0),
                    available_credit: formData.credit_allowed ? Math.max(0, parseFloat(formData.credit_limit || 0) - parseFloat(formData.opening_balance || 0)) : 0,
                    address: formData.address || '',
                    payment_terms: formData.payment_terms || 'Immediate'
                }
            });
        }

        if (submitAction === 'save_and_add') {
            return res.redirect(`/create_customer.php?success=${encodeURIComponent(successMsg)}`);
        } else {
            return res.redirect(`/manage_customer.php?success=${encodeURIComponent(successMsg)}`);
        }
    } catch (err) {
        console.error('createCustomer error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Show edit customer form
exports.editCustomerForm = async (req, res) => {
    try {
        const id = parseInt(req.params.id || req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect(`/manage_customer.php?error=${encodeURIComponent('Invalid customer ID.')}`);
        }

        const [rows] = await pool.query(
            `SELECT 
                cm.*,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM customer_master cm
            LEFT JOIN user_master creator ON creator.id = cm.created_by
            LEFT JOIN user_master updater ON updater.id = cm.updated_by
            WHERE cm.id = ?
            LIMIT 1`,
            [id]
        );

        if (!rows.length) {
            return res.redirect(`/manage_customer.php?error=${encodeURIComponent('Customer record not found.')}`);
        }

        const customer = rows[0];
        const formData = {
            customer_name: customer.customer_name,
            customer_type: customer.customer_type,
            company_name: customer.company_name || '',
            mobile_number: customer.mobile_number,
            alternate_mobile_number: customer.alternate_mobile_number || '',
            email: customer.email || '',
            gst_number: customer.gst_number || '',
            address: customer.address || '',
            area: customer.area || '',
            city: customer.city || '',
            district: customer.district || '',
            state: customer.state || '',
            pincode: customer.pincode || '',
            billing_address: customer.billing_address || '',
            shipping_address: customer.shipping_address || '',
            same_as_billing: (customer.billing_address && customer.billing_address === customer.shipping_address) ? 1 : 0,
            credit_allowed: parseInt(customer.credit_allowed, 10),
            credit_limit: customer.credit_limit,
            payment_terms: customer.payment_terms || 'Immediate',
            status: parseInt(customer.status, 10)
        };

        res.render('edit_customer', {
            pageTitle: 'Edit Customer',
            id,
            customer,
            formData,
            errors: [],
            customerNameError: '',
            customerTypeError: '',
            companyNameError: '',
            mobileNumberError: '',
            emailError: '',
            gstError: '',
            creditLimitError: '',
            paymentTermsError: ''
        });
    } catch (err) {
        console.error('editCustomerForm error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Process edit customer
exports.editCustomer = async (req, res) => {
    try {
        const id = parseInt(req.params.id || req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect(`/manage_customer.php?error=${encodeURIComponent('Invalid customer ID.')}`);
        }

        const [rows] = await pool.query(
            `SELECT 
                cm.*,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM customer_master cm
            LEFT JOIN user_master creator ON creator.id = cm.created_by
            LEFT JOIN user_master updater ON updater.id = cm.updated_by
            WHERE cm.id = ?
            LIMIT 1`,
            [id]
        );

        if (!rows.length) {
            return res.redirect(`/manage_customer.php?error=${encodeURIComponent('Customer record not found.')}`);
        }

        const customer = rows[0];
        const body = req.body || {};
        const formData = {
            customer_name: (body.customer_name || '').trim(),
            customer_type: ['Individual', 'Business'].includes(body.customer_type) ? body.customer_type : 'Individual',
            company_name: (body.company_name || '').trim(),
            mobile_number: (body.mobile_number || '').trim(),
            alternate_mobile_number: (body.alternate_mobile_number || '').trim(),
            email: (body.email || '').trim(),
            gst_number: (body.gst_number || '').trim().toUpperCase(),
            address: (body.address || '').trim(),
            area: (body.area || '').trim(),
            city: (body.city || '').trim(),
            district: (body.district || '').trim(),
            state: (body.state || '').trim(),
            pincode: (body.pincode || '').trim(),
            billing_address: (body.billing_address || '').trim(),
            shipping_address: (body.shipping_address || '').trim(),
            same_as_billing: body.same_as_billing ? 1 : 0,
            credit_allowed: body.credit_allowed ? 1 : 0,
            credit_limit: (body.credit_limit || '0.00').trim(),
            payment_terms: (body.payment_terms || 'Immediate').trim(),
            status: body.status !== undefined ? 1 : 0
        };

        if (formData.same_as_billing) {
            formData.shipping_address = formData.billing_address;
        }

        const errors = [];
        let customerNameError = '';
        let customerTypeError = '';
        let companyNameError = '';
        let mobileNumberError = '';
        let emailError = '';
        let gstError = '';
        let creditLimitError = '';
        let paymentTermsError = '';

        // Validation
        if (formData.customer_name === '') {
            customerNameError = 'Customer Name is required.';
            errors.push(customerNameError);
        } else if (formData.customer_name.length < 2) {
            customerNameError = 'Customer Name must be at least 2 characters.';
            errors.push(customerNameError);
        }

        if (formData.customer_type === 'Business' && formData.company_name === '') {
            companyNameError = 'Company Name is required when Customer Type is Business.';
            errors.push(companyNameError);
        }

        if (formData.mobile_number === '') {
            mobileNumberError = 'Mobile Number is required.';
            errors.push(mobileNumberError);
        } else if (!/^[0-9+\-\s]{7,20}$/.test(formData.mobile_number)) {
            mobileNumberError = 'Please enter a valid mobile number (7-20 digits).';
            errors.push(mobileNumberError);
        }

        if (formData.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            emailError = 'Please enter a valid email address.';
            errors.push(emailError);
        }

        if (formData.gst_number !== '' && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(formData.gst_number)) {
            gstError = 'Invalid GST format (e.g. 22AAAAA0000A1Z5).';
            errors.push(gstError);
        }

        if (formData.credit_allowed) {
            if (isNaN(Number(formData.credit_limit)) || Number(formData.credit_limit) < 0) {
                creditLimitError = 'Credit Limit must be a valid positive amount.';
                errors.push(creditLimitError);
            }
            if (formData.payment_terms === '') {
                paymentTermsError = 'Payment Terms are required when credit is allowed.';
                errors.push(paymentTermsError);
            }
        } else {
            formData.credit_limit = '0.00';
        }

        if (errors.length > 0) {
            return res.render('edit_customer', {
                pageTitle: 'Edit Customer',
                id,
                customer,
                formData,
                errors,
                customerNameError,
                customerTypeError,
                companyNameError,
                mobileNumberError,
                emailError,
                gstError,
                creditLimitError,
                paymentTermsError
            });
        }

        const updatedBy = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
        const updatedAt = new Date();

        await pool.query(
            `UPDATE customer_master SET
                customer_name = ?,
                customer_type = ?,
                company_name = ?,
                mobile_number = ?,
                alternate_mobile_number = ?,
                email = ?,
                gst_number = ?,
                address = ?,
                area = ?,
                city = ?,
                district = ?,
                state = ?,
                pincode = ?,
                billing_address = ?,
                shipping_address = ?,
                credit_allowed = ?,
                credit_limit = ?,
                payment_terms = ?,
                status = ?,
                updated_by = ?,
                updated_at = ?
            WHERE id = ?`,
            [
                formData.customer_name,
                formData.customer_type,
                formData.company_name || null,
                formData.mobile_number,
                formData.alternate_mobile_number || null,
                formData.email || null,
                formData.gst_number || null,
                formData.address || null,
                formData.area || null,
                formData.city || null,
                formData.district || null,
                formData.state || null,
                formData.pincode || null,
                formData.billing_address || null,
                formData.shipping_address || null,
                formData.credit_allowed,
                parseFloat(formData.credit_limit),
                formData.payment_terms || null,
                formData.status,
                updatedBy,
                updatedAt,
                id
            ]
        );

        return res.redirect(`/manage_customer.php?success=${encodeURIComponent(`Customer ${customer.customer_code} updated successfully.`)}`);
    } catch (err) {
        console.error('editCustomer error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// View single customer
exports.viewCustomer = async (req, res) => {
    try {
        const id = parseInt(req.params.id || req.query.id || 0, 10);
        if (id <= 0) {
            return res.redirect(`/manage_customer.php?error=${encodeURIComponent('Invalid customer ID.')}`);
        }

        const [rows] = await pool.query(
            `SELECT 
                cm.*,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM customer_master cm
            LEFT JOIN user_master creator ON creator.id = cm.created_by
            LEFT JOIN user_master updater ON updater.id = cm.updated_by
            WHERE cm.id = ?
            LIMIT 1`,
            [id]
        );

        if (!rows.length) {
            return res.render('view_customer_not_found', {
                pageTitle: 'View Customer'
            });
        }

        const customer = rows[0];
        const summary = await getCustomerFinancialSummary(id, customer);

        let salesTransactions = [];
        let rentalTransactions = [];
        let paymentTransactions = [];
        let adjustmentTransactions = [];

        try {
            const [allTransactions] = await pool.query(
                `SELECT ct.*, creator.user_name AS created_by_name
                FROM customer_transactions ct
                LEFT JOIN user_master creator ON creator.id = ct.created_by
                WHERE ct.customer_id = ?
                ORDER BY ct.transaction_date DESC`,
                [id]
            );

            for (const t of allTransactions) {
                const type = (t.transaction_type || '').toLowerCase();
                if (type === 'sale') {
                    salesTransactions.push(t);
                } else if (type === 'rental') {
                    rentalTransactions.push(t);
                } else if (type === 'payment') {
                    paymentTransactions.push(t);
                } else if (type === 'return' || type === 'adjustment') {
                    adjustmentTransactions.push(t);
                }
            }
        } catch (e) {
            // Graceful fallback
        }

        res.render('view_customer', {
            pageTitle: 'View Customer',
            customer,
            summary,
            salesTransactions,
            rentalTransactions,
            paymentTransactions,
            adjustmentTransactions
        });
    } catch (err) {
        console.error('viewCustomer error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};
