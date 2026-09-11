const { getCustomerFinancialSummary } = require('./customerHelper');
const defaultPool = require('../config/db');

/**
 * Sales Note Helper Utilities - Ported from includes/sales_note_helper.php
 */

/**
 * Generate Next Sales Note Number (e.g. SN-2026-0001 or SN-001)
 */
async function generateSalesNoteNumber(conn) {
    const db = conn || defaultPool;
    const [rows] = await db.query("SELECT sales_note_no FROM sales_notes ORDER BY id DESC LIMIT 1");
    const lastCode = rows && rows.length > 0 ? rows[0].sales_note_no : null;
    const currentYear = String(new Date().getFullYear());

    if (!lastCode) {
        return `SN-${currentYear}-0001`;
    }

    const yearMatch = lastCode.match(/^SN-(\d{4})-(\d+)$/);
    if (yearMatch) {
        const year = yearMatch[1];
        const seq = parseInt(yearMatch[2], 10);
        if (year === currentYear) {
            const nextSeq = seq + 1;
            return `SN-${currentYear}-${String(nextSeq).padStart(4, '0')}`;
        } else {
            return `SN-${currentYear}-0001`;
        }
    }

    const simpleMatch = lastCode.match(/^SN-(\d+)$/);
    if (simpleMatch) {
        const seq = parseInt(simpleMatch[1], 10) + 1;
        return `SN-${String(seq).padStart(3, '0')}`;
    }

    return `SN-${currentYear}-0001`;
}

/**
 * Evaluate Customer Credit Status & Utilization
 */
function evaluateCreditStatus(newOutstanding, creditLimit, creditAllowed) {
    const formatNum = (num) => parseFloat(num).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    if (creditAllowed === 0) {
        return {
            status: 'Credit Not Allowed',
            code: 'NOT_ALLOWED',
            percent: 0.0,
            badge_class: 'bg-danger-subtle text-danger border border-danger-subtle',
            row_class: '',
            is_exceeded: false,
            is_near_limit: false,
            is_reached: false,
            can_credit: false,
            message: 'Credit is not allowed for this customer.'
        };
    }

    if (creditLimit <= 0) {
        if (newOutstanding > 0.001) {
            return {
                status: 'Limit Exceeded',
                code: 'EXCEEDED',
                percent: 100.0,
                badge_class: 'bg-danger text-white border border-danger',
                row_class: 'table-danger',
                is_exceeded: true,
                is_near_limit: false,
                is_reached: true,
                can_credit: false,
                message: 'Customer has ₹0 credit limit. Any credit sale exceeds limit.'
            };
        }
        return {
            status: 'Within Limit',
            code: 'NORMAL',
            percent: 0.0,
            badge_class: 'bg-success-subtle text-success border border-success-subtle',
            row_class: '',
            is_exceeded: false,
            is_near_limit: false,
            is_reached: false,
            can_credit: true,
            message: 'Within credit limit.'
        };
    }

    const percent = Math.round((newOutstanding / creditLimit) * 1000) / 10;

    if (percent > 100.0) {
        return {
            status: 'Limit Exceeded',
            code: 'EXCEEDED',
            percent: percent,
            badge_class: 'bg-danger text-white border border-danger fw-bold',
            row_class: 'table-danger',
            is_exceeded: true,
            is_near_limit: false,
            is_reached: true,
            can_credit: false,
            message: `Credit limit exceeded by ₹${formatNum(newOutstanding - creditLimit)} (${percent}% utilized).`
        };
    } else if (Math.abs(percent - 100.0) < 0.01) {
        return {
            status: 'Limit Reached',
            code: 'REACHED',
            percent: 100.0,
            badge_class: 'bg-danger-subtle text-danger border border-danger fw-semibold',
            row_class: 'table-warning',
            is_exceeded: false,
            is_near_limit: false,
            is_reached: true,
            can_credit: true,
            message: 'Credit limit has reached 100% capacity.'
        };
    } else if (percent >= 90.0) {
        return {
            status: 'Near Limit',
            code: 'NEAR_LIMIT',
            percent: percent,
            badge_class: 'bg-warning text-dark border border-warning-subtle fw-semibold',
            row_class: 'table-warning-subtle',
            is_exceeded: false,
            is_near_limit: true,
            is_reached: false,
            can_credit: true,
            message: `Approaching credit limit (${percent}% utilized).`
        };
    } else if (percent >= 80.0) {
        return {
            status: 'Warning (80%+)',
            code: 'WARNING',
            percent: percent,
            badge_class: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle fw-semibold',
            row_class: '',
            is_exceeded: false,
            is_near_limit: true,
            is_reached: false,
            can_credit: true,
            message: `Customer credit utilization is high (${percent}% utilized).`
        };
    } else {
        return {
            status: 'Within Limit',
            code: 'NORMAL',
            percent: Math.max(0.0, percent),
            badge_class: 'bg-success-subtle text-success border border-success-subtle fw-medium',
            row_class: '',
            is_exceeded: false,
            is_near_limit: false,
            is_reached: false,
            can_credit: true,
            message: `Normal credit state (${percent}% utilized).`
        };
    }
}

