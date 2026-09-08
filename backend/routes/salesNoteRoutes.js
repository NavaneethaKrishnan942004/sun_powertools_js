const express = require('express');
const router = express.Router();
const salesNoteController = require('../controllers/salesNoteController');
const { requireLogin } = require('../middleware/auth');

router.get(['/manage_sales_note.php', '/manage_sales_note'], requireLogin, salesNoteController.manageSalesNotes);

router.get(['/create_sales_note.php', '/create_sales_note'], requireLogin, salesNoteController.createSalesNoteForm);
router.post(['/create_sales_note.php', '/create_sales_note'], requireLogin, salesNoteController.createSalesNote);

router.get(['/edit_sales_note.php', '/edit_sales_note'], requireLogin, salesNoteController.editSalesNoteForm);
router.post(['/edit_sales_note.php', '/edit_sales_note'], requireLogin, salesNoteController.editSalesNote);

router.get(['/view_sales_note.php', '/view_sales_note'], requireLogin, salesNoteController.viewSalesNote);

router.all(['/ajax_sales_note.php', '/ajax_sales_note'], requireLogin, salesNoteController.ajaxSalesNote);

module.exports = router;
