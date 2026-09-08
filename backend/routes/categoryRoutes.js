const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Support both PHP URL and clean URL
router.get(['/manage_category.php', '/manage_category'], categoryController.index);
router.post(['/manage_category.php', '/manage_category'], categoryController.save);
router.get(['/view_category.php', '/view_category'], categoryController.view);

module.exports = router;