/**
 * Format Payment Type Badge
 */
function getPaymentTypeBadge(type) {
    const map = {
        'Cash': 'bg-success-subtle text-success border-success-subtle',
        'UPI': 'bg-info-subtle text-info border-info-subtle',
        'Card': 'bg-primary-subtle text-primary border-primary-subtle',
        'Bank Transfer': 'bg-secondary-subtle text-secondary border-secondary-subtle',
        'Credit': 'bg-danger-subtle text-danger border-danger-subtle',
        'Mixed': 'bg-warning-subtle text-warning-emphasis border-warning-subtle'
    };

    const cls = map[type] || 'bg-light text-dark border';
    const safeType = String(type).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
    return `<span class="badge ${cls} border px-2 py-1 rounded-pill">${safeType}</span>`;
}

/**
 * Determine Payment Status based on financial values:
 * - Fully Paid: Amount Paid >= Grand Total
 * - Partially Paid: Amount Paid > 0 and Amount Paid < Grand Total
 * - Unpaid: Amount Paid = 0 and Grand Total > 0
 */
function getPaymentStatusInfo(paidAmount, totalAmount) {
    const paid = Math.max(0.00, parseFloat(paidAmount || 0));
    const total = Math.max(0.00, parseFloat(totalAmount || 0));
    const balance = Math.max(0.00, total - paid);

    if (total <= 0.001) {
        return {
            status: 'Fully Paid',
            code: 'FULL_PAYMENT',
            badge_class: 'bg-success-subtle text-success border border-success-subtle fw-bold',
            balance: 0.00,
            badge_html: '<span class="badge bg-success-subtle text-success border border-success-subtle fw-bold px-2.5 py-1 rounded-pill">Fully Paid</span>'
        };
    }

    if (paid >= total - 0.001) {
        return {
            status: 'Fully Paid',
            code: 'FULL_PAYMENT',
            badge_class: 'bg-success-subtle text-success border border-success-subtle fw-bold',
            balance: 0.00,
            badge_html: '<span class="badge bg-success-subtle text-success border border-success-subtle fw-bold px-2.5 py-1 rounded-pill">Fully Paid</span>'
        };
    } else if (paid > 0.001) {
        return {
            status: 'Partially Paid',
            code: 'PARTIALLY_PAID',
            badge_class: 'bg-warning-subtle text-warning-emphasis border border-warning-subtle fw-bold',
            balance: balance,
            badge_html: '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle fw-bold px-2.5 py-1 rounded-pill">Partially Paid</span>'
        };
    } else {
        return {
            status: 'Unpaid',
            code: 'UNPAID',
            badge_class: 'bg-danger-subtle text-danger border border-danger-subtle fw-bold',
            balance: balance,
            badge_html: '<span class="badge bg-danger-subtle text-danger border border-danger-subtle fw-bold px-2.5 py-1 rounded-pill">Unpaid</span>'
        };
    }
}

/**
 * Determine Sale Type (SALE vs CREDIT SALE)
 * Supports backward-compatibility for historical sales notes where sale_type was not set
 */
function getSaleTypeInfo(saleType, creditAmount = 0, paymentType = '') {
    const credAmt = parseFloat(creditAmount || 0);
    const sType = String(saleType || '').toLowerCase();

    let isCredit = false;
    if (sType === 'sale') {
        isCredit = credAmt > 0.001;
    } else if (sType === 'credit') {
        isCredit = true;
    } else {
        isCredit = credAmt > 0.001 || paymentType === 'Credit';
    }

    if (isCredit) {
        return {
            type: 'credit',
            label: 'CREDIT SALE',
            badge_class: 'bg-primary-subtle text-primary border border-primary-subtle fw-bold',
            badge_html: '<span class="badge bg-primary-subtle text-primary border border-primary-subtle fw-bold px-2.5 py-1 rounded-pill">CREDIT SALE</span>'
        };
    }

    return {
        type: 'sale',
        label: 'SALE',
        badge_class: 'bg-secondary-subtle text-secondary border border-secondary-subtle fw-bold',
        badge_html: '<span class="badge bg-secondary-subtle text-secondary border border-secondary-subtle fw-bold px-2.5 py-1 rounded-pill">SALE</span>'
    };
}

