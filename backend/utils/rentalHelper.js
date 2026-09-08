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
 * Calculate Estimated Duration & Rental Amount
 */
function calculateRentalEstimate(periodType, rate, checkInStr, checkOutStr) {
    const checkIn = new Date(checkInStr);
    const checkOut = new Date(checkOutStr);
    const diffMs = checkOut.getTime() - checkIn.getTime();

    if (isNaN(diffMs) || diffMs < 0) {
        return { units: 1, totalEstimated: parseFloat(rate || 0), durationText: '1 period' };
    }

    const diffHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    const diffDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    const diffWeeks = Math.max(1, Math.ceil(diffDays / 7));
    const diffMonths = Math.max(1, Math.ceil(diffDays / 30));

    const numericRate = parseFloat(rate || 0);

    let units = 1;
    let durationText = '';

    switch (periodType) {
        case 'hourly':
            units = diffHours;
            durationText = `${units} Hour${units > 1 ? 's' : ''}`;
            break;
        case 'daily':
            units = diffDays;
            durationText = `${units} Day${units > 1 ? 's' : ''}`;
            break;
        case 'weekly':
            units = diffWeeks;
            durationText = `${units} Week${units > 1 ? 's' : ''}`;
            break;
        case 'monthly':
            units = diffMonths;
            durationText = `${units} Month${units > 1 ? 's' : ''}`;
            break;
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
    generateRentalNumber,
    getEffectiveRentalStatus,
    getRentalStatusBadge,
    calculateRentalEstimate,
    getRentalAnalytics
};
