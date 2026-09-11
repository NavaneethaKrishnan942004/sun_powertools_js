const pool = require('../config/db');
const { getCustomerFinancialSummary } = require('../utils/customerHelper');
const { evaluateCreditStatus } = require('../utils/salesNoteHelper');
const {
    formatDatetimeLocal,
    formatMysqlDatetime,
    generateRentalNumber,
    getEffectiveRentalStatus,
    getRentalStatusBadge,
    calculateExpectedReturn,
    formatDuration,
    calculateRentalEstimate,
    calculateRentalSettlement,
    getRentalAnalytics
} = require('../utils/rentalHelper');

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

        const page = Math.max(1, parseInt(req.query.page || 1, 10));
        const limit = 10;
        const offset = (page - 1) * limit;

        let whereSql = ' WHERE 1=1 ';
        const params = [];

        if (search.trim() !== '') {
            whereSql += ` AND (
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
                whereSql += ` AND (r.rental_status = 'Overdue' OR (r.rental_status = 'Active' AND r.expected_checkout_datetime < NOW()))`;
            } else if (status === 'Active') {
                whereSql += ` AND r.rental_status = 'Active' AND r.expected_checkout_datetime >= NOW()`;
            } else if (['Returned', 'Cancelled'].includes(status)) {
                whereSql += ` AND r.rental_status = ?`;
                params.push(status);
            }
        }

        if (from_date.trim() !== '') {
            whereSql += ` AND DATE(r.check_in_datetime) >= ?`;
            params.push(from_date.trim());
        }

        if (to_date.trim() !== '') {
            whereSql += ` AND DATE(r.check_in_datetime) <= ?`;
            params.push(to_date.trim());
        }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total
            FROM rentals r
            INNER JOIN customer_master cm ON cm.id = r.customer_id
            INNER JOIN product_master pm ON pm.id = r.product_id
            ${whereSql}`,
            params
        );
        const totalRecords = countRows[0].total;
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

        const dataSql = `
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
            ${whereSql}
            ORDER BY r.id DESC
            LIMIT ? OFFSET ?
        `;

        const [rentals] = await pool.query(dataSql, [...params, limit, offset]);

        // Compute effective statuses and duration previews
        rentals.forEach(r => {
            r.effective_status = getEffectiveRentalStatus(r.rental_status, r.expected_checkout_datetime);
            if (r.actual_return_datetime) {
                r.calculated_duration = r.actual_duration || formatDuration(r.check_in_datetime, r.actual_return_datetime);
            } else {
                r.calculated_duration = formatDuration(r.check_in_datetime, new Date());
            }
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
            currentDatetimeLocal: formatDatetimeLocal(),
            page,
            limit,
            offset,
            totalRecords,
            totalPages,
            queryParams: req.query
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
        const defaultDuration = 1;
        const defaultPeriod = 'daily';
        const defaultCheckOut = calculateExpectedReturn(defaultCheckIn, defaultPeriod, defaultDuration);

        res.render('create_rental', {
            pageTitle: 'Rental Checkout',
            rentalNo,
            customers,
            products,
            rentalRates,
            defaultCheckIn,
            defaultCheckOut,
            defaultEstimatedDuration: defaultDuration,
            defaultPeriod,
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
        const checkInDatetimeStr = (body.check_in_datetime || '').trim() || formatDatetimeLocal();
        const rentalPeriodType = (body.rental_period_type || 'daily').trim().toLowerCase();
        const estimatedDuration = Math.max(1, parseInt(body.estimated_duration || 1, 10));

        // Expected Checkout Datetime is OPTIONAL: auto-calculate if omitted or blank
        let expectedCheckoutDatetimeStr = (body.expected_checkout_datetime || '').trim();
        if (!expectedCheckoutDatetimeStr) {
            expectedCheckoutDatetimeStr = calculateExpectedReturn(checkInDatetimeStr, rentalPeriodType, estimatedDuration);
        }

        const rentalRate = Math.max(0, parseFloat(body.rental_rate || 0));
        const securityDeposit = Math.max(0, parseFloat(body.security_deposit || 0));
        const advanceRentalAmount = parseFloat(body.advance_rental_amount !== undefined && body.advance_rental_amount !== '' ? body.advance_rental_amount : 0);
        const totalEstimatedAmount = (estimatedDuration * rentalRate);
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
        const checkInDate = new Date(checkInDatetimeStr);
        const checkOutDate = new Date(expectedCheckoutDatetimeStr);

        if (isNaN(checkInDate.getTime())) {
            errors.push('Invalid Check-In Date & Time.');
        }
        if (isNaN(checkOutDate.getTime())) {
            errors.push('Invalid Check-Out (Expected Return) Date & Time.');
        }
        if (!isNaN(checkInDate.getTime()) && !isNaN(checkOutDate.getTime())) {
            if (checkOutDate <= checkInDate) {
                errors.push('Expected Check-Out Date & Time must be later than Check-In Date & Time.');
            }
        }

        // 4. Advance Rental Amount & Duration Validation
        if (isNaN(advanceRentalAmount)) {
            errors.push('Advance Rental Amount must be a valid number.');
        } else if (advanceRentalAmount < 0) {
            errors.push('Advance Rental Amount cannot be negative.');
        } else if (advanceRentalAmount > totalEstimatedAmount + 0.001) {
            errors.push(`Advance Rental Amount (₹${advanceRentalAmount.toFixed(2)}) cannot exceed Estimated Rental Amount (₹${totalEstimatedAmount.toFixed(2)}).`);
        }
        if (estimatedDuration < 1) {
            errors.push('Estimated Rental Duration must be at least 1.');
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
                defaultCheckIn: checkInDatetimeStr,
                defaultCheckOut: expectedCheckoutDatetimeStr,
                defaultEstimatedDuration: estimatedDuration,
                defaultPeriod: rentalPeriodType,
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
                defaultEstimatedDuration: estimatedDuration,
                defaultPeriod: rentalPeriodType,
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
                estimated_duration,
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?, NOW())`,
            [
                rentalNo,
                customerId,
                productId,
                rentalPeriodType,
                estimatedDuration,
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
                mysqlCheckOut.split(' ')[0],
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

        return res.redirect(`/rentals/view/${rentalId}?id=${rentalId}&success=${encodeURIComponent(`Rental ${rentalNo} created successfully!`)}`);
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
            defaultEstimatedDuration: parseInt(req.body?.estimated_duration || 1, 10),
            defaultPeriod: req.body?.rental_period_type || 'daily',
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
        const id = parseInt(req.params.id || req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect('/rentals?error=' + encodeURIComponent('Invalid Rental ID'));
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
            return res.redirect('/rentals?error=' + encodeURIComponent('Rental record not found.'));
        }

        const rental = rows[0];
        rental.effective_status = getEffectiveRentalStatus(rental.rental_status, rental.expected_checkout_datetime);

        // Pre-compute settlement simulation for modal & views
        const liveSettlement = calculateRentalSettlement({
            checkInDatetime: rental.check_in_datetime,
            expectedCheckoutDatetime: rental.expected_checkout_datetime,
            actualReturnDatetime: rental.actual_return_datetime || new Date(),
            periodType: rental.rental_period_type,
            estimatedDuration: rental.estimated_duration || 1,
            rentalRate: rental.rental_rate,
            securityDeposit: rental.security_deposit,
            advanceRentalAmount: rental.advance_rental_amount,
            additionalCharges: rental.additional_charges,
            depositDeductions: rental.deposit_deduction_amount || 0,
            depositDeductionReason: rental.deposit_deduction_reason || ''
        });

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
            liveSettlement,
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
            return res.redirect('/rentals?error=' + encodeURIComponent('Invalid Rental ID'));
        }

        const [rentals] = await conn.query('SELECT * FROM rentals WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
        if (!rentals.length) {
            conn.release();
            return res.redirect('/rentals?error=' + encodeURIComponent('Rental not found'));
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
        const additionalCharges = Math.max(0, parseFloat(req.body.additional_charges || 0));
        const depositDeductionAmount = Math.max(0, parseFloat(req.body.deposit_deduction_amount || req.body.deduction_amount || 0));
        const depositDeductionReason = (req.body.deposit_deduction_reason || req.body.deduction_reason || '').trim();
        const notes = (req.body.notes || '').trim();
        const userId = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

        // Perform backend accurate recalculation
        const settlement = calculateRentalSettlement({
            checkInDatetime: rental.check_in_datetime,
            expectedCheckoutDatetime: rental.expected_checkout_datetime,
            actualReturnDatetime: actualReturnDatetimeStr,
            periodType: rental.rental_period_type,
            estimatedDuration: rental.estimated_duration || 1,
            rentalRate: rental.rental_rate,
            securityDeposit: rental.security_deposit,
            advanceRentalAmount: rental.advance_rental_amount,
            additionalCharges: additionalCharges,
            depositDeductions: depositDeductionAmount,
            depositDeductionReason: depositDeductionReason
        });

        const mysqlReturnDatetime = formatMysqlDatetime(actualReturnDatetimeStr);

        await conn.beginTransaction();

        // 1. Update Rental Status to Returned with full calculation metadata
        await conn.query(
            `UPDATE rentals SET
                actual_return_datetime = ?,
                actual_duration = ?,
                overdue_duration = ?,
                overdue_amount = ?,
                total_rental_amount = ?,
                additional_charges = ?,
                refund_amount = ?,
                deposit_returned = ?,
                deposit_return_amount = ?,
                deposit_return_datetime = NOW(),
                deposit_deduction_amount = ?,
                deposit_deduction_reason = ?,
                remaining_amount = ?,
                rental_status = 'Returned',
                notes = CASE WHEN ? != '' THEN CONCAT(COALESCE(notes, ''), '\n[Return Note]: ', ?) ELSE notes END,
                updated_by = ?,
                updated_at = NOW()
            WHERE id = ?`,
            [
                mysqlReturnDatetime,
                settlement.actualDurationText,
                settlement.overdueDurationText,
                settlement.overdueAmount,
                settlement.totalRentalAmount,
                settlement.additionalCharges,
                settlement.depositReturnAmount,
                settlement.depositReturned,
                settlement.depositReturnAmount,
                depositDeductionAmount,
                depositDeductionReason || null,
                settlement.remainingAmountDue,
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
        const ledgerTotal = settlement.grossTotalPayable;
        const ledgerPaid = settlement.advanceRentalAmount + settlement.depositUsed;
        const ledgerDebit = settlement.remainingAmountDue;
        const paymentStatus = (ledgerDebit <= 0.001) ? 'Settled' : 'Partial';

        await conn.query(
            `UPDATE customer_transactions SET
                total_amount = ?,
                paid_amount = ?,
                debit_amount = ?,
                payment_status = ?,
                notes = CONCAT(COALESCE(notes, ''), ' | Returned on ', ?, ' (Duration: ', ?, ', Overdue Fee: ₹', ?, ', Deposit Refund: ₹', ?, ')')
            WHERE reference_number = ? AND transaction_type = 'rental'`,
            [
                ledgerTotal,
                ledgerPaid,
                ledgerDebit,
                paymentStatus,
                actualReturnDatetimeStr,
                settlement.actualDurationText,
                settlement.overdueAmount.toFixed(2),
                settlement.depositReturnAmount.toFixed(2),
                rental.rental_no
            ]
        );

        await conn.commit();
        conn.release();

        return res.redirect(`/view_rental.php?id=${id}&success=${encodeURIComponent(`Product for Rental ${rental.rental_no} returned successfully. Actual Duration: ${settlement.actualDurationText}. Product stock restored to inventory.`)}`);
    } catch (err) {
        await conn.rollback();
        conn.release();
        console.error('returnRental error:', err);
        return res.redirect('/rentals?error=' + encodeURIComponent('Return failed: ' + err.message));
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
            return res.redirect('/rentals?error=' + encodeURIComponent('Invalid Rental ID'));
        }

        const [rentals] = await conn.query('SELECT * FROM rentals WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
        if (!rentals.length) {
            conn.release();
            return res.redirect('/rentals?error=' + encodeURIComponent('Rental not found'));
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
        return res.redirect('/rentals?error=' + encodeURIComponent('Cancellation failed: ' + err.message));
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

            case 'calculate_expected_return': {
                const checkIn = req.query.check_in || req.body.check_in || formatDatetimeLocal();
                const periodType = (req.query.period_type || req.body.period_type || 'daily').trim();
                const duration = parseInt(req.query.duration || req.body.duration || 1, 10);

                const expectedReturn = calculateExpectedReturn(checkIn, periodType, duration);
                return res.json({
                    success: true,
                    expected_checkout: expectedReturn
                });
            }

            case 'calculate_estimate': {
                const periodType = (req.query.period_type || req.body.period_type || 'daily').trim();
                const rate = parseFloat(req.query.rate || req.body.rate || 0);
                const checkIn = req.query.check_in || req.body.check_in;
                const checkOut = req.query.check_out || req.body.check_out;
                const duration = req.query.duration || req.body.duration;

                const estimate = calculateRentalEstimate(periodType, rate, checkIn, checkOut, duration);
                return res.json({
                    success: true,
                    estimate
                });
            }

            case 'calculate_return_settlement': {
                const rentalId = parseInt(req.query.rental_id || req.body.rental_id || 0, 10);
                let checkIn = req.query.check_in || req.body.check_in;
                let expectedCheckout = req.query.expected_checkout || req.body.expected_checkout;
                let actualReturn = req.query.actual_return || req.body.actual_return || formatDatetimeLocal();
                let periodType = req.query.period_type || req.body.period_type || 'daily';
                let estimatedDuration = parseInt(req.query.estimated_duration || req.body.estimated_duration || 1, 10);
                let rate = parseFloat(req.query.rate || req.body.rate || 0);
                let deposit = parseFloat(req.query.deposit || req.body.deposit || 0);
                let advance = parseFloat(req.query.advance || req.body.advance || 0);
                let additionalCharges = parseFloat(req.query.additional_charges || req.body.additional_charges || 0);
                let depositDeductions = parseFloat(req.query.deposit_deductions || req.body.deposit_deductions || 0);
                let depositDeductionReason = req.query.deposit_deduction_reason || req.body.deposit_deduction_reason || '';

                if (rentalId > 0) {
                    const [rRows] = await pool.query('SELECT * FROM rentals WHERE id = ? LIMIT 1', [rentalId]);
                    if (rRows.length > 0) {
                        const r = rRows[0];
                        checkIn = r.check_in_datetime;
                        expectedCheckout = r.expected_checkout_datetime;
                        periodType = r.rental_period_type;
                        estimatedDuration = r.estimated_duration || 1;
                        rate = r.rental_rate;
                        deposit = r.security_deposit;
                        advance = r.advance_rental_amount;
                    }
                }

                const settlement = calculateRentalSettlement({
                    checkInDatetime: checkIn,
                    expectedCheckoutDatetime: expectedCheckout,
                    actualReturnDatetime: actualReturn,
                    periodType,
                    estimatedDuration,
                    rentalRate: rate,
                    securityDeposit: deposit,
                    advanceRentalAmount: advance,
                    additionalCharges,
                    depositDeductions,
                    depositDeductionReason
                });

                return res.json({
                    success: true,
                    settlement
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

