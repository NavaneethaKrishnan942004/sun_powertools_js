const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');
const { requireLogin } = require('../middleware/auth');
const { uploadProductImage } = require('../middleware/upload');

router.get(['/manage_product.php', '/manage_product'], requireLogin, productController.manageProducts);

router.get(['/create_product.php', '/create_product'], requireLogin, productController.createProductForm);
router.post(['/create_product.php', '/create_product'], requireLogin, uploadProductImage.array('product_images', 10), productController.createProduct);

router.get(['/edit_product.php', '/edit_product'], requireLogin, productController.editProductForm);
router.post(['/edit_product.php', '/edit_product'], requireLogin, uploadProductImage.array('product_images', 10), productController.editProduct);

router.get(['/view_product.php', '/view_product'], requireLogin, productController.viewProduct);

module.exports = router;
