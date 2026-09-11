const express = require('express');
const router = express.Router();
const rentalController = require('../controllers/rentalController');
const { requireLogin } = require('../middleware/auth');

// Rental Management / List
router.get(['/rentals', '/manage_rental.php', '/manage_rental'], requireLogin, rentalController.manageRentals);

// Rental Checkout / Create
router.get(['/rentals/create', '/create_rental.php', '/create_rental'], requireLogin, rentalController.createRentalForm);
router.post(['/rentals/create', '/create_rental.php', '/create_rental'], requireLogin, rentalController.createRental);

// View Rental Details
router.get(['/rentals/view/:id', '/view_rental.php', '/view_rental'], requireLogin, rentalController.viewRental);

// Return Rental Product
router.post(['/rentals/return', '/return_rental.php', '/return_rental'], requireLogin, rentalController.returnRental);

// Cancel Rental
router.post(['/rentals/cancel', '/cancel_rental.php', '/cancel_rental'], requireLogin, rentalController.cancelRental);

// AJAX Operations
router.all(['/rentals/ajax', '/ajax_rental.php', '/ajax_rental'], requireLogin, rentalController.ajaxRental);

module.exports = router;
