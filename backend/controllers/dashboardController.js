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

        res.render('index', {
            pageTitle: 'Dashboard',
            totalRevenue,
            totalSalesCount,
            totalCustomers,
            totalProducts
        });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getDashboard
};
