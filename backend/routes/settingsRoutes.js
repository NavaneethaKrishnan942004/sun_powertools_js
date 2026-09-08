const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { requireLogin } = require('../middleware/auth');

router.get('/masters.php', requireLogin, settingsController.getMasters);
router.get('/masters', requireLogin, settingsController.getMasters);

router.get('/settings.php', requireLogin, settingsController.getSettings);
router.get('/settings', requireLogin, settingsController.getSettings);

module.exports = router;
