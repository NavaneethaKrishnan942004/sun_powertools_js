const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { requireLogin } = require('../middleware/auth');

// Main Reports Dashboard
router.get(['/reports', '/reports.php'], requireLogin, reportController.reportsDashboard);

// Export Routes
router.get(['/reports/export/excel', '/reports/excel'], requireLogin, reportController.exportExcel);
router.get(['/reports/export/word', '/reports/word'], requireLogin, reportController.exportWord);
router.get(['/reports/export/pdf', '/reports/pdf'], requireLogin, reportController.exportPdf);

module.exports = router;
