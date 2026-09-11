const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { requireLogin } = require('../middleware/auth');

router.get('/', requireLogin, dashboardController.getDashboard);
router.get(['/index.php', '/index'], requireLogin, (req, res) => res.redirect(302, '/'));

module.exports = router;
