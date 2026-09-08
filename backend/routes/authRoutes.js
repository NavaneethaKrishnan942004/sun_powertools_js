const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login.php', authController.showLogin);
router.get('/login', authController.showLogin);

router.post('/login.php', authController.processLogin);
router.post('/login', authController.processLogin);

router.get('/logout.php', authController.logout);
router.get('/logout', authController.logout);

module.exports = router;
