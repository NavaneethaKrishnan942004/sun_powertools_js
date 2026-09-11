const db = require('../config/db');

const getDashboard = async (req, res, next) => {
    try {
        const [revRows] = await db.query("SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue FROM sales_notes WHERE status = 1");
        const [salesRows] = await db.query("SELECT COUNT(*) AS totalSalesCount FROM sales_notes WHERE status = 1");
        const [custRows] = await db.query("SELECT COUNT(*) AS totalCustomers FROM customer_master WHERE status = 1");
        const [prodRows] = await db.query("SELECT COUNT(*) AS totalProducts FROM product_master WHERE status = 1");

        const totalRevenue = parseFloat(revRows[0].totalRevenue || 0);
        const totalSalesCount = parseInt(salesRows[0].totalSalesCount || 0);
        const totalCustomers = parseInt(custRows[0].totalCustomers || 0);
        const totalProducts = parseInt(prodRows[0].totalProducts || 0);

        const [creditSummaryRows] = await db.query(`
            SELECT 
                COUNT(*) AS totalCreditSalesCount,
                COALESCE(SUM(total_amount), 0) AS totalCreditSalesAmount,
                COALESCE(SUM(credit_amount), 0) AS outstandingCreditAmount
            FROM sales_notes 
            WHERE status = 1 AND (sale_type = 'credit' OR payment_type = 'Credit')
        `);

        const [paidStatusRows] = await db.query(`
            SELECT 
                COUNT(CASE WHEN credit_amount <= 0.001 THEN 1 END) AS fullyPaidCreditSalesCount,
                COUNT(CASE WHEN credit_amount > 0.001 AND paid_amount > 0.001 THEN 1 END) AS partiallyPaidCreditSalesCount,
                COUNT(CASE WHEN paid_amount <= 0.001 THEN 1 END) AS unpaidCreditSalesCount
            FROM sales_notes 
            WHERE status = 1 AND (sale_type = 'credit' OR payment_type = 'Credit')
        `);

        const [limitExceededRows] = await db.query(`
            SELECT COUNT(*) AS creditLimitExceededCount
            FROM sales_notes
            WHERE status = 1 AND (
                credit_status = 'Limit Exceeded' 
                OR credit_status = 'Credit Limit Exceeded' 
                OR (credit_limit > 0 AND new_outstanding > credit_limit)
            )
        `);

        const creditSummary = creditSummaryRows[0] || {};
        const paidStatus = paidStatusRows[0] || {};
        const totalCreditSalesCount = parseInt(creditSummary.totalCreditSalesCount || 0, 10);
        const totalCreditSalesAmount = parseFloat(creditSummary.totalCreditSalesAmount || 0);
        const outstandingCreditAmount = parseFloat(creditSummary.outstandingCreditAmount || 0);
        const fullyPaidCreditSalesCount = parseInt(paidStatus.fullyPaidCreditSalesCount || 0, 10);
        const partiallyPaidCreditSalesCount = parseInt(paidStatus.partiallyPaidCreditSalesCount || 0, 10);
        const unpaidCreditSalesCount = parseInt(paidStatus.unpaidCreditSalesCount || 0, 10);
        const creditLimitExceededCount = parseInt(limitExceededRows[0].creditLimitExceededCount || 0, 10);

        res.render('index', {
            pageTitle: 'Dashboard',
            totalRevenue,
            totalSalesCount,
            totalCustomers,
            totalProducts,
            totalCreditSalesCount,
            totalCreditSalesAmount,
            outstandingCreditAmount,
            fullyPaidCreditSalesCount,
            partiallyPaidCreditSalesCount,
            unpaidCreditSalesCount,
            creditLimitExceededCount
        });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getDashboard
};
