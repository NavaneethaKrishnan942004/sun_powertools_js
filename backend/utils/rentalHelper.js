const defaultPool = require('../config/db');

/**
 * Rental Helper Utilities
 */

/**
 * Generate Next Rental Number (e.g. RN-2026-0001)
 */
async function generateRentalNumber(conn) {
    const db = conn || defaultPool;
    const [rows] = await db.query("SELECT rental_no FROM rentals ORDER BY id DESC LIMIT 1");
    const lastCode = rows && rows.length > 0 ? rows[0].rental_no : null;
    const currentYear = String(new Date().getFullYear());

    if (!lastCode) {
        return `RN-${currentYear}-0001`;
    }

    const yearMatch = lastCode.match(/^RN-(\d{4})-(\d+)$/);
    if (yearMatch) {
        const year = yearMatch[1];
        const seq = parseInt(yearMatch[2], 10);
        if (year === currentYear) {
            const nextSeq = seq + 1;
            return `RN-${currentYear}-${String(nextSeq).padStart(4, '0')}`;
        } else {
            return `RN-${currentYear}-0001`;
        }
    }

    const simpleMatch = lastCode.match(/^RN-(\d+)$/);
    if (simpleMatch) {
        const seq = parseInt(simpleMatch[1], 10) + 1;
        return `RN-${String(seq).padStart(3, '0')}`;
    }

    return `RN-${currentYear}-0001`;
}

/**
 * Determine Effective Status (dynamically considers Overdue if Active and checkout date is past)
 */
function getEffectiveRentalStatus(rentalStatus, expectedCheckoutDatetime) {
    if (rentalStatus === 'Active' && expectedCheckoutDatetime) {
        const checkoutTime = new Date(expectedCheckoutDatetime).getTime();
        const now = Date.now();
        if (!isNaN(checkoutTime) && now > checkoutTime) {
            return 'Overdue';
        }
    }
    return rentalStatus || 'Active';
}

/**
 * Generate HTML Status Badge for Rental
 */
function getRentalStatusBadge(status, expectedCheckoutDatetime = null) {
    const effectiveStatus = getEffectiveRentalStatus(status, expectedCheckoutDatetime);

    switch (effectiveStatus) {
        case 'Active':
            return '<span class="badge bg-primary-subtle text-primary border border-primary-subtle px-2.5 py-1.5 rounded-pill fw-semibold"><i class="bi bi-clock-history me-1"></i>Active</span>';
        case 'Returned':
            return '<span class="badge bg-success-subtle text-success border border-success-subtle px-2.5 py-1.5 rounded-pill fw-semibold"><i class="bi bi-check-circle me-1"></i>Returned</span>';
        case 'Overdue':
            return '<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2.5 py-1.5 rounded-pill fw-bold"><i class="bi bi-exclamation-triangle-fill me-1"></i>Overdue</span>';
        case 'Cancelled':
            return '<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle px-2.5 py-1.5 rounded-pill fw-semibold"><i class="bi bi-x-circle me-1"></i>Cancelled</span>';
        default:
            return `<span class="badge bg-light text-dark border px-2.5 py-1.5 rounded-pill">${status || 'Unknown'}</span>`;
    }
}


/**
 * Format Date to Local ISO String for <input type="datetime-local">
 * e.g. YYYY-MM-DDTHH:mm
 */
