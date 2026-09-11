const express = require('express');
const router = express.Router();
const productTypeController = require('../controllers/productTypeController');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get(['/product-types', '/manage_producttype.php', '/manage_producttype'], productTypeController.index);
router.post(['/product-types', '/manage_producttype.php', '/manage_producttype'], productTypeController.save);
router.get(['/product-types/view/:id', '/view_producttype.php', '/view_product_type.php', '/view_producttype'], productTypeController.view);

module.exports = router;
