const defaultPool = require('../config/db');

/**
 * Customer Helper Utilities - Ported from includes/customer_helper.php
 */

/**
 * Generate Next Customer Code (e.g. CUS-001)
 */
async function generateCustomerCode(conn) {
    const db = conn || defaultPool;
    const [rows] = await db.query("SELECT customer_code FROM customer_master ORDER BY id DESC LIMIT 1");
    const lastCode = rows && rows.length > 0 ? rows[0].customer_code : null;

    if (!lastCode) {
        return 'CUS-001';
    }

    const number = parseInt(lastCode.replace('CUS-', ''), 10) + 1;
    return 'CUS-' + String(number).padStart(3, '0');
}

/**
 * Calculates dynamic financial summary for a customer
 * Outstanding = (Opening Debit - Opening Credit) + Total Sales + Total Rentals - Total Payments - Total Returns
 */
async function getCustomerFinancialSummary(conn, customerId, customerData = null) {
    let db = conn;
    let cId = customerId;
    let cData = customerData;

    // Support both getCustomerFinancialSummary(db, id, data) and getCustomerFinancialSummary(id, data)
    if (typeof conn === 'number' || typeof conn === 'string' || (conn && typeof conn.query !== 'function')) {
        cData = customerId;
        cId = parseInt(conn, 10);
        db = defaultPool;
    } else if (!db) {
        db = defaultPool;
    }

    if (!cData) {
        const [rows] = await db.query("SELECT * FROM customer_master WHERE id = :id LIMIT 1", { id: cId });
        cData = (rows && rows.length > 0) ? rows[0] : {};
    }

    const openingBalance = parseFloat(cData.opening_balance || 0.00);
    const openingType = cData.opening_balance_type || 'Debit';
    const creditLimit = parseFloat(cData.credit_limit || 0.00);
    const creditAllowed = parseInt(cData.credit_allowed || 0, 10);

    // Base from opening balance
    let netDebit = (openingType === 'Debit') ? openingBalance : -openingBalance;

    let totalSalesVolume = 0.00;
    let totalSalesDebt = 0.00;
    let totalRentalsVolume = 0.00;
    let totalRentalsDebt = 0.00;
    let totalPayments = 0.00;
    let totalReturns = 0.00;

    try {
        const [rows] = await db.query(`
            SELECT 
                transaction_type,
                COALESCE(SUM(CASE WHEN debit_amount IS NOT NULL THEN debit_amount ELSE total_amount END), 0) AS sum_debit,
                COALESCE(SUM(CASE WHEN credit_amount IS NOT NULL THEN credit_amount ELSE total_amount END), 0) AS sum_credit,
                COALESCE(SUM(total_amount), 0) AS sum_total
            FROM customer_transactions 
            WHERE customer_id = :customer_id
            GROUP BY transaction_type
        `, { customer_id: cId });

        for (const r of rows) {
            const type = (r.transaction_type || '').toLowerCase();
            const sumDebit = parseFloat(r.sum_debit || 0);
            const sumCredit = parseFloat(r.sum_credit || 0);
            const sumTotal = parseFloat(r.sum_total || 0);

            if (type === 'sales' || type === 'sale' || type === 'sales_note' || type === 'invoice') {
                totalSalesDebt += sumDebit;
                totalSalesVolume += sumTotal;
            } else if (type === 'rental' || type === 'rental_note') {
                totalRentalsDebt += sumDebit;
                totalRentalsVolume += sumTotal;
            } else if (type === 'payment' || type === 'receipt') {
                totalPayments += sumCredit;
            } else if (type === 'return' || type === 'sales_return') {
                totalReturns += sumCredit;
            } else {
                if (sumDebit > 0) totalSalesDebt += sumDebit;
                if (sumCredit > 0) totalPayments += sumCredit;
            }
        }
    } catch (err) {
        console.error('[customerHelper] Error computing financial summary:', err.message);
    }

    const currentOutstanding = (netDebit + totalSalesDebt + totalRentalsDebt) - (totalPayments + totalReturns);
    const availableCredit = (creditAllowed === 1) ? Math.max(0.00, creditLimit - currentOutstanding) : 0.00;
    const isExceeded = (creditAllowed === 1) && (currentOutstanding > creditLimit);
    const creditUtilization = (creditAllowed === 1 && creditLimit > 0)
        ? Math.min(100.0, Math.max(0.0, (currentOutstanding / creditLimit) * 100))
        : 0.0;

    return {
        opening_balance: openingBalance,
        opening_balance_type: openingType,
        net_opening: netDebit,
        credit_limit: creditLimit,
        credit_allowed: creditAllowed,
        total_sales: totalSalesVolume,
        total_sales_debt: totalSalesDebt,
        total_rentals: totalRentalsVolume,
        total_rentals_debt: totalRentalsDebt,
        total_payments: totalPayments,
        total_returns: totalReturns,
        current_outstanding: currentOutstanding,
        available_credit: availableCredit,
        is_exceeded: isExceeded,
        credit_utilization: creditUtilization,
        is_settled: (Math.abs(currentOutstanding) < 0.001),
        is_debit: (currentOutstanding > 0.001),
        is_credit: (currentOutstanding < -0.001)
    };
}

/**
 * Format balance string with badge for HTML display
 */
function formatCustomerBalance(summary) {
    if (!summary || typeof summary.current_outstanding === 'undefined') {
        return '<span class="badge bg-secondary-subtle text-secondary">₹0.00</span>';
    }
    const bal = summary.current_outstanding;
    const formatNum = (num) => parseFloat(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (summary.is_settled) {
        return '<span class="badge bg-success-subtle text-success border border-success-subtle">₹0.00 Settled</span>';
    } else if (summary.is_debit) {
        return '<span class="badge bg-danger-subtle text-danger border border-danger-subtle fw-semibold">Debit: ₹' + formatNum(bal) + '</span>';
    } else {
        return '<span class="badge bg-info-subtle text-info border border-info-subtle fw-semibold">Credit: ₹' + formatNum(Math.abs(bal)) + '</span>';
    }
}

/**
 * Checks if a customer has financial transaction history
 */
async function customerHasTransactions(conn, customerId) {
    const db = conn || defaultPool;
    try {
        const [rows] = await db.query("SELECT COUNT(*) AS cnt FROM customer_transactions WHERE customer_id = :id", { id: customerId });
        return parseInt(rows[0].cnt || 0, 10) > 0;
    } catch (err) {
        return false;
    }
}

module.exports = {
    generateCustomerCode,
    getCustomerFinancialSummary,
    formatCustomerBalance,
    customerHasTransactions
};
