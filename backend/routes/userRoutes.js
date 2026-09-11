const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

router.get(['/users', '/manage_user.php', '/manage_user'], requireLogin, requireAdmin, userController.manageUser);

router.get(['/users/create', '/create_user.php', '/create_user'], requireLogin, requireAdmin, userController.createForm);
router.post(['/users/create', '/create_user.php', '/create_user'], requireLogin, requireAdmin, userController.createProcess);

router.get(['/users/edit/:id', '/edit_user.php', '/edit_user'], requireLogin, requireAdmin, userController.editForm);
router.post(['/users/edit/:id', '/edit_user.php', '/edit_user'], requireLogin, requireAdmin, userController.editProcess);

router.get(['/users/view/:id', '/view_user.php', '/view_user'], requireLogin, requireAdmin, userController.viewUser);

module.exports = router;
