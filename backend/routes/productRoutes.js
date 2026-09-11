const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { requireLogin } = require('../middleware/auth');
const { uploadProductImage } = require('../middleware/upload');

router.get(['/products', '/manage_product.php', '/manage_product'], requireLogin, productController.manageProducts);

router.get(['/products/create', '/create_product.php', '/create_product'], requireLogin, productController.createProductForm);
router.post(['/products/create', '/create_product.php', '/create_product'], requireLogin, uploadProductImage.array('product_images', 10), productController.createProduct);

router.get(['/products/edit/:id', '/edit_product.php', '/edit_product'], requireLogin, productController.editProductForm);
router.post(['/products/edit/:id', '/edit_product.php', '/edit_product'], requireLogin, uploadProductImage.array('product_images', 10), productController.editProduct);

router.get(['/products/view/:id', '/view_product.php', '/view_product'], requireLogin, productController.viewProduct);

module.exports = router;
