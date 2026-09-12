const db = require('../backend/config/db');

(async () => {
  try {
    const [revRows] = await db.query('SELECT COALESCE(SUM(total_amount), 0) AS totalRevenue, COUNT(*) AS totalCount, COALESCE(AVG(total_amount), 0) AS avgSale FROM sales_notes WHERE status = 1');
    console.log('Sales summary:', revRows[0]);
    
    const [monthTrend] = await db.query(`
      SELECT 
        DATE_FORMAT(sales_date, '%Y-%m') as month_key, 
        DATE_FORMAT(sales_date, '%b %y') as month_label, 
        COUNT(*) as note_count, 
        COALESCE(SUM(total_amount), 0) as total_revenue 
      FROM sales_notes 
      WHERE status = 1 AND sales_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) 
      GROUP BY month_key, month_label 
      ORDER BY month_key ASC
    `);
    console.log('Month trend rows:', monthTrend);

    const [rentalStats] = await db.query(`
      SELECT
        COUNT(*) AS totalRentals,
        COALESCE(SUM(CASE WHEN rental_status = 'Active' AND expected_checkout_datetime >= NOW() THEN 1 ELSE 0 END), 0) AS activeRentals,
        COALESCE(SUM(CASE WHEN rental_status = 'Overdue' OR (rental_status = 'Active' AND expected_checkout_datetime < NOW()) THEN 1 ELSE 0 END), 0) AS overdueRentals,
        COALESCE(SUM(CASE WHEN rental_status = 'Returned' THEN 1 ELSE 0 END), 0) AS returnedRentals,
        COALESCE(SUM(CASE WHEN (rental_status = 'Active' OR rental_status = 'Overdue') AND DATE(expected_checkout_datetime) = CURDATE() THEN 1 ELSE 0 END), 0) AS dueTodayRentals,
        COALESCE(SUM(advance_rental_amount), 0) AS totalAdvance,
        COALESCE(SUM(security_deposit), 0) AS totalDeposits
      FROM rentals
    `);
    console.log('Rental stats:', rentalStats[0]);

    const [topCust] = await db.query(`
      SELECT 
        cm.id, cm.customer_code, cm.customer_name, cm.mobile_number,
        COUNT(sn.id) as orders_count,
        COALESCE(SUM(sn.total_amount), 0) as total_spent,
        COALESCE(SUM(sn.credit_amount), 0) as total_credit
      FROM customer_master cm
      INNER JOIN sales_notes sn ON sn.customer_id = cm.id
      WHERE sn.status = 1
      GROUP BY cm.id, cm.customer_code, cm.customer_name, cm.mobile_number
      ORDER BY total_spent DESC
      LIMIT 5
    `);
    console.log('Top customers:', topCust);

    console.log('All test queries passed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
