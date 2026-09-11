const express = require('express');
const router = express.Router();
const brandController = require('../controllers/brandController');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get(['/brands', '/manage_brand.php', '/manage_brand'], brandController.index);
router.post(['/brands', '/manage_brand.php', '/manage_brand'], brandController.save);
router.get(['/brands/view/:id', '/view_brand.php', '/view_brand'], brandController.view);

module.exports = router;
