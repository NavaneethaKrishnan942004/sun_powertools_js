const express = require('express');
const router = express.Router();
const customerController = require('../controllers/customerController');
const { requireLogin } = require('../middleware/auth');

router.get(['/customers', '/manage_customer.php', '/manage_customer'], requireLogin, customerController.manageCustomers);

router.get(['/customers/create', '/create_customer.php', '/create_customer'], requireLogin, customerController.createCustomerForm);
router.post(['/customers/create', '/create_customer.php', '/create_customer'], requireLogin, customerController.createCustomer);

router.get(['/customers/edit/:id', '/edit_customer.php', '/edit_customer'], requireLogin, customerController.editCustomerForm);
router.post(['/customers/edit/:id', '/edit_customer.php', '/edit_customer'], requireLogin, customerController.editCustomer);

router.get(['/customers/view/:id', '/view_customer.php', '/view_customer'], requireLogin, customerController.viewCustomer);

module.exports = router;
