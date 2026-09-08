const express = require('express');
const router = express.Router();
const unitController = require('../controllers/unitController');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

router.get(['/manaage_unit.php', '/manage_unit.php', '/manaage_unit', '/manage_unit'], unitController.index);
router.post(['/manaage_unit.php', '/manage_unit.php', '/manaage_unit', '/manage_unit'], unitController.save);
router.get(['/view_unit.php', '/view_unit'], unitController.view);

module.exports = router;
