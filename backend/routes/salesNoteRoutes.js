const express = require('express');
const router = express.Router();
const salesNoteController = require('../controllers/salesNoteController');
const { requireLogin } = require('../middleware/auth');

router.get(['/sales-notes', '/manage_sales_note.php', '/manage_sales_note'], requireLogin, salesNoteController.manageSalesNotes);

router.get(['/sales-notes/create', '/create_sales_note.php', '/create_sales_note'], requireLogin, salesNoteController.createSalesNoteForm);
router.post(['/sales-notes/create', '/create_sales_note.php', '/create_sales_note'], requireLogin, salesNoteController.createSalesNote);

router.get(['/sales-notes/edit/:id', '/edit_sales_note.php', '/edit_sales_note'], requireLogin, salesNoteController.editSalesNoteForm);
router.post(['/sales-notes/edit/:id', '/edit_sales_note.php', '/edit_sales_note'], requireLogin, salesNoteController.editSalesNote);

router.get(['/sales-notes/view/:id', '/view_sales_note.php', '/view_sales_note'], requireLogin, salesNoteController.viewSalesNote);

router.post(['/sales-notes/receive-payment', '/receive_payment.php'], requireLogin, salesNoteController.receivePayment);

router.all(['/sales-notes/ajax', '/ajax_sales_note.php', '/ajax_sales_note'], requireLogin, salesNoteController.ajaxSalesNote);

module.exports = router;
