const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { requireLogin, requireAdmin } = require('../middleware/auth');

router.get('/manage_user.php', requireLogin, requireAdmin, userController.manageUser);
router.get('/manage_user', requireLogin, requireAdmin, userController.manageUser);

router.get('/create_user.php', requireLogin, requireAdmin, userController.createForm);
router.get('/create_user', requireLogin, requireAdmin, userController.createForm);

router.post('/create_user.php', requireLogin, requireAdmin, userController.createProcess);
router.post('/create_user', requireLogin, requireAdmin, userController.createProcess);

router.get('/edit_user.php', requireLogin, requireAdmin, userController.editForm);
router.get('/edit_user', requireLogin, requireAdmin, userController.editForm);

router.post('/edit_user.php', requireLogin, requireAdmin, userController.editProcess);
router.post('/edit_user', requireLogin, requireAdmin, userController.editProcess);

router.get('/view_user.php', requireLogin, requireAdmin, userController.viewUser);
router.get('/view_user', requireLogin, requireAdmin, userController.viewUser);

module.exports = router;
