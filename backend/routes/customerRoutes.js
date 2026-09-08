const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { requireLogin } = require('../middleware/auth');

router.get(['/manage_customer.php', '/manage_customer'], requireLogin, customerController.manageCustomers);

router.get(['/create_customer.php', '/create_customer'], requireLogin, customerController.createCustomerForm);
router.post(['/create_customer.php', '/create_customer'], requireLogin, customerController.createCustomer);

router.get(['/edit_customer.php', '/edit_customer'], requireLogin, customerController.editCustomerForm);
router.post(['/edit_customer.php', '/edit_customer'], requireLogin, customerController.editCustomer);

router.get(['/view_customer.php', '/view_customer'], requireLogin, customerController.viewCustomer);

module.exports = router;
