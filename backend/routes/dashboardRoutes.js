const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { requireLogin } = require('../middleware/auth');

router.get('/', requireLogin, dashboardController.getDashboard);
router.get('/index.php', requireLogin, dashboardController.getDashboard);
router.get('/index', requireLogin, dashboardController.getDashboard);

module.exports = router;
