const pool = require('../config/db');
const { getCustomerFinancialSummary } = require('../utils/customerHelper');
const { evaluateCreditStatus } = require('../utils/salesNoteHelper');
const {
    generateRentalNumber,
    getEffectiveRentalStatus,
    getRentalStatusBadge,
    calculateRentalEstimate,
    getRentalAnalytics
} = require('../utils/rentalHelper');

/**
 * Format Date to Local ISO String for <input type="datetime-local">
 * e.g. YYYY-MM-DDTHH:mm
 */
function formatDatetimeLocal(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}

/**
 * Format Datetime string for MySQL DATETIME column: YYYY-MM-DD HH:mm:ss
 */
function formatMysqlDatetime(dtString) {
    if (!dtString) return null;
    const cleanStr = String(dtString).replace('T', ' ');
    if (cleanStr.length === 16) {
        return cleanStr + ':00';
    }
    return cleanStr;
}

/**
 * List / Manage Rentals
 * GET /manage_rental.php or /manage_rental
 */
exports.manageRentals = async (req, res) => {
    try {
        const {
            search = '',
            status = '',
            from_date = '',
            to_date = ''
        } = req.query;

        let sql = `
            SELECT
                r.*,
                cm.customer_code,
                cm.customer_name,
                cm.mobile_number,
                pm.product_code,
                pm.product_name,
                pm.short_name,
                b.brand_name,
                c.category_name,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM rentals r
            INNER JOIN customer_master cm ON cm.id = r.customer_id
            INNER JOIN product_master pm ON pm.id = r.product_id
            LEFT JOIN brand_master b ON b.id = pm.brand_id
            LEFT JOIN category_master c ON c.id = pm.category_id
            LEFT JOIN user_master creator ON creator.id = r.created_by
            LEFT JOIN user_master updater ON updater.id = r.updated_by
            WHERE 1=1
        `;
        const params = [];

        if (search.trim() !== '') {
            sql += ` AND (
                r.rental_no LIKE ?
                OR cm.customer_name LIKE ?
                OR cm.customer_code LIKE ?
                OR cm.mobile_number LIKE ?
                OR pm.product_name LIKE ?
                OR pm.product_code LIKE ?
            )`;
            const sp = `%${search.trim()}%`;
            params.push(sp, sp, sp, sp, sp, sp);
        }

        if (status !== '') {
            if (status === 'Overdue') {
                sql += ` AND (r.rental_status = 'Overdue' OR (r.rental_status = 'Active' AND r.expected_checkout_datetime < NOW()))`;
            } else if (status === 'Active') {
                sql += ` AND r.rental_status = 'Active' AND r.expected_checkout_datetime >= NOW()`;
            } else if (['Returned', 'Cancelled'].includes(status)) {
                sql += ` AND r.rental_status = ?`;
                params.push(status);
            }
        }

        if (from_date.trim() !== '') {
            sql += ` AND DATE(r.check_in_datetime) >= ?`;
            params.push(from_date.trim());
        }

        if (to_date.trim() !== '') {
            sql += ` AND DATE(r.check_in_datetime) <= ?`;
            params.push(to_date.trim());
        }

        sql += ` ORDER BY r.id DESC`;

        const [rentals] = await pool.query(sql, params);

        // Compute effective statuses
        rentals.forEach(r => {
            r.effective_status = getEffectiveRentalStatus(r.rental_status, r.expected_checkout_datetime);
        });

        // Compute analytics
        const analytics = await getRentalAnalytics(pool);

        res.render('manage_rental', {
            pageTitle: 'Rental Management',
            rentals,
            analytics,
            search,
            statusFilter: status,
            fromDateFilter: from_date,
            toDateFilter: to_date,
            getRentalStatusBadge,
            currentDatetimeLocal: formatDatetimeLocal()
        });
    } catch (err) {
        console.error('manageRentals error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

/**
 * Show Create Rental Form (Rental Checkout)
 * GET /create_rental.php or /create_rental
 */
exports.createRentalForm = async (req, res) => {
    try {
        const [customers] = await pool.query(`
            SELECT id, customer_code, customer_name, company_name, mobile_number, credit_allowed, credit_limit
            FROM customer_master
            WHERE status = 1
            ORDER BY customer_name ASC
        `);

        const [products] = await pool.query(`
            SELECT 
                p.id, 
                p.product_code, 
                p.product_name, 
                p.short_name, 
                p.stock_quantity,
                b.brand_name,
                c.category_name
            FROM product_master p
            LEFT JOIN brand_master b ON b.id = p.brand_id
            LEFT JOIN category_master c ON c.id = p.category_id
            WHERE p.status = 1 AND p.rental_available = 1 AND p.stock_quantity > 0
            ORDER BY p.product_name ASC
        `);

        const [rentalRates] = await pool.query(`
            SELECT prr.*, u.unit_name, u.unit_code
            FROM product_rental_rates prr
            LEFT JOIN unit_master u ON u.id = prr.rental_unit_id
            WHERE prr.available = 1
        `);

        const rentalNo = await generateRentalNumber(pool);

        const now = new Date();
        const defaultCheckIn = formatDatetimeLocal(now);

        // Default expected return: +1 day at the same time
        const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const defaultCheckOut = formatDatetimeLocal(nextDay);

        res.render('create_rental', {
            pageTitle: 'Rental Checkout',
            rentalNo,
            customers,
            products,
            rentalRates,
            defaultCheckIn,
            defaultCheckOut,
            old: req.body || {},
            errors: []
        });
    } catch (err) {
        console.error('createRentalForm error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

/**
 * Process Create Rental Submission
 * POST /create_rental.php or /create_rental
 */
exports.createRental = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const body = req.body || {};
        const customerId = parseInt(body.customer_id || 0, 10);
        const productId = parseInt(body.product_id || 0, 10);
        const checkInDatetimeStr = (body.check_in_datetime || '').trim();
        const expectedCheckoutDatetimeStr = (body.expected_checkout_datetime || '').trim();
        const rentalPeriodType = (body.rental_period_type || 'daily').trim();
        const rentalRate = parseFloat(body.rental_rate || 0);
        const securityDeposit = parseFloat(body.security_deposit || 0);
        const advanceRentalAmount = parseFloat(body.advance_rental_amount !== undefined && body.advance_rental_amount !== '' ? body.advance_rental_amount : 0);
        const totalEstimatedAmount = parseFloat(body.total_rental_amount || 0);
        const paymentMethod = (body.payment_method || 'Cash').trim();
        const notes = (body.notes || '').trim();
        const userId = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

        const errors = [];

        // 1. Customer Validation
        if (customerId <= 0) {
            errors.push('Please select a valid customer.');
        } else {
            const [cRows] = await pool.query('SELECT id, customer_name, customer_code, status FROM customer_master WHERE id = ?', [customerId]);
            if (!cRows.length || Number(cRows[0].status) !== 1) {
                errors.push('Selected customer does not exist or is inactive.');
            }
        }

        // 2. Product Validation
        let selectedProduct = null;
        if (productId <= 0) {
            errors.push('Please select a valid rental product.');
        } else {
            const [pRows] = await pool.query(
                'SELECT id, product_code, product_name, rental_available, stock_quantity, status FROM product_master WHERE id = ?',
                [productId]
            );
            if (!pRows.length || Number(pRows[0].status) !== 1) {
                errors.push('Selected product does not exist or is inactive.');
            } else if (Number(pRows[0].rental_available) !== 1) {
                errors.push('Selected product is not marked as a Rental product.');
            } else if (parseInt(pRows[0].stock_quantity || 0, 10) <= 0) {
                errors.push('Selected product is currently out of stock or already rented out.');
            } else {
                selectedProduct = pRows[0];
            }
        }

        // 3. Datetime Validation
        if (!checkInDatetimeStr) {
            errors.push('Check-In Date & Time is required.');
        }
        if (!expectedCheckoutDatetimeStr) {
            errors.push('Check-Out (Expected Return) Date & Time is required.');
        }

        const checkInDate = new Date(checkInDatetimeStr);
        const checkOutDate = new Date(expectedCheckoutDatetimeStr);

        if (isNaN(checkInDate.getTime())) {
            errors.push('Invalid Check-In Date & Time.');
        }
        if (isNaN(checkOutDate.getTime())) {
            errors.push('Invalid Check-Out Date & Time.');
        }
        if (!isNaN(checkInDate.getTime()) && !isNaN(checkOutDate.getTime())) {
            if (checkOutDate <= checkInDate) {
                errors.push('Expected Check-Out Date & Time must be later than Check-In Date & Time.');
            }
        }

        // 4. Advance Rental Amount Validation
        if (isNaN(advanceRentalAmount)) {
            errors.push('Advance Rental Amount must be a valid number.');
        } else if (advanceRentalAmount < 0) {
            errors.push('Advance Rental Amount cannot be negative.');
        }

        // Return with errors if any
        if (errors.length > 0) {
            const [customers] = await pool.query(`SELECT id, customer_code, customer_name, company_name, mobile_number FROM customer_master WHERE status = 1 ORDER BY customer_name ASC`);
            const [products] = await pool.query(`SELECT p.id, p.product_code, p.product_name, p.short_name, p.stock_quantity FROM product_master p WHERE p.status = 1 AND p.rental_available = 1 AND p.stock_quantity > 0`);
            const [rentalRates] = await pool.query(`SELECT prr.*, u.unit_name, u.unit_code FROM product_rental_rates prr LEFT JOIN unit_master u ON u.id = prr.rental_unit_id WHERE prr.available = 1`);
            const rentalNo = await generateRentalNumber(pool);

            return res.render('create_rental', {
                pageTitle: 'Rental Checkout',
                rentalNo,
                customers,
                products,
                rentalRates,
                defaultCheckIn: checkInDatetimeStr || formatDatetimeLocal(),
                defaultCheckOut: expectedCheckoutDatetimeStr || formatDatetimeLocal(),
                old: body,
                errors
            });
        }

        // --- Database Transaction ---
        await conn.beginTransaction();

        // 1. Re-check and lock product stock
        const [lockedProducts] = await conn.query(
            'SELECT id, product_code, product_name, stock_quantity, rental_available FROM product_master WHERE id = ? FOR UPDATE',
            [productId]
        );

        if (!lockedProducts.length || lockedProducts[0].stock_quantity <= 0) {
            await conn.rollback();
            conn.release();
            const [customers] = await pool.query(`SELECT id, customer_code, customer_name, company_name, mobile_number FROM customer_master WHERE status = 1 ORDER BY customer_name ASC`);
            const [products] = await pool.query(`SELECT p.id, p.product_code, p.product_name, p.short_name, p.stock_quantity FROM product_master p WHERE p.status = 1 AND p.rental_available = 1 AND p.stock_quantity > 0`);
            const [rentalRates] = await pool.query(`SELECT prr.*, u.unit_name, u.unit_code FROM product_rental_rates prr LEFT JOIN unit_master u ON u.id = prr.rental_unit_id WHERE prr.available = 1`);

            return res.render('create_rental', {
                pageTitle: 'Rental Checkout',
                rentalNo: await generateRentalNumber(pool),
                customers,
                products,
                rentalRates,
                defaultCheckIn: checkInDatetimeStr,
                defaultCheckOut: expectedCheckoutDatetimeStr,
                old: body,
                errors: ['Product became unavailable during checkout. Please choose another product.']
            });
        }

        // 2. Generate unique rental number
        const rentalNo = await generateRentalNumber(conn);

        // 3. Insert into rentals table
        const mysqlCheckIn = formatMysqlDatetime(checkInDatetimeStr);
        const mysqlCheckOut = formatMysqlDatetime(expectedCheckoutDatetimeStr);

        const [rentalInsert] = await conn.query(
            `INSERT INTO rentals (
                rental_no,
                customer_id,
                product_id,
                rental_period_type,
                rental_rate,
                security_deposit,
                check_in_datetime,
                expected_checkout_datetime,
                advance_rental_amount,
                total_rental_amount,
                payment_method,
                rental_status,
                notes,
                created_by,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, NOW())`,
            [
                rentalNo,
                customerId,
                productId,
                rentalPeriodType,
                rentalRate,
                securityDeposit,
                mysqlCheckIn,
                mysqlCheckOut,
                advanceRentalAmount,
                totalEstimatedAmount > 0 ? totalEstimatedAmount : rentalRate,
                paymentMethod,
                notes || null,
                userId
            ]
        );

        const rentalId = rentalInsert.insertId;

        // 4. Update product inventory / stock
        await conn.query(
            'UPDATE product_master SET stock_quantity = GREATEST(0, stock_quantity - 1), updated_by = ?, updated_at = NOW() WHERE id = ?',
            [userId, productId]
        );

        // 5. Create customer transaction ledger entry
        const effectiveTotal = totalEstimatedAmount > 0 ? totalEstimatedAmount : (advanceRentalAmount > 0 ? advanceRentalAmount : rentalRate);
        const debitAmount = Math.max(0, effectiveTotal - advanceRentalAmount);
        const paymentStatus = (advanceRentalAmount >= effectiveTotal && effectiveTotal > 0) ? 'Paid' : ((advanceRentalAmount > 0.001) ? 'Partial' : 'Unpaid');

        await conn.query(
            `INSERT INTO customer_transactions (
                customer_id,
                transaction_type,
                reference_number,
                transaction_date,
                due_date,
                total_amount,
                paid_amount,
                debit_amount,
                credit_amount,
                payment_method,
                payment_status,
                reason,
                notes,
                created_by,
                created_at
            ) VALUES (?, 'rental', ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, ?, ?, NOW())`,
            [
                customerId,
                rentalNo,
                mysqlCheckIn,
                mysqlCheckOut.split(' ')[0], // Date part
                effectiveTotal,
                advanceRentalAmount,
                debitAmount,
                paymentMethod,
                paymentStatus,
                `Rental ${rentalNo} - ${selectedProduct ? selectedProduct.product_name : 'Tool'}`,
                notes || null,
                userId
            ]
        );

        await conn.commit();
        conn.release();

        return res.redirect(`/view_rental.php?id=${rentalId}&success=${encodeURIComponent(`Rental ${rentalNo} created successfully!`)}`);
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('createRental error:', err);

        const [customers] = await pool.query(`SELECT id, customer_code, customer_name, company_name, mobile_number FROM customer_master WHERE status = 1 ORDER BY customer_name ASC`);
        const [products] = await pool.query(`SELECT p.id, p.product_code, p.product_name, p.short_name, p.stock_quantity FROM product_master p WHERE p.status = 1 AND p.rental_available = 1 AND p.stock_quantity > 0`);
        const [rentalRates] = await pool.query(`SELECT prr.*, u.unit_name, u.unit_code FROM product_rental_rates prr LEFT JOIN unit_master u ON u.id = prr.rental_unit_id WHERE prr.available = 1`);

        return res.render('create_rental', {
            pageTitle: 'Rental Checkout',
            rentalNo: await generateRentalNumber(pool),
            customers,
            products,
            rentalRates,
            defaultCheckIn: req.body?.check_in_datetime || formatDatetimeLocal(),
            defaultCheckOut: req.body?.expected_checkout_datetime || formatDatetimeLocal(),
            old: req.body || {},
            errors: ['An unexpected error occurred: ' + err.message]
        });
    }
};

/**
 * View Rental Details
 * GET /view_rental.php or /view_rental
 */
exports.viewRental = async (req, res) => {
    try {
        const id = parseInt(req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Invalid Rental ID'));
        }

        const [rows] = await pool.query(
            `SELECT
                r.*,
                cm.customer_code,
                cm.customer_name,
                cm.customer_type,
                cm.company_name,
                cm.mobile_number,
                cm.email AS customer_email,
                cm.address AS customer_address,
                cm.city AS customer_city,
                cm.state AS customer_state,
                cm.pincode AS customer_pincode,
                cm.credit_allowed,
                cm.credit_limit,
                pm.product_code,
                pm.product_name,
                pm.short_name,
                pm.stock_quantity AS current_stock,
                b.brand_name,
                c.category_name,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM rentals r
            INNER JOIN customer_master cm ON cm.id = r.customer_id
            INNER JOIN product_master pm ON pm.id = r.product_id
            LEFT JOIN brand_master b ON b.id = pm.brand_id
            LEFT JOIN category_master c ON c.id = pm.category_id
            LEFT JOIN user_master creator ON creator.id = r.created_by
            LEFT JOIN user_master updater ON updater.id = r.updated_by
            WHERE r.id = ?
            LIMIT 1`,
            [id]
        );

        if (!rows.length) {
            return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Rental record not found.'));
        }

        const rental = rows[0];
        rental.effective_status = getEffectiveRentalStatus(rental.rental_status, rental.expected_checkout_datetime);

        // Fetch primary product image
        const [images] = await pool.query(
            'SELECT image_path, is_primary FROM product_images WHERE product_id = ? ORDER BY is_primary DESC LIMIT 1',
            [rental.product_id]
        );
        const productImage = images.length > 0 ? images[0].image_path : null;

        // Fetch customer financial summary
        const customerSummary = await getCustomerFinancialSummary(pool, rental.customer_id);

        res.render('view_rental', {
            pageTitle: `Rental ${rental.rental_no}`,
            rental,
            productImage,
            customerSummary,
            getRentalStatusBadge,
            currentDatetimeLocal: formatDatetimeLocal()
        });
    } catch (err) {
        console.error('viewRental error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

/**
 * Return Rental Product
 * POST /return_rental.php or /return_rental
 */
exports.returnRental = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const id = parseInt(req.body.id || req.query.id || 0, 10);
        if (id <= 0) {
            conn.release();
            return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Invalid Rental ID'));
        }

        const [rentals] = await conn.query('SELECT * FROM rentals WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
        if (!rentals.length) {
            conn.release();
            return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Rental not found'));
        }

        const rental = rentals[0];
        if (rental.rental_status === 'Returned') {
            conn.release();
            return res.redirect(`/view_rental.php?id=${id}&error=` + encodeURIComponent('This rental has already been marked as returned.'));
        }
        if (rental.rental_status === 'Cancelled') {
            conn.release();
            return res.redirect(`/view_rental.php?id=${id}&error=` + encodeURIComponent('Cannot return a cancelled rental.'));
        }

        const actualReturnDatetimeStr = (req.body.actual_return_datetime || '').trim() || formatDatetimeLocal();
        const totalRentalAmount = req.body.total_rental_amount !== undefined && req.body.total_rental_amount !== ''
            ? parseFloat(req.body.total_rental_amount)
            : parseFloat(rental.total_rental_amount || 0);
        const additionalCharges = parseFloat(req.body.additional_charges || 0);
        const refundAmount = parseFloat(req.body.refund_amount || 0);
        const notes = (req.body.notes || '').trim();
        const userId = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

        const mysqlReturnDatetime = formatMysqlDatetime(actualReturnDatetimeStr);

        await conn.beginTransaction();

        // 1. Update Rental Status to Returned
        await conn.query(
            `UPDATE rentals SET
                actual_return_datetime = ?,
                total_rental_amount = ?,
                additional_charges = ?,
                refund_amount = ?,
                rental_status = 'Returned',
                notes = CASE WHEN ? != '' THEN CONCAT(COALESCE(notes, ''), '\n[Return Note]: ', ?) ELSE notes END,
                updated_by = ?,
                updated_at = NOW()
            WHERE id = ?`,
            [
                mysqlReturnDatetime,
                totalRentalAmount,
                additionalCharges,
                refundAmount,
                notes,
                notes,
                userId,
                id
            ]
        );

        // 2. Restore Product Stock (+1)
        await conn.query(
            'UPDATE product_master SET stock_quantity = stock_quantity + 1, updated_by = ?, updated_at = NOW() WHERE id = ?',
            [userId, rental.product_id]
        );

        // 3. Update customer transaction ledger to reflect settlement
        const finalNetDue = totalRentalAmount + additionalCharges - refundAmount;
        const advancePaid = parseFloat(rental.advance_rental_amount || 0);
        const remainingBalance = Math.max(0, finalNetDue - advancePaid);
        const paymentStatus = (remainingBalance <= 0.001) ? 'Settled' : 'Partial';

        await conn.query(
            `UPDATE customer_transactions SET
                total_amount = ?,
                paid_amount = ?,
                debit_amount = ?,
                payment_status = ?,
                notes = CONCAT(COALESCE(notes, ''), ' | Returned on ', ?)
            WHERE reference_number = ? AND transaction_type = 'rental'`,
            [
                finalNetDue,
                advancePaid,
                remainingBalance,
                paymentStatus,
                actualReturnDatetimeStr,
                rental.rental_no
            ]
        );

        await conn.commit();
        conn.release();

        return res.redirect(`/view_rental.php?id=${id}&success=${encodeURIComponent(`Product for Rental ${rental.rental_no} returned successfully. Product stock restored to inventory.`)}`);
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('returnRental error:', err);
        return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Return failed: ' + err.message));
    }
};

/**
 * Cancel Rental
 * POST /cancel_rental.php or /cancel_rental
 */
exports.cancelRental = async (req, res) => {
    const conn = await pool.getConnection();
    try {
        const id = parseInt(req.body.id || req.query.id || 0, 10);
        if (id <= 0) {
            conn.release();
            return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Invalid Rental ID'));
        }

        const [rentals] = await conn.query('SELECT * FROM rentals WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
        if (!rentals.length) {
            conn.release();
            return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Rental not found'));
        }

        const rental = rentals[0];
        if (rental.rental_status === 'Returned') {
            conn.release();
            return res.redirect(`/view_rental.php?id=${id}&error=` + encodeURIComponent('Cannot cancel a returned rental.'));
        }
        if (rental.rental_status === 'Cancelled') {
            conn.release();
            return res.redirect(`/view_rental.php?id=${id}&error=` + encodeURIComponent('Rental is already cancelled.'));
        }

        const userId = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;
        const cancelReason = (req.body.reason || 'Cancelled by user').trim();

        await conn.beginTransaction();

        // 1. Update Rental Status to Cancelled
        await conn.query(
            `UPDATE rentals SET
                rental_status = 'Cancelled',
                notes = CONCAT(COALESCE(notes, ''), '\n[Cancelled]: ', ?),
                updated_by = ?,
                updated_at = NOW()
            WHERE id = ?`,
            [cancelReason, userId, id]
        );

        // 2. Restore Product Stock (+1)
        await conn.query(
            'UPDATE product_master SET stock_quantity = stock_quantity + 1, updated_by = ?, updated_at = NOW() WHERE id = ?',
            [userId, rental.product_id]
        );

        // 3. Remove customer transaction
        await conn.query(
            "DELETE FROM customer_transactions WHERE reference_number = ? AND transaction_type = 'rental'",
            [rental.rental_no]
        );

        await conn.commit();
        conn.release();

        return res.redirect(`/manage_rental.php?success=${encodeURIComponent(`Rental ${rental.rental_no} cancelled successfully. Product stock restored.`)}`);
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('cancelRental error:', err);
        return res.redirect('/manage_rental.php?error=' + encodeURIComponent('Cancellation failed: ' + err.message));
    }
};

/**
 * AJAX API Handler for Rental Operations
 * ALL /ajax_rental.php or /ajax_rental
 */
exports.ajaxRental = async (req, res) => {
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

                return res.json({
                    success: true,
                    customer: {
                        id: parseInt(customer.id, 10),
                        customer_code: customer.customer_code,
                        customer_name: customer.customer_name,
                        company_name: customer.company_name || '',
                        mobile_number: customer.mobile_number,
                        email: customer.email || '',
                        address: addressParts.join(', ') || 'N/A',
                        credit_allowed: parseInt(customer.credit_allowed, 10),
                        credit_limit: parseFloat(customer.credit_limit),
                        current_outstanding: parseFloat(summary.current_outstanding),
                        available_credit: parseFloat(summary.available_credit),
                        credit_status: creditEval.status,
                        can_credit: creditEval.can_credit,
                        badge_class: creditEval.badge_class
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
                        b.brand_name
                    FROM product_master p
                    LEFT JOIN category_master c ON c.id = p.category_id
                    LEFT JOIN brand_master b ON b.id = p.brand_id
                    WHERE p.id = ? AND p.status = 1
                    LIMIT 1`,
                    [productId]
                );

                if (!rows.length) {
                    return res.status(404).json({ success: false, message: 'Product not found or inactive' });
                }
                const product = rows[0];

                // Fetch rental rates for this product
                const [rates] = await pool.query(
                    `SELECT prr.*, u.unit_name, u.unit_code
                    FROM product_rental_rates prr
                    LEFT JOIN unit_master u ON u.id = prr.rental_unit_id
                    WHERE prr.product_id = ? AND prr.available = 1`,
                    [productId]
                );

                // Fetch image
                const [images] = await pool.query(
                    'SELECT image_path FROM product_images WHERE product_id = ? ORDER BY is_primary DESC LIMIT 1',
                    [productId]
                );
                const imagePath = images.length > 0 ? images[0].image_path : null;

                return res.json({
                    success: true,
                    product: {
                        id: parseInt(product.id, 10),
                        product_code: product.product_code,
                        product_name: product.product_name,
                        short_name: product.short_name || '',
                        category_name: product.category_name || 'General',
                        brand_name: product.brand_name || 'Generic',
                        rental_available: parseInt(product.rental_available, 10),
                        stock_quantity: parseInt(product.stock_quantity || 0, 10),
                        image_path: imagePath,
                        rates: rates.map(r => ({
                            period: r.rental_period,
                            unit_name: r.unit_name || '',
                            unit_code: r.unit_code || '',
                            security_deposit: parseFloat(r.security_deposit || 0),
                            rental_rate: parseFloat(r.rental_rate || 0)
                        }))
                    }
                });
            }

            case 'calculate_estimate': {
                const periodType = (req.query.period_type || req.body.period_type || 'daily').trim();
                const rate = parseFloat(req.query.rate || req.body.rate || 0);
                const checkIn = req.query.check_in || req.body.check_in;
                const checkOut = req.query.check_out || req.body.check_out;

                const estimate = calculateRentalEstimate(periodType, rate, checkIn, checkOut);
                return res.json({
                    success: true,
                    estimate
                });
            }

            default:
                return res.status(400).json({ success: false, message: 'Invalid action' });
        }
    } catch (err) {
        console.error('ajaxRental error:', err);
        return res.status(400).json({ success: false, message: err.message });
    }
};
