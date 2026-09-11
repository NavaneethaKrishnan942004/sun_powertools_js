const pool = require('../config/db');
const { getNextId } = require('../utils/idHelper');
const { getCustomerFinancialSummary } = require('../utils/customerHelper');
const { generateSalesNoteNumber, evaluateCreditStatus, getSalesAnalytics, getPaymentStatusInfo, getSaleTypeInfo, getPaymentTypeBadge, buildPaymentsList } = require('../utils/salesNoteHelper');

// Safe number parsing helper to guarantee NaN never reaches calculations or DB
function safeNum(val, fallback = 0.00) {
    if (val === undefined || val === null) return fallback;
    const s = String(val).trim();
    if (s === '') return fallback;
    const parsed = parseFloat(s);
    return isNaN(parsed) ? fallback : parsed;
}

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

                    // 2. Remove customer financial transactions (both sale and any payments)
                    await conn.query(
                        `DELETE FROM customer_transactions 
                        WHERE customer_id = ? 
                          AND reference_number = ?`,
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
        const paymentStatusFilter = (req.query.payment_status || '').trim();
        const creditStatusFilter = (req.query.credit_status || '').trim();
        const dateFrom = (req.query.date_from || '').trim();
        const dateTo = (req.query.date_to || '').trim();
        const statusFilter = req.query.status !== undefined ? req.query.status : '1';

        const page = Math.max(1, parseInt(req.query.page || 1, 10));
        const limit = 10;
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

        if (paymentStatusFilter !== '') {
            const pStatusLower = paymentStatusFilter.toLowerCase();
            if (pStatusLower === 'paid' || pStatusLower === 'fully paid') {
                whereSql += ' AND (sn.paid_amount >= sn.total_amount - 0.001)';
            } else if (pStatusLower === 'partial' || pStatusLower === 'partially paid') {
                whereSql += ' AND (sn.paid_amount > 0.001 AND sn.paid_amount < sn.total_amount - 0.001)';
            } else if (pStatusLower === 'unpaid') {
                whereSql += ' AND (sn.paid_amount <= 0.001 AND sn.total_amount > 0.001)';
            }
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

        let paymentsByRef = {};
        if (salesNotes.length > 0) {
            const noteNos = salesNotes.map(sn => sn.sales_note_no);
            const [allTxPayments] = await pool.query(
                `SELECT reference_number, transaction_date, payment_method, credit_amount, total_amount, reason, notes, id
                FROM customer_transactions
                WHERE reference_number IN (?) AND transaction_type = 'payment'
                ORDER BY transaction_date ASC, id ASC`,
                [noteNos]
            );
            for (const p of allTxPayments) {
                if (!paymentsByRef[p.reference_number]) paymentsByRef[p.reference_number] = [];
                paymentsByRef[p.reference_number].push(p);
            }
        }

        salesNotes.forEach(sn => {
            const sTypeInfo = getSaleTypeInfo(sn.sale_type, sn.credit_amount, sn.payment_type);
            const pStatusInfo = getPaymentStatusInfo(sn.paid_amount, sn.total_amount);
            sn.computed_sale_type = sTypeInfo.type;
            sn.sale_type_label = sTypeInfo.label;
            sn.sale_type_badge = sTypeInfo.badge_html;
            sn.payment_status = pStatusInfo.status;
            sn.payment_status_code = pStatusInfo.code;
            sn.payment_status_badge = pStatusInfo.badge_html;
            sn.balance_amount = pStatusInfo.balance;

            const subPmts = paymentsByRef[sn.sales_note_no] || [];
            sn.payments_list = buildPaymentsList(sn, subPmts);

            const firstPay = (sn.first_payment !== undefined && sn.first_payment !== null)
                ? parseFloat(sn.first_payment)
                : (parseFloat(sn.paid_amount) || 0.00);
            sn.first_payment_amt = firstPay;
            sn.credit_payments_amt = Math.max(0.00, parseFloat(sn.paid_amount || 0) - firstPay);
            sn.remaining_credit = Math.max(0.00, parseFloat(sn.total_amount || 0) - parseFloat(sn.paid_amount || 0));

            const creditLimit = parseFloat(sn.credit_limit || 0);
            const newOut = parseFloat(sn.new_outstanding || 0);
            const isCreditSale = (sn.computed_sale_type === 'credit') || (Number(sn.credit_amount) > 0.001);
            sn.is_credit_limit_exceeded = isCreditSale && (
                sn.credit_status === 'Limit Exceeded' || 
                sn.credit_status === 'Credit Limit Exceeded' || 
                (creditLimit > 0 && newOut > creditLimit)
            );
        });

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
            paymentStatusFilter,
            creditStatusFilter,
            dateFrom,
            dateTo,
            statusFilter,
            page,
            limit,
            offset,
            totalRecords,
            totalPages,
            getPaymentStatusInfo,
            getSaleTypeInfo,
            getPaymentTypeBadge,
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
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const salesDate = `${year}-${month}-${day}`;
        const salesTime = `${hours}:${minutes}`;
        const currentSalesDateTime = `${salesDate}T${salesTime}`;

        const query = req.query || {};
        const body = req.body || {};
        const selectedCustomerId = parseInt(query.customer_id || body.customer_id || 0, 10);
        const saleType = (query.sale_type || body.sale_type || 'sale').toLowerCase();
        const paymentType = body.payment_type || 'Cash';
        const notes = (body.notes || '').trim();
        const creditOverride = body.credit_override ? 1 : 0;
        const otherCharges = body.other_charges ? parseFloat(body.other_charges) : 0.00;
        const amountReceived = body.amount_received !== undefined ? body.amount_received : '0.00';

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
            currentSalesDateTime,
            saleType,
            finalGrandTotal: '',
            amountReceived,
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
        const saleType = (body.sale_type || (body.payment_type === 'Credit' ? 'credit' : 'sale')).toLowerCase();
        const customerId = parseInt(body.customer_id || 0, 10);

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        let salesDate = `${year}-${month}-${day}`;
        let salesTime = `${hours}:${minutes}`;

        if (body.sales_datetime) {
            const dtParts = body.sales_datetime.split('T');
            if (dtParts[0]) salesDate = dtParts[0].trim();
            if (dtParts[1]) salesTime = dtParts[1].substring(0, 5).trim();
        } else {
            if (body.sales_date) salesDate = body.sales_date.trim();
            if (body.sales_time) salesTime = body.sales_time.trim();
        }

        const currentSalesDateTime = `${salesDate}T${salesTime}`;
        const paymentType = (body.payment_type || 'Cash').trim();
        const itemsInput = body.items || [];
        const inputOtherCharges = Math.max(0.00, safeNum(body.other_charges, 0.00));
        const notes = (body.notes || '').trim();
        let creditOverride = (body.credit_override === '1' || body.credit_override === 1 || body.credit_override === 'on' || body.credit_override === true || body.credit_override === 'true') ? 1 : 0;

        const errors = [];

        // 1. Validate Customer
        // Optional for normal Sale, Required for Credit Sale
        let customer = null;
        if (saleType === 'credit') {
            if (customerId <= 0) {
                errors.push('Customer selection is required for Credit Sale. Please select a valid customer.');
            } else {
                const [custRows] = await pool.query('SELECT * FROM customer_master WHERE id = ? AND status = 1 LIMIT 1', [customerId]);
                if (!custRows.length) {
                    errors.push('Selected customer does not exist or is inactive.');
                } else {
                    customer = custRows[0];
                }
            }
        } else {
            // Normal Sale: Customer is optional
            if (customerId > 0) {
                const [custRows] = await pool.query('SELECT * FROM customer_master WHERE id = ? AND status = 1 LIMIT 1', [customerId]);
                if (custRows.length) {
                    customer = custRows[0];
                }
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
                const qty = Math.max(0.00, safeNum(itemData.quantity, 0.00));
                const itemDiscount = Math.max(0.00, safeNum(itemData.discount, 0.00));
                const itemTaxPercent = Math.max(0.00, safeNum(itemData.tax_percent, 0.00));

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

                const availableStock = safeNum(product.stock_quantity, 0.00);
                if (availableStock <= 0) {
                    errors.push("This product is out of stock and cannot be added to the sale.");
                    continue;
                }
                if (qty > availableStock) {
                    errors.push(`Insufficient stock for '${product.product_name}'. Available: ${availableStock}, Requested: ${qty}.`);
                    continue;
                }

                const unitPrice = safeNum(product.selling_price, 0.00);
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

        const rawCalculatedGrandTotal = Math.max(0.00, (serverSubtotal - serverTotalDiscount) + serverTotalTax + inputOtherCharges);
        const roundedGrandTotal = Math.round(rawCalculatedGrandTotal);
        const calculatedGrandTotal = roundedGrandTotal;
        let roundOff = Number((roundedGrandTotal - rawCalculatedGrandTotal).toFixed(2));
        let finalGrandTotal = calculatedGrandTotal;

        if (body.final_grand_total !== undefined && body.final_grand_total !== null && String(body.final_grand_total).trim() !== '') {
            const parsedFinal = safeNum(body.final_grand_total, -1);
            if (parsedFinal <= 0) {
                errors.push('Adjusted / Final Grand Total must be a valid amount greater than zero.');
            } else if (parsedFinal > calculatedGrandTotal + 0.01 && parsedFinal > rawCalculatedGrandTotal + 0.01) {
                errors.push(`Adjusted / Final Grand Total (₹${parsedFinal.toFixed(2)}) cannot exceed the calculated Grand Total (₹${calculatedGrandTotal.toFixed(2)}).`);
            } else {
                finalGrandTotal = parsedFinal;
            }
        }
        if (body.round_off !== undefined && body.round_off !== null && String(body.round_off).trim() !== '') {
            roundOff = safeNum(body.round_off, roundOff);
        }

        const effectiveAdjustmentDiscount = Math.max(0.00, calculatedGrandTotal - finalGrandTotal);
        const totalDiscountToSave = serverTotalDiscount + effectiveAdjustmentDiscount;
        const grandTotal = finalGrandTotal; // Use Final Grand Total for all subsequent financial operations!

        let actualSaleType = saleType;
        let paidAmount = 0.00;
        let creditAmount = 0.00;
        let actualPaymentType = 'Cash';

        if (saleType === 'credit') {
            const inputReceived = safeNum(body.amount_received !== undefined && String(body.amount_received).trim() !== ''
                ? body.amount_received
                : (body.paid_amount !== undefined && String(body.paid_amount).trim() !== '' ? body.paid_amount : 0.00), 0.00);

            if (inputReceived < 0) {
                errors.push('Amount Received Now must be a non-negative number.');
            } else if (inputReceived > grandTotal + 0.01) {
                errors.push(`Amount Received (₹${inputReceived.toFixed(2)}) cannot be greater than Grand Total (Final Grand Total: ₹${grandTotal.toFixed(2)}).`);
            }

            const rawPaid = Math.min(grandTotal, Math.max(0.00, inputReceived));
            const rawCredit = Math.max(0.00, grandTotal - rawPaid);

            // User requirement:
            // If Amount Received / Paid == Grand Total, save as Normal Sale!
            // Only if Amount Received < Grand Total (rawCredit > 0.001), save as Credit Sale!
            if (rawCredit <= 0.001) {
                actualSaleType = 'sale';
                paidAmount = grandTotal;
                creditAmount = 0.00;
                actualPaymentType = ['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(body.payment_method || body.payment_type)
                    ? (body.payment_method || body.payment_type)
                    : 'Cash';
            } else {
                actualSaleType = 'credit';
                paidAmount = rawPaid;
                creditAmount = rawCredit;
                actualPaymentType = paidAmount > 0 ? (body.payment_method || body.payment_type || 'Credit') : 'Credit';
            }
        } else {
            // Normal Sale: Full payment collected at selling price
            actualSaleType = 'sale';
            paidAmount = grandTotal;
            creditAmount = 0.00;
            actualPaymentType = ['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(paymentType) ? paymentType : 'Cash';
        }

        let prevOutstanding = 0.00;
        let creditLimit = 0.00;
        let creditAllowed = 1;
        let newOutstanding = 0.00;

        if (customer) {
            const fSummary = await getCustomerFinancialSummary(pool, customer.id, customer);
            prevOutstanding = safeNum(fSummary ? fSummary.current_outstanding : 0, 0.00);
            creditLimit = safeNum(customer.credit_limit, 0.00);
            creditAllowed = parseInt(customer.credit_allowed !== undefined ? customer.credit_allowed : 1, 10) || 0;
            newOutstanding = prevOutstanding + creditAmount;

            if (creditAmount > 0.001) {
                if (creditAllowed === 0) {
                    errors.push(`Credit is not allowed for customer '${customer.customer_name}'. Please choose full payment or update customer credit permissions.`);
                } else {
                    const creditEval = evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed);
                    if (creditEval.is_exceeded) {
                        if (!creditOverride) {
                            errors.push("Sale exceeds customer's credit limit. Check this box to authorize and record this transaction.");
                        }
                    }
                }
            }
        }

        let isLimitExceeded = false;
        if (customer && creditAmount > 0.001) {
            const creditEval = evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed);
            isLimitExceeded = Boolean(creditEval && creditEval.is_exceeded);
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
                currentSalesDateTime,
                saleType: actualSaleType,
                finalGrandTotal: body.final_grand_total !== undefined ? body.final_grand_total : '',
                amountReceived: body.amount_received !== undefined ? body.amount_received : (body.paid_amount || '0.00'),
                selectedCustomerId: customerId,
                paymentType: actualPaymentType,
                notes,
                creditOverride,
                creditLimitExceeded: isLimitExceeded,
                otherCharges: inputOtherCharges,
                productsList,
                customersList,
                initialItemsFormatted: validatedItems.length > 0 ? validatedItems.map(it => ({
                    product_id: it.product_id,
                    product_code: it.product_code,
                    product_name: it.product_name,
                    unit_name: it.unit_name || 'Unit',
                    quantity: it.quantity,
                    unit_price: it.unit_price,
                    discount: it.discount,
                    tax_percent: it.tax_percent
                })) : (Array.isArray(itemsInput) ? itemsInput.map(it => ({
                    product_id: parseInt(it.product_id || 0, 10),
                    quantity: safeNum(it.quantity, 1),
                    discount: safeNum(it.discount, 0),
                    tax_percent: safeNum(it.tax_percent, 0)
                })) : []),
                errors
            });
        }

        const finalCreditEval = (customer && creditAmount > 0.001)
            ? evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed)
            : { status: 'Within Limit' };
        const creditStatus = (creditAmount > 0.001) ? finalCreditEval.status : 'Within Limit';
        const finalCustomerId = customer ? customer.id : null;
        const firstPayment = paidAmount;

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const finalNoteNo = await generateSalesNoteNumber();
            const userId = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;

            const [insertResult] = await conn.query(
                `INSERT INTO sales_notes (
                    sales_note_no, customer_id, sales_date, sales_time, sale_type, payment_type,
                    subtotal, discount, tax, other_charges, round_off, total_amount,
                    paid_amount, first_payment, credit_amount, previous_outstanding, new_outstanding,
                    credit_limit, credit_status, credit_override, notes, status,
                    created_by, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
                [
                    finalNoteNo,
                    finalCustomerId,
                    salesDate,
                    salesTime,
                    actualSaleType,
                    actualPaymentType,
                    safeNum(serverSubtotal, 0.00),
                    safeNum(totalDiscountToSave, 0.00),
                    safeNum(serverTotalTax, 0.00),
                    safeNum(inputOtherCharges, 0.00),
                    safeNum(roundOff, 0.00),
                    safeNum(grandTotal, 0.00),
                    safeNum(paidAmount, 0.00),
                    safeNum(firstPayment, 0.00),
                    safeNum(creditAmount, 0.00),
                    safeNum(prevOutstanding, 0.00),
                    safeNum(newOutstanding, 0.00),
                    safeNum(creditLimit, 0.00),
                    creditStatus,
                    creditOverride ? 1 : 0,
                    notes || null,
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
                        salesNoteId,
                        item.product_id,
                        item.product_code,
                        item.product_name,
                        item.unit_name,
                        safeNum(item.quantity, 1.00),
                        safeNum(item.unit_price, 0.00),
                        safeNum(item.discount, 0.00),
                        safeNum(item.tax_percent, 0.00),
                        safeNum(item.tax_amount, 0.00),
                        safeNum(item.line_total, 0.00)
                    ]
                );

                await conn.query(
                    `UPDATE product_master 
                    SET stock_quantity = stock_quantity - ? 
                    WHERE id = ?`,
                    [safeNum(item.quantity, 1.00), item.product_id]
                );
            }

            // Record customer financial transaction ONLY if customer is selected
            if (finalCustomerId) {
                const paymentStatus = (paidAmount >= grandTotal - 0.001) ? 'Paid' : ((paidAmount > 0.001) ? 'Partial' : 'Unpaid');
                const nextTxId = await getNextId(conn, 'customer_transactions');

                await conn.query(
                    `INSERT INTO customer_transactions (
                        id, customer_id, transaction_type, reference_number, transaction_date,
                        total_amount, paid_amount, debit_amount, credit_amount,
                        payment_method, payment_status, reason, notes,
                        created_by, created_at
                    ) VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, NOW())`,
                    [
                        nextTxId,
                        finalCustomerId,
                        finalNoteNo,
                        `${salesDate} ${salesTime}:00`,
                        safeNum(grandTotal, 0.00),
                        safeNum(paidAmount, 0.00),
                        safeNum(creditAmount, 0.00),
                        actualPaymentType,
                        paymentStatus,
                        actualSaleType === 'credit' ? `Credit Sale ${finalNoteNo}` : `Sales Note ${finalNoteNo}`,
                        notes || null,
                        userId
                    ]
                );
            }

            await conn.commit();
            conn.release();

            return res.redirect(`/sales-notes?success=${encodeURIComponent(`Sales Note ${finalNoteNo} created successfully!`)}`);
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
        const id = parseInt(req.params.id || req.query.id || req.body.id || 0, 10);
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

        const [paymentRows] = await pool.query(
            `SELECT * FROM customer_transactions
            WHERE reference_number = ? AND transaction_type = 'payment'
            ORDER BY transaction_date ASC, id ASC`,
            [sale.sales_note_no]
        );
        const allPayments = buildPaymentsList(sale, paymentRows);
        const totalSubPayments = paymentRows.reduce((sum, p) => sum + parseFloat(p.credit_amount || 0), 0);
        const firstPaymentAmt = (sale.first_payment !== undefined && sale.first_payment !== null)
            ? parseFloat(sale.first_payment)
            : Math.max(0.00, parseFloat(sale.paid_amount || 0) - totalSubPayments);

        const saleTypeInfo = getSaleTypeInfo(sale.sale_type, sale.credit_amount, sale.payment_type);
        const saleType = saleTypeInfo.type;
        const paymentStatusInfo = getPaymentStatusInfo(sale.paid_amount, sale.total_amount);
        const finalGrandTotal = parseFloat(sale.total_amount || 0).toFixed(2);
        const amountReceived = firstPaymentAmt.toFixed(2);
        const balanceAmount = paymentStatusInfo.balance.toFixed(2);

        res.render('edit_sales_note', {
            pageTitle: 'Edit Sales Note',
            sale,
            saleType,
            saleTypeInfo,
            finalGrandTotal,
            amountReceived,
            balanceAmount,
            firstPaymentAmt,
            totalSubPayments,
            allPayments,
            paymentStatusInfo,
            productsList,
            customersList,
            initialItemsFormatted,
            getPaymentStatusInfo,
            getSaleTypeInfo,
            getPaymentTypeBadge,
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
        const id = parseInt(req.params.id || req.query.id || req.body.id || 0, 10);
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
        const savedSaleType = (sale.sale_type === 'credit' || parseFloat(sale.credit_amount || 0) > 0.001 || sale.payment_type === 'Credit') ? 'credit' : 'sale';
        const saleType = (body.sale_type || savedSaleType).trim();
        const salesDate = (body.sales_date || sale.sales_date).trim();
        const salesTime = (body.sales_time || sale.sales_time).trim();
        const paymentType = (body.payment_type || sale.payment_type).trim();
        const itemsInput = body.items || [];
        const inputOtherCharges = Math.max(0.00, safeNum(body.other_charges, 0.00));
        const notes = (body.notes || '').trim();
        let creditOverride = (body.credit_override === '1' || body.credit_override === 1 || body.credit_override === 'on' || body.credit_override === true || body.credit_override === 'true') ? 1 : 0;

        let customer = null;
        const customerId = body.customer_id ? parseInt(body.customer_id, 10) : (sale.customer_id ? parseInt(sale.customer_id, 10) : null);

        if (saleType === 'credit') {
            if (!customerId || isNaN(customerId) || customerId <= 0) {
                return res.redirect(`/edit_sales_note.php?id=${id}&error=${encodeURIComponent('Customer selection is required for Credit Sale.')}`);
            }
            const [custRows] = await pool.query('SELECT * FROM customer_master WHERE id = ? AND status = 1 LIMIT 1', [customerId]);
            if (!custRows.length) {
                return res.redirect(`/edit_sales_note.php?id=${id}&error=${encodeURIComponent('Selected customer does not exist or is inactive.')}`);
            }
            customer = custRows[0];
        } else {
            if (customerId && customerId > 0) {
                const [custRows] = await pool.query('SELECT * FROM customer_master WHERE id = ? AND status = 1 LIMIT 1', [customerId]);
                if (custRows.length) {
                    customer = custRows[0];
                }
            }
        }

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
                    [safeNum(oldItem.quantity, 0.00), parseInt(oldItem.product_id, 10)]
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
                const qty = Math.max(0.00, safeNum(itemData.quantity, 0.00));
                const itemDiscount = Math.max(0.00, safeNum(itemData.discount, 0.00));
                const itemTaxPercent = Math.max(0.00, safeNum(itemData.tax_percent, 0.00));

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

                const availableStock = safeNum(product.stock_quantity, 0.00);
                if (availableStock <= 0) {
                    throw new Error("This product is out of stock and cannot be added to the sale.");
                }
                if (qty > availableStock) {
                    throw new Error(`Insufficient stock for '${product.product_name}'. Available: ${availableStock}, Requested: ${qty}.`);
                }

                const unitPrice = safeNum(product.selling_price, 0.00);
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
            const rawCalculatedGrandTotal = Math.max(0.00, (serverSubtotal - serverTotalDiscount) + serverTotalTax + inputOtherCharges);
            const roundedGrandTotal = Math.round(rawCalculatedGrandTotal);
            const calculatedGrandTotal = roundedGrandTotal;
            let roundOff = Number((roundedGrandTotal - rawCalculatedGrandTotal).toFixed(2));
            let finalGrandTotal = calculatedGrandTotal;

            if (body.final_grand_total !== undefined && body.final_grand_total !== null && String(body.final_grand_total).trim() !== '') {
                const parsedFinal = safeNum(body.final_grand_total, -1);
                if (parsedFinal <= 0) {
                    throw new Error('Adjusted / Final Grand Total must be a valid amount greater than zero.');
                } else if (parsedFinal > calculatedGrandTotal + 0.01 && parsedFinal > rawCalculatedGrandTotal + 0.01) {
                    throw new Error(`Adjusted / Final Grand Total (₹${parsedFinal.toFixed(2)}) cannot exceed the calculated Grand Total (₹${calculatedGrandTotal.toFixed(2)}).`);
                } else {
                    finalGrandTotal = parsedFinal;
                }
            }
            if (body.round_off !== undefined && body.round_off !== null && String(body.round_off).trim() !== '') {
                roundOff = safeNum(body.round_off, roundOff);
            }

            const effectiveAdjustmentDiscount = Math.max(0.00, calculatedGrandTotal - finalGrandTotal);
            const totalDiscountToSave = serverTotalDiscount + effectiveAdjustmentDiscount;
            const grandTotal = finalGrandTotal;

            // Preserve any subsequent credit payments made via Receive Payment
            const [subPayments] = await conn.query(
                `SELECT COALESCE(SUM(credit_amount), 0) AS total_sub_payments
                FROM customer_transactions
                WHERE reference_number = ? AND transaction_type = 'payment'`,
                [sale.sales_note_no]
            );
            const totalSubPayments = safeNum(subPayments[0].total_sub_payments, 0.00);

            let actualSaleType = saleType;
            let paidAmount = 0.00;
            let firstPayment = 0.00;
            let creditAmount = 0.00;
            let actualPaymentType = 'Cash';

            if (saleType === 'credit') {
                const inputReceived = safeNum(body.amount_received !== undefined && String(body.amount_received).trim() !== ''
                    ? body.amount_received
                    : (body.paid_amount !== undefined && String(body.paid_amount).trim() !== '' ? body.paid_amount : 0.00), 0.00);

                if (inputReceived < 0) {
                    throw new Error('Amount Received Now must be a non-negative number.');
                } else if (inputReceived > grandTotal + 0.01) {
                    throw new Error(`Amount Received (₹${inputReceived.toFixed(2)}) cannot be greater than Grand Total (Final Grand Total: ₹${grandTotal.toFixed(2)}).`);
                }

                firstPayment = Math.min(grandTotal, Math.max(0.00, inputReceived));
                paidAmount = Math.min(grandTotal, firstPayment + totalSubPayments);
                creditAmount = Math.max(0.00, grandTotal - paidAmount);

                // User requirement:
                // If Amount Received / Paid == Grand Total, save as Normal Sale!
                // Only if Amount Received < Grand Total (creditAmount > 0.001), save as Credit Sale!
                if (creditAmount <= 0.001) {
                    actualSaleType = 'sale';
                    paidAmount = grandTotal;
                    creditAmount = 0.00;
                    actualPaymentType = ['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(body.payment_method || body.payment_type)
                        ? (body.payment_method || body.payment_type)
                        : 'Cash';
                } else {
                    actualSaleType = 'credit';
                    actualPaymentType = paidAmount > 0 ? (body.payment_method || body.payment_type || 'Credit') : 'Credit';
                }
            } else {
                actualSaleType = 'sale';
                paidAmount = grandTotal;
                firstPayment = grandTotal;
                creditAmount = 0.00;
                actualPaymentType = ['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(paymentType) ? paymentType : 'Cash';
            }

            // Initial credit created by this sale
            const initialSaleCredit = (actualSaleType === 'credit')
                ? Math.max(0.00, grandTotal - firstPayment)
                : 0.00;

            // STEP 4: Delete old customer_transaction under the old customer if present
            if (sale.customer_id) {
                await conn.query(
                    `DELETE FROM customer_transactions 
                    WHERE customer_id = ? 
                      AND reference_number = ? 
                      AND transaction_type = 'sale'`,
                    [parseInt(sale.customer_id, 10), sale.sales_note_no]
                );
            }

            let prevOutstanding = 0.00;
            let creditLimit = 0.00;
            let creditAllowed = 1;
            let newOutstanding = 0.00;

            if (customer) {
                const fSummary = await getCustomerFinancialSummary(conn, customer.id, customer);
                const baseOutstanding = safeNum(fSummary ? fSummary.current_outstanding : 0, 0.00) + totalSubPayments;
                prevOutstanding = baseOutstanding;
                creditLimit = safeNum(customer.credit_limit, 0.00);
                creditAllowed = parseInt(customer.credit_allowed !== undefined ? customer.credit_allowed : 1, 10) || 0;
                newOutstanding = baseOutstanding + creditAmount;

                if (creditAmount > 0.001) {
                    if (creditAllowed === 0) {
                        throw new Error(`Credit is not allowed for customer '${customer.customer_name}'.`);
                    }
                    const creditEval = evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed);
                    if (creditEval.is_exceeded) {
                        if (!creditOverride) {
                            throw new Error("Sale exceeds customer's credit limit. Check this box to authorize and update this transaction.");
                        }
                    }
                }
            }

            const finalCreditEval = (customer && creditAmount > 0.001)
                ? evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed)
                : { status: 'Within Limit' };
            const creditStatus = (creditAmount > 0.001) ? finalCreditEval.status : 'Within Limit';
            const finalCustomerId = customer ? customer.id : null;

            // STEP 5: Update sales_notes record
            const userId = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
            await conn.query(
                `UPDATE sales_notes SET
                    customer_id = ?,
                    sales_date = ?,
                    sales_time = ?,
                    sale_type = ?,
                    payment_type = ?,
                    subtotal = ?,
                    discount = ?,
                    tax = ?,
                    other_charges = ?,
                    round_off = ?,
                    total_amount = ?,
                    paid_amount = ?,
                    first_payment = ?,
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
                    finalCustomerId,
                    salesDate,
                    salesTime,
                    actualSaleType,
                    actualPaymentType,
                    safeNum(serverSubtotal, 0.00),
                    safeNum(totalDiscountToSave, 0.00),
                    safeNum(serverTotalTax, 0.00),
                    safeNum(inputOtherCharges, 0.00),
                    safeNum(roundOff, 0.00),
                    safeNum(grandTotal, 0.00),
                    safeNum(paidAmount, 0.00),
                    safeNum(firstPayment, 0.00),
                    safeNum(creditAmount, 0.00),
                    safeNum(prevOutstanding, 0.00),
                    safeNum(newOutstanding, 0.00),
                    safeNum(creditLimit, 0.00),
                    creditStatus,
                    creditOverride ? 1 : 0,
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
                        safeNum(item.quantity, 1.00),
                        safeNum(item.unit_price, 0.00),
                        safeNum(item.discount, 0.00),
                        safeNum(item.tax_percent, 0.00),
                        safeNum(item.tax_amount, 0.00),
                        safeNum(item.line_total, 0.00)
                    ]
                );

                await conn.query(
                    `UPDATE product_master 
                    SET stock_quantity = stock_quantity - ? 
                    WHERE id = ?`,
                    [safeNum(item.quantity, 1.00), item.product_id]
                );
            }

            // STEP 7: Re-insert customer_transaction
            if (finalCustomerId) {
                const paymentStatus = (paidAmount >= grandTotal - 0.001) ? 'Paid' : ((paidAmount > 0.001) ? 'Partial' : 'Unpaid');
                const nextTxId = await getNextId(conn, 'customer_transactions');

                await conn.query(
                    `INSERT INTO customer_transactions (
                        id, customer_id, transaction_type, reference_number, transaction_date,
                        total_amount, paid_amount, debit_amount, credit_amount,
                        payment_method, payment_status, reason, notes,
                        created_by, created_at
                    ) VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, NOW())`,
                    [
                        nextTxId,
                        finalCustomerId,
                        sale.sales_note_no,
                        `${salesDate} ${salesTime}:00`,
                        safeNum(grandTotal, 0.00),
                        safeNum(paidAmount, 0.00),
                        safeNum(initialSaleCredit, 0.00),
                        actualPaymentType,
                        paymentStatus,
                        actualSaleType === 'credit' ? `Credit Sale ${sale.sales_note_no}` : `Sales Note ${sale.sales_note_no}`,
                        notes || null,
                        userId
                    ]
                );
            }

            await conn.commit();
            conn.release();

            return res.redirect(`/sales-notes/view/${id}?id=${id}&success=${encodeURIComponent(`Sales Note ${sale.sales_note_no} updated successfully!`)}`);
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

            const saleTypeInfo = getSaleTypeInfo(body.sale_type || sale.sale_type, body.credit_amount || sale.credit_amount, body.payment_type || sale.payment_type);
            const paymentStatusInfo = getPaymentStatusInfo(body.amount_received !== undefined ? body.amount_received : (body.paid_amount || sale.paid_amount), body.final_grand_total || sale.total_amount);

            const [paymentRows] = await pool.query(
                `SELECT * FROM customer_transactions
                WHERE reference_number = ? AND transaction_type = 'payment'
                ORDER BY transaction_date ASC, id ASC`,
                [sale.sales_note_no]
            );
            const allPayments = buildPaymentsList(sale, paymentRows);
            const totalSubPayments = paymentRows.reduce((sum, p) => sum + parseFloat(p.credit_amount || 0), 0);
            const firstPaymentAmt = (sale.first_payment !== undefined && sale.first_payment !== null)
                ? parseFloat(sale.first_payment)
                : Math.max(0.00, parseFloat(sale.paid_amount || 0) - totalSubPayments);

            return res.render('edit_sales_note', {
                pageTitle: 'Edit Sales Note',
                sale: { ...sale, ...body, credit_override: creditOverride },
                saleType: body.sale_type || (sale.sale_type === 'credit' ? 'credit' : 'sale'),
                saleTypeInfo,
                finalGrandTotal: body.final_grand_total || sale.total_amount,
                amountReceived: body.amount_received !== undefined ? body.amount_received : sale.paid_amount,
                balanceAmount: paymentStatusInfo.balance.toFixed(2),
                firstPaymentAmt,
                totalSubPayments,
                allPayments,
                paymentStatusInfo,
                productsList,
                customersList,
                initialItemsFormatted,
                creditLimitExceeded: true,
                getPaymentStatusInfo,
                getSaleTypeInfo,
                getPaymentTypeBadge,
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
        const id = parseInt(req.params.id || req.query.id || 0, 10);
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

        const [paymentHistory] = await pool.query(
            `SELECT * FROM customer_transactions 
            WHERE reference_number = ? AND transaction_type = 'payment'
            ORDER BY transaction_date ASC, id ASC`,
            [sale.sales_note_no]
        );

        const allPayments = buildPaymentsList(sale, paymentHistory);
        const totalCreditPayments = paymentHistory.reduce((sum, p) => sum + parseFloat(p.credit_amount || 0), 0);
        const firstPaymentAmt = (sale.first_payment !== undefined && sale.first_payment !== null)
            ? parseFloat(sale.first_payment)
            : Math.max(0.00, parseFloat(sale.paid_amount || 0) - totalCreditPayments);
        const remainingCredit = Math.max(0.00, parseFloat(sale.total_amount || 0) - parseFloat(sale.paid_amount || 0));

        const saleTypeInfo = getSaleTypeInfo(sale.sale_type, sale.credit_amount, sale.payment_type);
        const paymentStatusInfo = getPaymentStatusInfo(sale.paid_amount, sale.total_amount);

        res.render('view_sales_note', {
            pageTitle: 'View Sales Note',
            sale,
            items,
            evalCredit,
            autoPrint,
            saleTypeInfo,
            paymentStatusInfo,
            paymentHistory,
            allPayments,
            firstPaymentAmt,
            totalCreditPayments,
            remainingCredit,
            getPaymentStatusInfo,
            getSaleTypeInfo,
            getPaymentTypeBadge,
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (err) {
        console.error('viewSalesNote error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Record payment for Credit Sale
exports.receivePayment = async (req, res) => {
    try {
        const body = req.body || {};
        const salesNoteId = parseInt(body.sales_note_id || 0, 10);
        const paymentAmount = parseFloat(body.payment_amount || 0);
        const paymentMethod = (body.payment_method || 'Cash').trim();
        const paymentDateInput = body.payment_date ? body.payment_date.trim() : null;
        const notes = (body.notes || '').trim();

        if (salesNoteId <= 0) {
            return res.redirect(`/sales-notes?error=${encodeURIComponent('Invalid Sales Note ID.')}`);
        }

        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            return res.redirect(`/sales-notes?error=${encodeURIComponent('Payment amount must be greater than ₹0.00.')}`);
        }

        const validMethods = ['Cash', 'UPI', 'Card', 'Bank Transfer'];
        const actualPaymentMethod = validMethods.includes(paymentMethod) ? paymentMethod : 'Cash';

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [sales] = await conn.query(
                `SELECT sn.*, cm.customer_name, cm.customer_code 
                FROM sales_notes sn
                LEFT JOIN customer_master cm ON cm.id = sn.customer_id
                WHERE sn.id = ?
                LIMIT 1
                FOR UPDATE`,
                [salesNoteId]
            );

            if (!sales.length) {
                throw new Error('Sales Note record not found.');
            }
            const sale = sales[0];

            if (Number(sale.status) === 0) {
                throw new Error('Cannot receive payment for a cancelled Sales Note.');
            }

            const totalAmount = parseFloat(sale.total_amount || 0);
            const currentPaid = parseFloat(sale.paid_amount || 0);
            const currentBalance = Math.max(0.00, totalAmount - currentPaid);

            if (currentBalance <= 0.001) {
                throw new Error(`Sales Note ${sale.sales_note_no} is already fully paid.`);
            }

            if (paymentAmount > currentBalance + 0.01) {
                throw new Error(`Payment amount (₹${paymentAmount.toFixed(2)}) cannot exceed outstanding balance (₹${currentBalance.toFixed(2)}).`);
            }

            const newPaid = Math.min(totalAmount, currentPaid + paymentAmount);
            const newBalance = Math.max(0.00, totalAmount - newPaid);

            const userId = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;

            // Update sales_notes
            await conn.query(
                `UPDATE sales_notes 
                SET paid_amount = ?, 
                    credit_amount = ?, 
                    updated_by = ?, 
                    updated_at = NOW() 
                WHERE id = ?`,
                [newPaid, newBalance, userId, salesNoteId]
            );

            // Count existing payments to assign Payment 2, Payment 3, etc.
            const [existingPmts] = await conn.query(
                `SELECT COUNT(*) AS cnt FROM customer_transactions WHERE reference_number = ? AND transaction_type = 'payment'`,
                [sale.sales_note_no]
            );
            const subCount = parseInt(existingPmts[0].cnt || 0, 10);
            const hasInitialPay = (sale.first_payment !== undefined && sale.first_payment !== null) ? parseFloat(sale.first_payment) > 0.001 : (parseFloat(sale.paid_amount || 0) > subCount);
            const paymentNumber = (hasInitialPay ? 1 : 0) + subCount + 1;
            const defaultPaymentReason = `Payment ${paymentNumber} received for Credit Sale ${sale.sales_note_no}`;

            // Log customer transaction if customer_id exists
            if (sale.customer_id) {
                const now = new Date();
                const year = now.getFullYear();
                const month = String(now.getMonth() + 1).padStart(2, '0');
                const day = String(now.getDate()).padStart(2, '0');
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                const defaultDate = `${year}-${month}-${day} ${hours}:${minutes}:00`;
                const txDate = paymentDateInput ? `${paymentDateInput} 00:00:00` : defaultDate;

                const paymentStatus = (newPaid >= totalAmount - 0.001) ? 'Paid' : 'Partial';
                const nextTxId = await getNextId(conn, 'customer_transactions');

                await conn.query(
                    `INSERT INTO customer_transactions (
                        id, customer_id, transaction_type, reference_number, transaction_date,
                        total_amount, paid_amount, debit_amount, credit_amount,
                        payment_method, payment_status, reason, notes,
                        created_by, created_at
                    ) VALUES (?, ?, 'payment', ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        nextTxId,
                        sale.customer_id,
                        sale.sales_note_no,
                        txDate,
                        paymentAmount,
                        paymentAmount,
                        paymentAmount,
                        actualPaymentMethod,
                        paymentStatus,
                        `Payment on Credit Sale ${sale.sales_note_no}`,
                        notes || null,
                        userId
                    ]
                );
            }

            await conn.commit();
            conn.release();

            const redirectTarget = req.headers.referer && req.headers.referer.includes('/sales-notes/view/')
                ? `/sales-notes/view/${salesNoteId}`
                : '/sales-notes';

            const msg = `Payment ${paymentNumber} of ₹${paymentAmount.toFixed(2)} received successfully for ${sale.sales_note_no}. Remaining balance: ₹${newBalance.toFixed(2)}.`;
            return res.redirect(`${redirectTarget}?success=${encodeURIComponent(msg)}`);
        } catch (e) {
            await conn.rollback();
            conn.release();
            console.error('receivePayment transaction error:', e);
            const redirectTarget = req.headers.referer || '/sales-notes';
            return res.redirect(`${redirectTarget}${redirectTarget.includes('?') ? '&' : '?'}error=${encodeURIComponent(e.message)}`);
        }
    } catch (err) {
        console.error('receivePayment error:', err);
        return res.redirect(`/sales-notes?error=${encodeURIComponent('Internal server error: ' + err.message)}`);
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
