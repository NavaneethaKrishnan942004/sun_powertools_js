const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { requireLogin } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');

router.get('/profile.php', requireLogin, profileController.getProfile);
router.get('/profile', requireLogin, profileController.getProfile);

router.post('/profile.php', requireLogin, uploadAvatar.single('avatar'), profileController.updateProfile);
router.post('/profile', requireLogin, uploadAvatar.single('avatar'), profileController.updateProfile);

module.exports = router;
