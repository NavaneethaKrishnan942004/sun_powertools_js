const pool = require('../config/db');
const { getCustomerFinancialSummary } = require('../utils/customerHelper');
const { generateSalesNoteNumber, evaluateCreditStatus, getSalesAnalytics } = require('../utils/salesNoteHelper');

// List sales notes with analytics & pagination
exports.manageSalesNotes = async (req, res) => {
    try {
        const { action, id } = req.query;

        // Handle Cancellation / Delete
        if (action === 'delete' && id) {
            const deleteId = parseInt(id, 10);
            if (deleteId > 0) {
                const conn = await pool.getConnection();
                try {
                    await conn.beginTransaction();

                    const [sales] = await conn.query(
                        `SELECT id, sales_note_no, customer_id, total_amount, credit_amount, status 
                        FROM sales_notes 
                        WHERE id = ? 
                        LIMIT 1 
                        FOR UPDATE`,
                        [deleteId]
                    );

                    if (!sales.length) {
                        throw new Error('Sales Note record not found.');
                    }
                    const sale = sales[0];

                    if (Number(sale.status) === 0) {
                        throw new Error('Sales Note is already cancelled.');
                    }

                    // 1. Restore product stock
                    const [items] = await conn.query(
                        `SELECT product_id, quantity 
                        FROM sales_note_items 
                        WHERE sales_note_id = ?`,
                        [deleteId]
                    );

                    for (const item of items) {
                        await conn.query(
                            `UPDATE product_master 
                            SET stock_quantity = stock_quantity + ? 
                            WHERE id = ?`,
                            [parseFloat(item.quantity), parseInt(item.product_id, 10)]
                        );
                    }

                    // 2. Remove or reverse customer financial transaction
                    await conn.query(
                        `DELETE FROM customer_transactions 
                        WHERE customer_id = ? 
                          AND reference_number = ? 
                          AND transaction_type = 'sale'`,
                        [parseInt(sale.customer_id, 10), sale.sales_note_no]
                    );

                    // 3. Mark sales note as cancelled
                    const userId = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
                    await conn.query(
                        `UPDATE sales_notes 
                        SET status = 0, 
                            updated_by = ?, 
                            updated_at = NOW() 
                        WHERE id = ?`,
                        [userId, deleteId]
                    );

                    await conn.commit();
                    conn.release();

                    return res.redirect(`/manage_sales_note.php?success=${encodeURIComponent(`Sales Note ${sale.sales_note_no} cancelled successfully. Product stock and customer ledger restored.`)}`);
                } catch (e) {
                    await conn.rollback();
                    conn.release();
                    console.error('manageSalesNotes cancellation error:', e);
                    return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Cancellation failed: ' + e.message)}`);
                }
            }
        }

        const search = (req.query.search || '').trim();
        const customerIdFilter = parseInt(req.query.customer_id || 0, 10);
        const paymentTypeFilter = (req.query.payment_type || '').trim();
        const creditStatusFilter = (req.query.credit_status || '').trim();
        const dateFrom = (req.query.date_from || '').trim();
        const dateTo = (req.query.date_to || '').trim();
        const statusFilter = req.query.status !== undefined ? req.query.status : '1';

        const page = Math.max(1, parseInt(req.query.page || 1, 10));
        const limit = 15;
        const offset = (page - 1) * limit;

        let whereSql = ' WHERE 1=1 ';
        const params = [];

        if (statusFilter !== '' && ['0', '1', 'all'].includes(statusFilter)) {
            if (statusFilter !== 'all') {
                whereSql += ' AND sn.status = ?';
                params.push(parseInt(statusFilter, 10));
            }
        } else {
            whereSql += ' AND sn.status = 1';
        }

        if (search !== '') {
            whereSql += ` AND (
                sn.sales_note_no LIKE ? 
                OR cm.customer_name LIKE ? 
                OR cm.customer_code LIKE ? 
                OR cm.mobile_number LIKE ?
            )`;
            const sp = `%${search}%`;
            params.push(sp, sp, sp, sp);
        }

        if (customerIdFilter > 0) {
            whereSql += ' AND sn.customer_id = ?';
            params.push(customerIdFilter);
        }

        if (paymentTypeFilter !== '') {
            whereSql += ' AND sn.payment_type = ?';
            params.push(paymentTypeFilter);
        }

        if (creditStatusFilter !== '') {
            whereSql += ' AND sn.credit_status = ?';
            params.push(creditStatusFilter);
        }

        if (dateFrom !== '') {
            whereSql += ' AND sn.sales_date >= ?';
            params.push(dateFrom);
        }

        if (dateTo !== '') {
            whereSql += ' AND sn.sales_date <= ?';
            params.push(dateTo);
        }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total 
            FROM sales_notes sn
            LEFT JOIN customer_master cm ON cm.id = sn.customer_id
            ${whereSql}`,
            params
        );
        const totalRecords = countRows[0].total;
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

        const dataSql = `
            SELECT 
                sn.*,
                cm.customer_code,
                cm.customer_name,
                cm.mobile_number,
                cm.credit_allowed AS cust_credit_allowed,
                cm.credit_limit AS cust_credit_limit,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM sales_notes sn
            LEFT JOIN customer_master cm ON cm.id = sn.customer_id
            LEFT JOIN user_master creator ON creator.id = sn.created_by
            LEFT JOIN user_master updater ON updater.id = sn.updated_by
            ${whereSql}
            ORDER BY sn.id DESC
            LIMIT ? OFFSET ?
        `;

        const [salesNotes] = await pool.query(dataSql, [...params, limit, offset]);

        const [customersList] = await pool.query(
            `SELECT id, customer_code, customer_name, mobile_number 
            FROM customer_master 
            WHERE status = 1 
            ORDER BY customer_name ASC`
        );

        const analytics = await getSalesAnalytics();

        res.render('manage_sales_note', {
            pageTitle: 'Sales Notes',
            salesNotes,
            customersList,
            analytics,
            search,
            customerIdFilter,
            paymentTypeFilter,
            creditStatusFilter,
            dateFrom,
            dateTo,
            statusFilter,
            page,
            limit,
            offset,
            totalRecords,
            totalPages,
            queryParams: req.query
        });
    } catch (err) {
        console.error('manageSalesNotes error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Show create sales note form
exports.createSalesNoteForm = async (req, res) => {
    try {
        const salesNoteNo = await generateSalesNoteNumber();
        const now = new Date();
        const salesDate = now.toISOString().split('T')[0];
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const salesTime = `${hours}:${minutes}`;

        const query = req.query || {};
        const body = req.body || {};
        const selectedCustomerId = parseInt(query.customer_id || body.customer_id || 0, 10);
        const paymentType = body.payment_type || 'Cash';
        const notes = (body.notes || '').trim();
        const creditOverride = body.credit_override ? 1 : 0;
        const otherCharges = body.other_charges ? parseFloat(body.other_charges) : 0.00;

        const [productsList] = await pool.query(`
            SELECT 
                p.id, p.product_code, p.product_name, p.selling_price, p.stock_quantity, 
                p.discount_allowed, p.discount_percent,
                c.category_name, b.brand_name, u.unit_name
            FROM product_master p
            LEFT JOIN category_master c ON c.id = p.category_id
            LEFT JOIN brand_master b ON b.id = p.brand_id
            LEFT JOIN unit_master u ON u.id = p.sale_unit
            WHERE p.status = 1 AND p.sale_available = 1
            ORDER BY p.product_name ASC
        `);

        const [customersList] = await pool.query(`
            SELECT id, customer_code, customer_name, mobile_number, credit_allowed, credit_limit 
            FROM customer_master 
            WHERE status = 1 
            ORDER BY customer_name ASC
        `);

        res.render('create_sales_note', {
            pageTitle: 'Create Sales Note',
            salesNoteNo,
            salesDate,
            salesTime,
            selectedCustomerId,
            paymentType,
            notes,
            creditOverride,
            otherCharges,
            productsList,
            customersList,
            errors: []
        });
    } catch (err) {
        console.error('createSalesNoteForm error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Process create sales note
exports.createSalesNote = async (req, res) => {
    try {
        const body = req.body || {};
        const customerId = parseInt(body.customer_id || 0, 10);
        const now = new Date();
        const salesDate = (body.sales_date || now.toISOString().split('T')[0]).trim();
        const salesTime = (body.sales_time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`).trim();
        const paymentType = (body.payment_type || 'Cash').trim();
        const itemsInput = body.items || [];
        const inputPaidAmount = body.paid_amount ? parseFloat(body.paid_amount) : 0.00;
        const inputOtherCharges = body.other_charges ? Math.max(0.00, parseFloat(body.other_charges)) : 0.00;
        const notes = (body.notes || '').trim();
        const creditOverride = body.credit_override ? 1 : 0;

        const errors = [];

        // 1. Validate Customer
        let customer = null;
        if (customerId <= 0) {
            errors.push('Please select a valid customer.');
        } else {
            const [custRows] = await pool.query('SELECT * FROM customer_master WHERE id = ? AND status = 1 LIMIT 1', [customerId]);
            if (!custRows.length) {
                errors.push('Selected customer does not exist or is inactive.');
            } else {
                customer = custRows[0];
            }
        }

        // 2. Validate Items
        if (!itemsInput || !Array.isArray(itemsInput) || itemsInput.length === 0) {
            errors.push('Please add at least one product to the sales note.');
        }

        const validatedItems = [];
        let serverSubtotal = 0.00;
        let serverTotalDiscount = 0.00;
        let serverTotalTax = 0.00;

        if (errors.length === 0) {
            for (let index = 0; index < itemsInput.length; index++) {
                const itemData = itemsInput[index];
                const productId = parseInt(itemData.product_id || 0, 10);
                const qty = parseFloat(itemData.quantity || 0);
                const itemDiscount = Math.max(0.00, parseFloat(itemData.discount || 0.00));
                const itemTaxPercent = Math.max(0.00, parseFloat(itemData.tax_percent || 0.00));

                if (productId <= 0 || qty <= 0) {
                    errors.push(`Item #${index + 1}: Product and quantity must be greater than zero.`);
                    continue;
                }

                const [prodRows] = await pool.query(
                    `SELECT p.*, u.unit_name 
                    FROM product_master p
                    LEFT JOIN unit_master u ON u.id = p.sale_unit
                    WHERE p.id = ? AND p.status = 1 AND p.sale_available = 1 
                    LIMIT 1`,
                    [productId]
                );

                if (!prodRows.length) {
                    errors.push(`Item #${index + 1}: Product is not available for sale.`);
                    continue;
                }
                const product = prodRows[0];

                const availableStock = parseFloat(product.stock_quantity || 0);
                if (qty > availableStock) {
                    errors.push(`Insufficient stock for '${product.product_name}'. Available: ${availableStock}, Requested: ${qty}.`);
                    continue;
                }

                const unitPrice = parseFloat(product.selling_price || 0.00);
                const lineSubtotal = qty * unitPrice;
                const lineDiscount = Math.min(lineSubtotal, itemDiscount);
                const taxableAmount = Math.max(0.00, lineSubtotal - lineDiscount);
                const lineTax = (taxableAmount * itemTaxPercent) / 100.0;
                const lineTotal = taxableAmount + lineTax;

                serverSubtotal += lineSubtotal;
                serverTotalDiscount += lineDiscount;
                serverTotalTax += lineTax;

                validatedItems.push({
                    product_id: product.id,
                    product_code: product.product_code,
                    product_name: product.product_name,
                    unit_name: product.unit_name || 'Unit',
                    quantity: qty,
                    unit_price: unitPrice,
                    discount: lineDiscount,
                    tax_percent: itemTaxPercent,
                    tax_amount: lineTax,
                    line_total: lineTotal
                });
            }
        }

        if (errors.length > 0) {
            const [productsList] = await pool.query(`
                SELECT 
                    p.id, p.product_code, p.product_name, p.selling_price, p.stock_quantity, 
                    p.discount_allowed, p.discount_percent,
                    c.category_name, b.brand_name, u.unit_name
                FROM product_master p
                LEFT JOIN category_master c ON c.id = p.category_id
                LEFT JOIN brand_master b ON b.id = p.brand_id
                LEFT JOIN unit_master u ON u.id = p.sale_unit
                WHERE p.status = 1 AND p.sale_available = 1
                ORDER BY p.product_name ASC
            `);

            const [customersList] = await pool.query(`
                SELECT id, customer_code, customer_name, mobile_number, credit_allowed, credit_limit 
                FROM customer_master 
                WHERE status = 1 
                ORDER BY customer_name ASC
            `);

            return res.render('create_sales_note', {
                pageTitle: 'Create Sales Note',
                salesNoteNo: await generateSalesNoteNumber(),
                salesDate,
                salesTime,
                selectedCustomerId: customerId,
                paymentType,
                notes,
                creditOverride,
                otherCharges: inputOtherCharges,
                productsList,
                customersList,
                errors
            });
        }

        const grandTotal = Math.max(0.00, (serverSubtotal - serverTotalDiscount) + serverTotalTax + inputOtherCharges);
        let paidAmount = 0.00;
        let creditAmount = 0.00;
        let actualPaymentType = paymentType;

        if (['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(paymentType)) {
            paidAmount = grandTotal;
            creditAmount = 0.00;
        } else if (paymentType === 'Credit') {
            paidAmount = 0.00;
            creditAmount = grandTotal;
        } else if (paymentType === 'Mixed') {
            paidAmount = Math.min(grandTotal, Math.max(0.00, inputPaidAmount));
            creditAmount = Math.max(0.00, grandTotal - paidAmount);
        } else {
            paidAmount = grandTotal;
            creditAmount = 0.00;
            actualPaymentType = 'Cash';
        }

        const fSummary = await getCustomerFinancialSummary(pool, customerId, customer);
        const prevOutstanding = parseFloat(fSummary.current_outstanding);
        const creditLimit = parseFloat(customer.credit_limit);
        const creditAllowed = parseInt(customer.credit_allowed, 10);
        const newOutstanding = prevOutstanding + creditAmount;

        if (creditAmount > 0.001) {
            if (creditAllowed === 0) {
                errors.push(`Credit is not allowed for customer '${customer.customer_name}'. Please select full payment method (Cash / UPI / Card).`);
            } else {
                const creditEval = evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed);
                if (creditEval.is_exceeded && !creditOverride) {
                    const availableCredit = Math.max(0.00, creditLimit - prevOutstanding);
                    errors.push(`Credit limit exceeded! Customer Credit Limit: ₹${creditLimit.toFixed(2)}, Current Outstanding: ₹${prevOutstanding.toFixed(2)}, Available Credit: ₹${availableCredit.toFixed(2)}, Requested Credit: ₹${creditAmount.toFixed(2)}. Please reduce credit amount or check 'Manager Override'.`);
                }
            }
        }

        if (errors.length > 0) {
            const [productsList] = await pool.query(`
                SELECT 
                    p.id, p.product_code, p.product_name, p.selling_price, p.stock_quantity, 
                    p.discount_allowed, p.discount_percent,
                    c.category_name, b.brand_name, u.unit_name
                FROM product_master p
                LEFT JOIN category_master c ON c.id = p.category_id
                LEFT JOIN brand_master b ON b.id = p.brand_id
                LEFT JOIN unit_master u ON u.id = p.sale_unit
                WHERE p.status = 1 AND p.sale_available = 1
                ORDER BY p.product_name ASC
            `);

            const [customersList] = await pool.query(`
                SELECT id, customer_code, customer_name, mobile_number, credit_allowed, credit_limit 
                FROM customer_master 
                WHERE status = 1 
                ORDER BY customer_name ASC
            `);

            return res.render('create_sales_note', {
                pageTitle: 'Create Sales Note',
                salesNoteNo: await generateSalesNoteNumber(),
                salesDate,
                salesTime,
                selectedCustomerId: customerId,
                paymentType: actualPaymentType,
                notes,
                creditOverride,
                otherCharges: inputOtherCharges,
                productsList,
                customersList,
                errors
            });
        }

        const finalCreditEval = evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed);
        const creditStatus = finalCreditEval.status;

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const finalNoteNo = await generateSalesNoteNumber();
            const userId = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;

            const [insertResult] = await conn.query(
                `INSERT INTO sales_notes (
                    sales_note_no, customer_id, sales_date, sales_time, payment_type,
                    subtotal, discount, tax, other_charges, total_amount,
                    paid_amount, credit_amount, previous_outstanding, new_outstanding,
                    credit_limit, credit_status, credit_override, notes, status,
                    created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
                [
                    finalNoteNo, customerId, salesDate, salesTime, actualPaymentType,
                    serverSubtotal, serverTotalDiscount, serverTotalTax, inputOtherCharges, grandTotal,
                    paidAmount, creditAmount, prevOutstanding, newOutstanding,
                    creditLimit, creditStatus, creditOverride, notes || null,
                    userId
                ]
            );

            const salesNoteId = insertResult.insertId;

            for (const item of validatedItems) {
                await conn.query(
                    `INSERT INTO sales_note_items (
                        sales_note_id, product_id, product_code, product_name, unit_name,
                        quantity, unit_price, discount, tax_percent, tax_amount, line_total,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        salesNoteId, item.product_id, item.product_code, item.product_name, item.unit_name,
                        item.quantity, item.unit_price, item.discount, item.tax_percent, item.tax_amount, item.line_total
                    ]
                );

                await conn.query(
                    `UPDATE product_master 
                    SET stock_quantity = stock_quantity - ? 
                    WHERE id = ?`,
                    [item.quantity, item.product_id]
                );
            }

            const paymentStatus = (paidAmount >= grandTotal) ? 'Paid' : ((paidAmount > 0.001) ? 'Partial' : 'Unpaid');

            await conn.query(
                `INSERT INTO customer_transactions (
                    customer_id, transaction_type, reference_number, transaction_date,
                    total_amount, paid_amount, debit_amount, credit_amount,
                    payment_method, payment_status, reason, notes,
                    created_by, created_at
                ) VALUES (?, 'sale', ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, NOW())`,
                [
                    customerId,
                    finalNoteNo,
                    `${salesDate} ${salesTime}:00`,
                    grandTotal,
                    paidAmount,
                    creditAmount,
                    actualPaymentType,
                    paymentStatus,
                    `Sales Note ${finalNoteNo}`,
                    notes || null,
                    userId
                ]
            );

            await conn.commit();
            conn.release();

            return res.redirect(`/view_sales_note.php?id=${salesNoteId}&success=${encodeURIComponent(`Sales Note ${finalNoteNo} created successfully!`)}`);
        } catch (e) {
            await conn.rollback();
            conn.release();
            console.error('createSalesNote transaction error:', e);
            throw e;
        }
    } catch (err) {
        console.error('createSalesNote error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Show edit sales note form
exports.editSalesNoteForm = async (req, res) => {
    try {
        const id = parseInt(req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Invalid Sales Note ID')}`);
        }

        const [sales] = await pool.query(
            `SELECT sn.*, cm.customer_name, cm.customer_code, cm.mobile_number, cm.credit_allowed, cm.credit_limit
            FROM sales_notes sn
            LEFT JOIN customer_master cm ON cm.id = sn.customer_id
            WHERE sn.id = ?
            LIMIT 1`,
            [id]
        );

        if (!sales.length) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Sales Note not found')}`);
        }
        const sale = sales[0];

        if (Number(sale.status) === 0) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Cannot edit a cancelled Sales Note')}`);
        }

        const [existingItems] = await pool.query(
            `SELECT sni.*, p.stock_quantity
            FROM sales_note_items sni
            LEFT JOIN product_master p ON p.id = sni.product_id
            WHERE sni.sales_note_id = ?`,
            [id]
        );

        const [productsList] = await pool.query(`
            SELECT 
                p.id, p.product_code, p.product_name, p.selling_price, p.stock_quantity, 
                p.discount_allowed, p.discount_percent,
                c.category_name, b.brand_name, u.unit_name
            FROM product_master p
            LEFT JOIN category_master c ON c.id = p.category_id
            LEFT JOIN brand_master b ON b.id = p.brand_id
            LEFT JOIN unit_master u ON u.id = p.sale_unit
            WHERE p.status = 1 AND p.sale_available = 1
            ORDER BY p.product_name ASC
        `);

        const [customersList] = await pool.query(`
            SELECT id, customer_code, customer_name, mobile_number, credit_allowed, credit_limit 
            FROM customer_master 
            WHERE status = 1 
            ORDER BY customer_name ASC
        `);

        const initialItemsFormatted = existingItems.map(it => {
            const stockWithCurrent = parseFloat(it.stock_quantity || 0) + parseFloat(it.quantity);
            return {
                product_id: parseInt(it.product_id, 10),
                product_code: it.product_code,
                product_name: it.product_name,
                unit_name: it.unit_name || 'Unit',
                stock: stockWithCurrent,
                quantity: parseFloat(it.quantity),
                unit_price: parseFloat(it.unit_price),
                discount: parseFloat(it.discount),
                tax_percent: parseFloat(it.tax_percent)
            };
        });

        res.render('edit_sales_note', {
            pageTitle: 'Edit Sales Note',
            sale,
            productsList,
            customersList,
            initialItemsFormatted,
            errors: []
        });
    } catch (err) {
        console.error('editSalesNoteForm error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Process edit sales note
exports.editSalesNote = async (req, res) => {
    try {
        const id = parseInt(req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Invalid Sales Note ID')}`);
        }

        const [sales] = await pool.query('SELECT * FROM sales_notes WHERE id = ? LIMIT 1', [id]);
        if (!sales.length) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Sales Note not found')}`);
        }
        const sale = sales[0];

        if (Number(sale.status) === 0) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Cannot edit a cancelled Sales Note')}`);
        }

        const [existingItems] = await pool.query('SELECT * FROM sales_note_items WHERE sales_note_id = ?', [id]);

        const body = req.body || {};
        const customerId = parseInt(body.customer_id || sale.customer_id, 10);
        const salesDate = (body.sales_date || sale.sales_date).trim();
        const salesTime = (body.sales_time || sale.sales_time).trim();
        const paymentType = (body.payment_type || sale.payment_type).trim();
        const itemsInput = body.items || [];
        const inputPaidAmount = body.paid_amount !== undefined ? parseFloat(body.paid_amount) : 0.00;
        const inputOtherCharges = body.other_charges !== undefined ? Math.max(0.00, parseFloat(body.other_charges)) : 0.00;
        const notes = (body.notes || '').trim();
        const creditOverride = body.credit_override ? 1 : 0;

        const [custRows] = await pool.query('SELECT * FROM customer_master WHERE id = ? AND status = 1 LIMIT 1', [customerId]);
        if (!custRows.length) {
            return res.redirect(`/edit_sales_note.php?id=${id}&error=${encodeURIComponent('Selected customer does not exist or is inactive.')}`);
        }
        const customer = custRows[0];

        if (!itemsInput || !Array.isArray(itemsInput) || itemsInput.length === 0) {
            return res.redirect(`/edit_sales_note.php?id=${id}&error=${encodeURIComponent('Please keep at least one product in the sales note.')}`);
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // STEP 1: Restore old stock quantities
            for (const oldItem of existingItems) {
                await conn.query(
                    `UPDATE product_master 
                    SET stock_quantity = stock_quantity + ? 
                    WHERE id = ?`,
                    [parseFloat(oldItem.quantity), parseInt(oldItem.product_id, 10)]
                );
            }

            // STEP 2: Validate new items against restored stock
            const validatedItems = [];
            let serverSubtotal = 0.00;
            let serverTotalDiscount = 0.00;
            let serverTotalTax = 0.00;

            for (let index = 0; index < itemsInput.length; index++) {
                const itemData = itemsInput[index];
                const productId = parseInt(itemData.product_id || 0, 10);
                const qty = parseFloat(itemData.quantity || 0);
                const itemDiscount = Math.max(0.00, parseFloat(itemData.discount || 0.00));
                const itemTaxPercent = Math.max(0.00, parseFloat(itemData.tax_percent || 0.00));

                if (productId <= 0 || qty <= 0) {
                    throw new Error(`Item #${index + 1}: Product and quantity must be greater than zero.`);
                }

                const [prodRows] = await conn.query(
                    `SELECT p.*, u.unit_name 
                    FROM product_master p
                    LEFT JOIN unit_master u ON u.id = p.sale_unit
                    WHERE p.id = ? AND p.status = 1 AND p.sale_available = 1 
                    LIMIT 1
                    FOR UPDATE`,
                    [productId]
                );

                if (!prodRows.length) {
                    throw new Error(`Item #${index + 1}: Product is not available for sale.`);
                }
                const product = prodRows[0];

                const availableStock = parseFloat(product.stock_quantity || 0);
                if (qty > availableStock) {
                    throw new Error(`Insufficient stock for '${product.product_name}'. Available: ${availableStock}, Requested: ${qty}.`);
                }

                const unitPrice = parseFloat(product.selling_price || 0.00);
                const lineSubtotal = qty * unitPrice;
                const lineDiscount = Math.min(lineSubtotal, itemDiscount);
                const taxableAmount = Math.max(0.00, lineSubtotal - lineDiscount);
                const lineTax = (taxableAmount * itemTaxPercent) / 100.0;
                const lineTotal = taxableAmount + lineTax;

                serverSubtotal += lineSubtotal;
                serverTotalDiscount += lineDiscount;
                serverTotalTax += lineTax;

                validatedItems.push({
                    product_id: product.id,
                    product_code: product.product_code,
                    product_name: product.product_name,
                    unit_name: product.unit_name || 'Unit',
                    quantity: qty,
                    unit_price: unitPrice,
                    discount: lineDiscount,
                    tax_percent: itemTaxPercent,
                    tax_amount: lineTax,
                    line_total: lineTotal
                });
            }

            // STEP 3: Grand Total & Split
            const grandTotal = Math.max(0.00, (serverSubtotal - serverTotalDiscount) + serverTotalTax + inputOtherCharges);
            let paidAmount = 0.00;
            let creditAmount = 0.00;
            let actualPaymentType = paymentType;

            if (['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(paymentType)) {
                paidAmount = grandTotal;
                creditAmount = 0.00;
            } else if (paymentType === 'Credit') {
                paidAmount = 0.00;
                creditAmount = grandTotal;
            } else if (paymentType === 'Mixed') {
                paidAmount = Math.min(grandTotal, Math.max(0.00, inputPaidAmount));
                creditAmount = Math.max(0.00, grandTotal - paidAmount);
            } else {
                paidAmount = grandTotal;
                creditAmount = 0.00;
                actualPaymentType = 'Cash';
            }

            // STEP 4: Delete old customer_transaction to compute base balance
            await conn.query(
                `DELETE FROM customer_transactions 
                WHERE customer_id = ? 
                  AND reference_number = ? 
                  AND transaction_type = 'sale'`,
                [parseInt(sale.customer_id, 10), sale.sales_note_no]
            );

            const fSummary = await getCustomerFinancialSummary(conn, customerId, customer);
            const prevOutstanding = parseFloat(fSummary.current_outstanding);
            const creditLimit = parseFloat(customer.credit_limit);
            const creditAllowed = parseInt(customer.credit_allowed, 10);
            const newOutstanding = prevOutstanding + creditAmount;

            if (creditAmount > 0.001) {
                if (creditAllowed === 0) {
                    throw new Error(`Credit is not allowed for customer '${customer.customer_name}'.`);
                }
                const creditEval = evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed);
                if (creditEval.is_exceeded && !creditOverride) {
                    const availableCredit = Math.max(0.00, creditLimit - prevOutstanding);
                    throw new Error(`Credit limit exceeded! Customer Credit Limit: ₹${creditLimit.toFixed(2)}, Current Outstanding: ₹${prevOutstanding.toFixed(2)}, Available Credit: ₹${availableCredit.toFixed(2)}, Requested Credit: ₹${creditAmount.toFixed(2)}. Please reduce credit amount or authorize override.`);
                }
            }

            const finalCreditEval = evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed);
            const creditStatus = finalCreditEval.status;

            // STEP 5: Update sales_notes record
            const userId = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
            await conn.query(
                `UPDATE sales_notes SET
                    customer_id = ?,
                    sales_date = ?,
                    sales_time = ?,
                    payment_type = ?,
                    subtotal = ?,
                    discount = ?,
                    tax = ?,
                    other_charges = ?,
                    total_amount = ?,
                    paid_amount = ?,
                    credit_amount = ?,
                    previous_outstanding = ?,
                    new_outstanding = ?,
                    credit_limit = ?,
                    credit_status = ?,
                    credit_override = ?,
                    notes = ?,
                    updated_by = ?,
                    updated_at = NOW()
                WHERE id = ?`,
                [
                    customerId,
                    salesDate,
                    salesTime,
                    actualPaymentType,
                    serverSubtotal,
                    serverTotalDiscount,
                    serverTotalTax,
                    inputOtherCharges,
                    grandTotal,
                    paidAmount,
                    creditAmount,
                    prevOutstanding,
                    newOutstanding,
                    creditLimit,
                    creditStatus,
                    creditOverride,
                    notes || null,
                    userId,
                    id
                ]
            );

            // STEP 6: Delete old items & insert new items
            await conn.query('DELETE FROM sales_note_items WHERE sales_note_id = ?', [id]);

            for (const item of validatedItems) {
                await conn.query(
                    `INSERT INTO sales_note_items (
                        sales_note_id, product_id, product_code, product_name, unit_name,
                        quantity, unit_price, discount, tax_percent, tax_amount, line_total,
                        created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        id,
                        item.product_id,
                        item.product_code,
                        item.product_name,
                        item.unit_name,
                        item.quantity,
                        item.unit_price,
                        item.discount,
                        item.tax_percent,
                        item.tax_amount,
                        item.line_total
                    ]
                );

                await conn.query(
                    `UPDATE product_master 
                    SET stock_quantity = stock_quantity - ? 
                    WHERE id = ?`,
                    [item.quantity, item.product_id]
                );
            }

            // STEP 7: Re-insert customer_transaction
            const paymentStatus = (paidAmount >= grandTotal) ? 'Paid' : ((paidAmount > 0.001) ? 'Partial' : 'Unpaid');

            await conn.query(
                `INSERT INTO customer_transactions (
                    customer_id, transaction_type, reference_number, transaction_date,
                    total_amount, paid_amount, debit_amount, credit_amount,
                    payment_method, payment_status, reason, notes,
                    created_by, created_at
                ) VALUES (?, 'sale', ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, NOW())`,
                [
                    customerId,
                    sale.sales_note_no,
                    `${salesDate} ${salesTime}:00`,
                    grandTotal,
                    paidAmount,
                    creditAmount,
                    actualPaymentType,
                    paymentStatus,
                    `Sales Note ${sale.sales_note_no} (Edited)`,
                    notes || null,
                    userId
                ]
            );

            await conn.commit();
            conn.release();

            return res.redirect(`/view_sales_note.php?id=${id}&success=${encodeURIComponent(`Sales Note ${sale.sales_note_no} updated successfully!`)}`);
        } catch (e) {
            await conn.rollback();
            conn.release();
            console.error('editSalesNote transaction error:', e);

            const [productsList] = await pool.query(`
                SELECT 
                    p.id, p.product_code, p.product_name, p.selling_price, p.stock_quantity, 
                    p.discount_allowed, p.discount_percent,
                    c.category_name, b.brand_name, u.unit_name
                FROM product_master p
                LEFT JOIN category_master c ON c.id = p.category_id
                LEFT JOIN brand_master b ON b.id = p.brand_id
                LEFT JOIN unit_master u ON u.id = p.sale_unit
                WHERE p.status = 1 AND p.sale_available = 1
                ORDER BY p.product_name ASC
            `);

            const [customersList] = await pool.query(`
                SELECT id, customer_code, customer_name, mobile_number, credit_allowed, credit_limit 
                FROM customer_master 
                WHERE status = 1 
                ORDER BY customer_name ASC
            `);

            const initialItemsFormatted = existingItems.map(it => ({
                product_id: parseInt(it.product_id, 10),
                product_code: it.product_code,
                product_name: it.product_name,
                unit_name: it.unit_name || 'Unit',
                stock: parseFloat(it.stock_quantity || 0),
                quantity: parseFloat(it.quantity),
                unit_price: parseFloat(it.unit_price),
                discount: parseFloat(it.discount),
                tax_percent: parseFloat(it.tax_percent)
            }));

            return res.render('edit_sales_note', {
                pageTitle: 'Edit Sales Note',
                sale: { ...sale, ...body },
                productsList,
                customersList,
                initialItemsFormatted,
                errors: [e.message]
            });
        }
    } catch (err) {
        console.error('editSalesNote error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// View single sales note
exports.viewSalesNote = async (req, res) => {
    try {
        const id = parseInt(req.query.id || 0, 10);
        if (id <= 0) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Invalid Sales Note ID')}`);
        }

        const [sales] = await pool.query(
            `SELECT 
                sn.*,
                cm.customer_code,
                cm.customer_name,
                cm.company_name,
                cm.mobile_number,
                cm.email,
                cm.gst_number,
                cm.address,
                cm.area,
                cm.city,
                cm.state,
                cm.pincode,
                cm.credit_allowed AS cust_credit_allowed,
                cm.credit_limit AS cust_credit_limit,
                cm.payment_terms,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM sales_notes sn
            LEFT JOIN customer_master cm ON cm.id = sn.customer_id
            LEFT JOIN user_master creator ON creator.id = sn.created_by
            LEFT JOIN user_master updater ON updater.id = sn.updated_by
            WHERE sn.id = ?
            LIMIT 1`,
            [id]
        );

        if (!sales.length) {
            return res.redirect(`/manage_sales_note.php?error=${encodeURIComponent('Sales Note not found')}`);
        }
        const sale = sales[0];

        const [items] = await pool.query(
            `SELECT sni.*, p.short_name, c.category_name, b.brand_name
            FROM sales_note_items sni
            LEFT JOIN product_master p ON p.id = sni.product_id
            LEFT JOIN category_master c ON c.id = p.category_id
            LEFT JOIN brand_master b ON b.id = p.brand_id
            WHERE sni.sales_note_id = ?
            ORDER BY sni.id ASC`,
            [id]
        );

        const evalCredit = evaluateCreditStatus(parseFloat(sale.new_outstanding), parseFloat(sale.credit_limit), parseInt(sale.cust_credit_allowed, 10));
        const autoPrint = req.query.print === '1';

        res.render('view_sales_note', {
            pageTitle: 'View Sales Note',
            sale,
            items,
            evalCredit,
            autoPrint
        });
    } catch (err) {
        console.error('viewSalesNote error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// AJAX handler
exports.ajaxSalesNote = async (req, res) => {
    try {
        const action = (req.query.action || req.body.action || '').trim();

        switch (action) {
            case 'get_customer': {
                const customerId = parseInt(req.query.customer_id || req.body.customer_id || req.query.id || req.body.id || 0, 10);
                if (customerId <= 0) {
                    return res.status(400).json({ success: false, message: 'Invalid Customer ID' });
                }

                const [rows] = await pool.query('SELECT * FROM customer_master WHERE id = ? AND status = 1 LIMIT 1', [customerId]);
                if (!rows.length) {
                    return res.status(404).json({ success: false, message: 'Customer not found or inactive' });
                }
                const customer = rows[0];

                const summary = await getCustomerFinancialSummary(pool, customerId, customer);
                const creditEval = evaluateCreditStatus(
                    parseFloat(summary.current_outstanding),
                    parseFloat(summary.credit_limit),
                    parseInt(summary.credit_allowed, 10)
                );

                const addressParts = [
                    customer.address || '',
                    customer.area || '',
                    customer.city || '',
                    customer.state || '',
                    customer.pincode || ''
                ].filter(Boolean);
                const formattedAddress = addressParts.join(', ');

                return res.json({
                    success: true,
                    summary,
                    customer: {
                        id: parseInt(customer.id, 10),
                        customer_code: customer.customer_code,
                        customer_name: customer.customer_name,
                        company_name: customer.company_name || '',
                        mobile_number: customer.mobile_number,
                        email: customer.email || '',
                        gst_number: customer.gst_number || '',
                        address: formattedAddress || (customer.address || 'N/A'),
                        credit_allowed: parseInt(customer.credit_allowed, 10),
                        credit_limit: parseFloat(customer.credit_limit),
                        payment_terms: customer.payment_terms || 'Immediate',
                        current_outstanding: parseFloat(summary.current_outstanding),
                        available_credit: parseFloat(summary.available_credit),
                        credit_utilization_percent: parseFloat(creditEval.percent),
                        credit_status: creditEval.status,
                        credit_status_code: creditEval.code,
                        can_credit: creditEval.can_credit,
                        badge_class: creditEval.badge_class,
                        credit_message: creditEval.message
                    }
                });
            }

            case 'get_product': {
                const productId = parseInt(req.query.product_id || req.body.product_id || req.query.id || req.body.id || 0, 10);
                if (productId <= 0) {
                    return res.status(400).json({ success: false, message: 'Invalid Product ID' });
                }

                const [rows] = await pool.query(
                    `SELECT 
                        p.*,
                        c.category_name,
                        b.brand_name,
                        u.unit_name
                    FROM product_master p
                    LEFT JOIN category_master c ON c.id = p.category_id
                    LEFT JOIN brand_master b ON b.id = p.brand_id
                    LEFT JOIN unit_master u ON u.id = p.sale_unit
                    WHERE p.id = ? AND p.status = 1
                    LIMIT 1`,
                    [productId]
                );

                if (!rows.length) {
                    return res.status(404).json({ success: false, message: 'Product not found or inactive' });
                }
                const product = rows[0];

                return res.json({
                    success: true,
                    product: {
                        id: parseInt(product.id, 10),
                        product_code: product.product_code,
                        product_name: product.product_name,
                        short_name: product.short_name || '',
                        category_name: product.category_name || 'General',
                        brand_name: product.brand_name || 'Generic',
                        unit_name: product.unit_name || 'Unit',
                        sale_available: parseInt(product.sale_available, 10),
                        selling_price: parseFloat(product.selling_price || 0.0),
                        discount_allowed: parseInt(product.discount_allowed || 0, 10),
                        discount_percent: parseFloat(product.discount_percent || 0.0),
                        stock_quantity: parseInt(product.stock_quantity || 0, 10)
                    }
                });
            }

            case 'search_customers': {
                const q = (req.query.q || req.body.q || req.query.query || req.body.query || '').trim();
                let sql = 'SELECT id, customer_code, customer_name, company_name, mobile_number, credit_allowed, credit_limit FROM customer_master WHERE status = 1';
                const params = [];
                if (q !== '') {
                    sql += ' AND (customer_code LIKE ? OR customer_name LIKE ? OR company_name LIKE ? OR mobile_number LIKE ?)';
                    const sp = `%${q}%`;
                    params.push(sp, sp, sp, sp);
                }
                sql += ' ORDER BY customer_name ASC LIMIT 20';

                const [customers] = await pool.query(sql, params);
                return res.json({ success: true, customers });
            }

            case 'search_products': {
                const q = (req.query.q || req.body.q || req.query.query || req.body.query || '').trim();
                let sql = `
                    SELECT 
                        p.id, 
                        p.product_code, 
                        p.product_name, 
                        p.selling_price, 
                        p.stock_quantity,
                        p.discount_percent,
                        p.discount_allowed,
                        c.category_name,
                        b.brand_name
                    FROM product_master p
                    LEFT JOIN category_master c ON c.id = p.category_id
                    LEFT JOIN brand_master b ON b.id = p.brand_id
                    WHERE p.status = 1 AND p.sale_available = 1
                `;
                const params = [];
                if (q !== '') {
                    sql += ' AND (p.product_code LIKE ? OR p.product_name LIKE ? OR p.short_name LIKE ?)';
                    const sp = `%${q}%`;
                    params.push(sp, sp, sp);
                }
                sql += ' ORDER BY p.product_name ASC LIMIT 25';

                const [products] = await pool.query(sql, params);
                return res.json({ success: true, products });
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }
    } catch (err) {
        console.error('ajaxSalesNote error:', err);
        return res.status(400).json({ success: false, message: err.message });
    }
};
