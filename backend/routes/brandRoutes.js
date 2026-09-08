const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brandController');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get(['/manage_brand.php', '/manage_brand'], brandController.index);
router.post(['/manage_brand.php', '/manage_brand'], brandController.save);
router.get(['/view_brand.php', '/view_brand'], brandController.view);

module.exports = router;
