const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { requireLogin } = require('../middleware/auth');

router.get(['/masters', '/masters.php'], requireLogin, settingsController.getMasters);
router.get(['/settings', '/settings.php'], requireLogin, settingsController.getSettings);

module.exports = router;