function formatDatetimeLocal(date = new Date()) {
    const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
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
 * Automatically Calculate Expected Return Date & Time
 * Based on Start Date & Time + Billing Period + Estimated Duration
 */
function calculateExpectedReturn(checkInDatetime, periodType = 'daily', estimatedDuration = 1) {
    const start = checkInDatetime ? new Date(checkInDatetime) : new Date();
    if (isNaN(start.getTime())) {
        return formatDatetimeLocal(new Date());
    }

    const duration = Math.max(1, parseInt(estimatedDuration || 1, 10));
    const cleanPeriod = String(periodType || 'daily').toLowerCase().trim();
    const result = new Date(start.getTime());

    switch (cleanPeriod) {
        case 'hours':
        case 'hourly':
            result.setTime(result.getTime() + duration * 60 * 60 * 1000);
            break;
        case 'days':
        case 'daily':
            result.setDate(result.getDate() + duration);
            break;
        case 'weeks':
        case 'weekly':
            result.setDate(result.getDate() + duration * 7);
            break;
        case 'months':
        case 'monthly':
            result.setMonth(result.getMonth() + duration);
            break;
        default:
            result.setDate(result.getDate() + duration);
            break;
    }

    return formatDatetimeLocal(result);
}

/**
 * Format elapsed duration into human-readable string (days, hours, minutes)
 * Considering actual date AND time (not just calendar days)
 */
function formatDuration(startDatetime, endDatetime) {
    if (!startDatetime || !endDatetime) return '0 Mins';
    const start = new Date(startDatetime);
    const end = new Date(endDatetime);
    const diffMs = end.getTime() - start.getTime();

    if (isNaN(diffMs) || diffMs <= 0) {
        return '0 Mins';
    }

    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const minutes = totalMinutes % 60;

    const parts = [];
    if (days > 0) {
        parts.push(`${days} Day${days > 1 ? 's' : ''}`);
    }
    if (hours > 0) {
        parts.push(`${hours} Hour${hours > 1 ? 's' : ''}`);
    }
    if (days === 0 && minutes > 0) {
        parts.push(`${minutes} Min${minutes > 1 ? 's' : ''}`);
    }

    return parts.length > 0 ? parts.join(' ') : '< 1 Min';
}

/**
 * Calculate Estimated Duration & Rental Amount
 */
function calculateRentalEstimate(periodType, rate, checkInStr, checkOutStr, customDuration = null) {
    const numericRate = parseFloat(rate || 0);
    const cleanPeriod = String(periodType || 'daily').toLowerCase().trim();

    // If explicit duration is supplied or checkOutStr empty
    if (customDuration !== null && customDuration !== undefined && parseInt(customDuration, 10) > 0) {
        const units = parseInt(customDuration, 10);
        let durationText = '';
        if (cleanPeriod === 'hourly' || cleanPeriod === 'hours') {
            durationText = `${units} Hour${units > 1 ? 's' : ''}`;
        } else if (cleanPeriod === 'weekly' || cleanPeriod === 'weeks') {
            durationText = `${units} Week${units > 1 ? 's' : ''}`;
        } else if (cleanPeriod === 'monthly' || cleanPeriod === 'months') {
            durationText = `${units} Month${units > 1 ? 's' : ''}`;
        } else {
            durationText = `${units} Day${units > 1 ? 's' : ''}`;
        }
        return {
            units,
            durationText,
            totalEstimated: units * numericRate
        };
    }

    const checkIn = new Date(checkInStr);
    const checkOut = new Date(checkOutStr);
    const diffMs = checkOut.getTime() - checkIn.getTime();

    if (isNaN(diffMs) || diffMs < 0) {
        return { units: 1, totalEstimated: numericRate, durationText: '1 period' };
    }

    const diffHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    const diffDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const diffWeeks = Math.max(1, Math.ceil(diffDays / 7));
    const diffMonths = Math.max(1, Math.ceil(diffDays / 30));

    let units = 1;
    let durationText = '';

    switch (cleanPeriod) {
        case 'hours':
        case 'hourly':
            units = diffHours;
            durationText = `${units} Hour${units > 1 ? 's' : ''}`;
            break;
        case 'weeks':
        case 'weekly':
            units = diffWeeks;
            durationText = `${units} Week${units > 1 ? 's' : ''}`;
            break;
        case 'months':
        case 'monthly':
            units = diffMonths;
            durationText = `${units} Month${units > 1 ? 's' : ''}`;
            break;
        case 'days':
        case 'daily':
        default:
            units = diffDays;
            durationText = `${units} Day${units > 1 ? 's' : ''}`;
            break;
    }

    const totalEstimated = units * numericRate;

    return {
        units,
        durationText,
        totalEstimated
    };
}

/**
 * Calculate Comprehensive Return Settlement
 * Compares Estimated vs Actual Duration, Overdue charges, Deposit handling, and remaining dues
 */
function calculateRentalSettlement({
    checkInDatetime,
    checkIn,
    expectedCheckoutDatetime,
    expectedReturn,
    actualReturnDatetime,
    actualReturn,
    periodType = 'daily',
    estimatedDuration = 1,
    rentalRate = 0,
    securityDeposit = 0,
    advanceRentalAmount = 0,
    advancePaid = 0,
    additionalCharges = 0,
    depositDeductions = 0,
    depositDeductionReason = ''
}) {
    const checkInDt = checkInDatetime || checkIn;
    const expectedCheckoutDt = expectedCheckoutDatetime || expectedReturn;
    const actualReturnDt = actualReturnDatetime || actualReturn;

    const checkInDate = checkInDt ? new Date(checkInDt) : new Date();
    const expectedCheckout = expectedCheckoutDt ? new Date(expectedCheckoutDt) : new Date();
    const actualReturnDate = actualReturnDt ? new Date(actualReturnDt) : new Date();

    const rate = Math.max(0, parseFloat(rentalRate || 0));
    const estDuration = Math.max(1, parseInt(estimatedDuration || 1, 10));
    const deposit = Math.max(0, parseFloat(securityDeposit || 0));
    const advance = Math.max(0, parseFloat(advanceRentalAmount || advancePaid || 0));
    const extraCharges = Math.max(0, parseFloat(additionalCharges || 0));
    const deductions = Math.max(0, parseFloat(depositDeductions || 0));
    const cleanPeriod = String(periodType || 'daily').toLowerCase().trim();

    // Actual duration
    const actualDurationText = formatDuration(checkInDate, actualReturnDate);

    // Check overdue
    const isOverdue = actualReturnDate.getTime() > expectedCheckout.getTime();
    let overdueDurationText = '0 (On Time)';
    let overdueAmount = 0.0;
    let overdueUnits = 0;

    if (isOverdue) {
        const overdueMs = actualReturnDate.getTime() - expectedCheckout.getTime();
        overdueDurationText = formatDuration(expectedCheckout, actualReturnDate);

        const overdueHours = Math.max(1, Math.ceil(overdueMs / (1000 * 60 * 60)));
        const overdueDays = Math.max(1, Math.ceil(overdueMs / (1000 * 60 * 60 * 24)));
        const overdueWeeks = Math.max(1, Math.ceil(overdueDays / 7));
        const overdueMonths = Math.max(1, Math.ceil(overdueDays / 30));

        switch (cleanPeriod) {
            case 'hours':
            case 'hourly':
                overdueUnits = overdueHours;
                overdueAmount = overdueUnits * rate;
                break;
            case 'weeks':
            case 'weekly':
                overdueUnits = overdueWeeks;
                overdueAmount = overdueUnits * rate;
                break;
            case 'months':
            case 'monthly':
                overdueUnits = overdueMonths;
                overdueAmount = overdueUnits * rate;
                break;
            case 'days':
            case 'daily':
            default:
                overdueUnits = overdueDays;
                overdueAmount = overdueUnits * rate;
                break;
        }
    }

    // Original & Total Rental Amount
    const originalRentalAmount = estDuration * rate;
    const totalRentalAmount = originalRentalAmount + overdueAmount;
    const grossTotalPayable = totalRentalAmount + extraCharges;

    // Unpaid rental balance before applying security deposit
    const unpaidRentalBalance = Math.max(0, grossTotalPayable - advance);

    // Deposit calculations
    const netAvailableDeposit = Math.max(0, deposit - deductions);
    let depositUsed = 0.0;
    let depositReturnAmount = 0.0;
    let remainingAmountDue = 0.0;

    if (unpaidRentalBalance > 0) {
        depositUsed = Math.min(netAvailableDeposit, unpaidRentalBalance);
        depositReturnAmount = Math.max(0, netAvailableDeposit - depositUsed);
        remainingAmountDue = Math.max(0, unpaidRentalBalance - depositUsed);
    } else {
        depositUsed = 0.0;
        depositReturnAmount = netAvailableDeposit;
        remainingAmountDue = 0.0;
    }

    // If advance paid exceeded gross charges (refund advance surplus)
    if (advance > grossTotalPayable) {
        const advanceSurplus = advance - grossTotalPayable;
        depositReturnAmount += advanceSurplus;
    }

    const depositReturned = depositReturnAmount > 0 ? 1 : 0;

    return {
        checkInDatetime: formatDatetimeLocal(checkInDate),
        expectedCheckoutDatetime: formatDatetimeLocal(expectedCheckout),
        actualReturnDatetime: formatDatetimeLocal(actualReturnDate),
        periodType: cleanPeriod,
        estimatedDuration: estDuration,
        rentalRate: rate,
        actualDurationText,
        isOverdue,
        overdueDurationText,
        overdueUnits,
        originalRentalAmount: parseFloat(originalRentalAmount.toFixed(2)),
        overdueAmount: parseFloat(overdueAmount.toFixed(2)),
        totalRentalAmount: parseFloat(totalRentalAmount.toFixed(2)),
        additionalCharges: parseFloat(extraCharges.toFixed(2)),
        grossTotalPayable: parseFloat(grossTotalPayable.toFixed(2)),
        advanceRentalAmount: parseFloat(advance.toFixed(2)),
        unpaidRentalBalance: parseFloat(unpaidRentalBalance.toFixed(2)),
        securityDeposit: parseFloat(deposit.toFixed(2)),
        depositDeductions: parseFloat(deductions.toFixed(2)),
        depositDeductionReason: depositDeductionReason || '',
        netAvailableDeposit: parseFloat(netAvailableDeposit.toFixed(2)),
        depositUsed: parseFloat(depositUsed.toFixed(2)),
        depositReturnAmount: parseFloat(depositReturnAmount.toFixed(2)),
        remainingAmountDue: parseFloat(remainingAmountDue.toFixed(2)),
        depositReturned
    };
}

/**
 * Fetch Comprehensive Rental Analytics Summary
 */
async function getRentalAnalytics(conn) {
    const db = conn || defaultPool;
    const analytics = {
        total_rentals: 0,
        active_rentals: 0,
        overdue_rentals: 0,
        returned_rentals: 0,
        cancelled_rentals: 0,
        total_advance_collected: 0.0,
        total_rental_revenue: 0.0
    };

    try {
        const [rows] = await db.query(`
            SELECT
                COUNT(*) AS total_rentals,
                SUM(CASE WHEN rental_status = 'Active' AND expected_checkout_datetime >= NOW() THEN 1 ELSE 0 END) AS active_rentals,
                SUM(CASE WHEN rental_status = 'Active' AND expected_checkout_datetime < NOW() THEN 1 
                         WHEN rental_status = 'Overdue' THEN 1 ELSE 0 END) AS overdue_rentals,
                SUM(CASE WHEN rental_status = 'Returned' THEN 1 ELSE 0 END) AS returned_rentals,
                SUM(CASE WHEN rental_status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_rentals,
                COALESCE(SUM(advance_rental_amount), 0) AS total_advance_collected,
                COALESCE(SUM(CASE WHEN rental_status = 'Returned' THEN total_rental_amount ELSE advance_rental_amount END), 0) AS total_rental_revenue
            FROM rentals
        `);

        if (rows && rows.length > 0) {
            const r = rows[0];
            analytics.total_rentals = parseInt(r.total_rentals || 0, 10);
            analytics.active_rentals = parseInt(r.active_rentals || 0, 10);
            analytics.overdue_rentals = parseInt(r.overdue_rentals || 0, 10);
            analytics.returned_rentals = parseInt(r.returned_rentals || 0, 10);
            analytics.cancelled_rentals = parseInt(r.cancelled_rentals || 0, 10);
            analytics.total_advance_collected = parseFloat(r.total_advance_collected || 0);
            analytics.total_rental_revenue = parseFloat(r.total_rental_revenue || 0);
        }
    } catch (err) {
        console.error('[rentalHelper] Analytics error:', err.message);
    }

    return analytics;
}

module.exports = {
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
};

