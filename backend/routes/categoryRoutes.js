const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get(['/categories', '/manage_category.php', '/manage_category'], categoryController.index);
router.post(['/categories', '/manage_category.php', '/manage_category'], categoryController.save);
router.get(['/categories/view/:id', '/view_category.php', '/view_category'], categoryController.view);

module.exports = router;