/**
 * Fetch Comprehensive Sales & Business Analytics Summary
 */
async function getSalesAnalytics(conn) {
    const db = conn || defaultPool;
    const analytics = {
        sales_summary: {
            today_sales: 0.0,
            today_count: 0,
            week_sales: 0.0,
            week_count: 0,
            month_sales: 0.0,
            month_count: 0,
            total_sales: 0.0,
            total_count: 0,
            avg_sale_value: 0.0,
            total_paid: 0.0,
            total_credit: 0.0,
        },
        payment_breakdown: [],
        credit_analysis: {
            total_outstanding: 0.0,
            total_credit_sales: 0.0,
            customers_with_balance: 0,
            customers_near_limit: 0,
            customers_reached_limit: 0,
            customers_exceeded_limit: 0,
        },
        top_products: [],
        low_stock_products: []
    };

    try {
        // 1. Overall Sales Summary
        const [sumRows] = await db.query(`
            SELECT 
                COUNT(*) AS total_count,
                COALESCE(SUM(total_amount), 0) AS total_sales,
                COALESCE(SUM(paid_amount), 0) AS total_paid,
                COALESCE(SUM(credit_amount), 0) AS total_credit,
                COALESCE(AVG(total_amount), 0) AS avg_sale_value
            FROM sales_notes
            WHERE status = 1
        `);
        if (sumRows && sumRows.length > 0) {
            const sum = sumRows[0];
            analytics.sales_summary.total_count = parseInt(sum.total_count || 0, 10);
            analytics.sales_summary.total_sales = parseFloat(sum.total_sales || 0);
            analytics.sales_summary.total_paid = parseFloat(sum.total_paid || 0);
            analytics.sales_summary.total_credit = parseFloat(sum.total_credit || 0);
            analytics.sales_summary.avg_sale_value = parseFloat(sum.avg_sale_value || 0);
        }

        // Today's Sales
        const [todayRows] = await db.query(`
            SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total 
            FROM sales_notes 
            WHERE status = 1 AND sales_date = CURDATE()
        `);
        if (todayRows && todayRows.length > 0) {
            analytics.sales_summary.today_count = parseInt(todayRows[0].cnt || 0, 10);
            analytics.sales_summary.today_sales = parseFloat(todayRows[0].total || 0);
        }

        // This Week's Sales
        const [weekRows] = await db.query(`
            SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total 
            FROM sales_notes 
            WHERE status = 1 AND YEARWEEK(sales_date, 1) = YEARWEEK(CURDATE(), 1)
        `);
        if (weekRows && weekRows.length > 0) {
            analytics.sales_summary.week_count = parseInt(weekRows[0].cnt || 0, 10);
            analytics.sales_summary.week_sales = parseFloat(weekRows[0].total || 0);
        }

        // This Month's Sales
        const [monthRows] = await db.query(`
            SELECT COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS total 
            FROM sales_notes 
            WHERE status = 1 AND MONTH(sales_date) = MONTH(CURDATE()) AND YEAR(sales_date) = YEAR(CURDATE())
        `);
        if (monthRows && monthRows.length > 0) {
            analytics.sales_summary.month_count = parseInt(monthRows[0].cnt || 0, 10);
            analytics.sales_summary.month_sales = parseFloat(monthRows[0].total || 0);
        }

        // 2. Payment Method Breakdown
        const [payRows] = await db.query(`
            SELECT 
                payment_type,
                COUNT(*) AS tx_count,
                COALESCE(SUM(total_amount), 0) AS total_amount,
                COALESCE(SUM(paid_amount), 0) AS paid_amount,
                COALESCE(SUM(credit_amount), 0) AS credit_amount
            FROM sales_notes
            WHERE status = 1
            GROUP BY payment_type
        `);
        analytics.payment_breakdown = payRows || [];

        // 3. Customer Credit Analytics
        const [allCustomers] = await db.query(`
            SELECT id, customer_code, customer_name, credit_allowed, credit_limit, opening_balance, opening_balance_type
            FROM customer_master
            WHERE status = 1
        `);

        let totOutstanding = 0.0;
        let custWithBalance = 0;
        let custNear = 0;
        let custReached = 0;
        let custExceeded = 0;

        for (const cust of (allCustomers || [])) {
            const fSummary = await getCustomerFinancialSummary(db, parseInt(cust.id, 10), cust);
            const curOut = parseFloat(fSummary.current_outstanding || 0);
            const cLimit = parseFloat(cust.credit_limit || 0);
            const cAllowed = parseInt(cust.credit_allowed || 0, 10);

            if (curOut > 0.001) {
                totOutstanding += curOut;
                custWithBalance++;

                const cEval = evaluateCreditStatus(curOut, cLimit, cAllowed);
                if (cEval.code === 'EXCEEDED') {
                    custExceeded++;
                } else if (cEval.code === 'REACHED') {
                    custReached++;
                } else if (cEval.code === 'NEAR_LIMIT' || cEval.code === 'WARNING') {
                    custNear++;
                }
            }
        }

        analytics.credit_analysis.total_outstanding = totOutstanding;
        analytics.credit_analysis.total_credit_sales = analytics.sales_summary.total_credit;
        analytics.credit_analysis.customers_with_balance = custWithBalance;
        analytics.credit_analysis.customers_near_limit = custNear;
        analytics.credit_analysis.customers_reached_limit = custReached;
        analytics.credit_analysis.customers_exceeded_limit = custExceeded;

        // 4. Top Selling Products
        const [topProdRows] = await db.query(`
            SELECT 
                sni.product_id,
                sni.product_code,
                sni.product_name,
                COALESCE(SUM(sni.quantity), 0) AS total_qty_sold,
                COALESCE(SUM(sni.line_total), 0) AS total_revenue
            FROM sales_note_items sni
            INNER JOIN sales_notes sn ON sn.id = sni.sales_note_id
            WHERE sn.status = 1
            GROUP BY sni.product_id, sni.product_code, sni.product_name
            ORDER BY total_revenue DESC
            LIMIT 5
        `);
        analytics.top_products = topProdRows || [];

        // 5. Low Stock Products (Stock <= 10)
        const [lowStockRows] = await db.query(`
            SELECT 
                p.id,
                p.product_code,
                p.product_name,
                p.stock_quantity,
                p.selling_price,
                c.category_name,
                b.brand_name
            FROM product_master p
            LEFT JOIN category_master c ON c.id = p.category_id
            LEFT JOIN brand_master b ON b.id = p.brand_id
            WHERE p.status = 1 AND p.sale_available = 1 AND p.stock_quantity <= 10
            ORDER BY p.stock_quantity ASC
            LIMIT 5
        `);
        analytics.low_stock_products = lowStockRows || [];

    } catch (err) {
        console.error('[salesNoteHelper] Analytics calculation error:', err.message);
    }

    return analytics;
}

/**
 * Build complete chronological payment list (Payment 1, 2, 3, etc.) for a sales note
 * Combines initial creation payment with subsequent credit payments
 */
function buildPaymentsList(sale, subsequentPayments = []) {
    const list = [];
    const totalSubPayments = subsequentPayments.reduce((sum, p) => sum + parseFloat(p.credit_amount || 0), 0);
    const firstPaymentAmt = (sale.first_payment !== undefined && sale.first_payment !== null)
        ? parseFloat(sale.first_payment)
        : Math.max(0.00, parseFloat(sale.paid_amount || 0) - totalSubPayments);

    // If initial payment was made at creation time, it is Payment 1
    if (firstPaymentAmt > 0.001) {
        let initDate = sale.sales_date ? (sale.sales_time ? `${sale.sales_date} ${sale.sales_time}` : sale.sales_date) : sale.created_at;
        list.push({
            id: 'initial',
            payment_number: 1,
            payment_label: 'Payment 1',
            full_label: 'Payment 1 (Initial / Creation)',
            short_label: 'P1',
            amount: firstPaymentAmt,
            payment_method: sale.payment_type || 'Cash',
            transaction_date: initDate,
            is_initial: true,
            notes: 'Initial payment at sale creation',
            status: 'Paid'
        });
    }

    // Subsequent installment payments: Payment 2, 3, 4, etc. (or Payment 1, 2, 3 if first was 0)
    subsequentPayments.forEach((p) => {
        const nextNum = list.length + 1;
        list.push({
            id: p.id,
            payment_number: nextNum,
            payment_label: `Payment ${nextNum}`,
            full_label: `Payment ${nextNum} (Installment)`,
            short_label: `P${nextNum}`,
            amount: parseFloat(p.credit_amount || p.total_amount || 0),
            payment_method: p.payment_method || 'Cash',
            transaction_date: p.transaction_date,
            is_initial: false,
            notes: p.notes || p.reason || `Credit payment #${nextNum}`,
            status: 'Paid'
        });
    });

    return list;
}

module.exports = {
    generateSalesNoteNumber,
    evaluateCreditStatus,
    getPaymentTypeBadge,
    getPaymentStatusInfo,
    getSaleTypeInfo,
    getSalesAnalytics,
    buildPaymentsList
};
