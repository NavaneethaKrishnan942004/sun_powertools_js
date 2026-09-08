-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Aug 29, 2026 at 06:09 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `powertools_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `brand_master`
--

CREATE TABLE `brand_master` (
  `id` int(11) NOT NULL,
  `brand_code` varchar(20) NOT NULL,
  `brand_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `brand_master`
--

INSERT INTO `brand_master` (`id`, `brand_code`, `brand_name`, `description`, `status`, `created_by`, `created_at`, `updated_by`, `updated_at`) VALUES
(1, 'BRA-001', 'Bosch', '', 1, 1, '2026-08-27 09:22:31', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `category_master`
--

CREATE TABLE `category_master` (
  `id` int(10) UNSIGNED NOT NULL,
  `category_code` varchar(20) NOT NULL,
  `category_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(10) UNSIGNED DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `category_master`
--

INSERT INTO `category_master` (`id`, `category_code`, `category_name`, `description`, `status`, `created_by`, `created_at`, `updated_by`, `updated_at`) VALUES
(1, 'CAT-001', 'Drilling Tools', '', 0, 1, '2026-08-25 12:23:13', 1, '2026-08-25 12:24:39'),
(2, 'CAT-002', 'Cutting Tools', 'Tools used for cutting applications', 0, 1, '2026-08-25 12:23:13', 1, '2026-08-25 11:42:02'),
(3, 'CAT-003', 'Grinding Tools', 'Tools used for grinding applications', 1, 1, '2026-08-25 12:23:13', 1, '2026-08-25 12:53:39'),
(4, 'CAT-004', 'Drill', '', 1, 1, '2026-08-25 12:23:46', 1, '2026-08-25 13:08:25'),
(5, 'CAT-005', 'Cutting', '', 1, 1, '2026-08-28 08:05:23', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `customer_master`
--

CREATE TABLE `customer_master` (
  `id` int(10) UNSIGNED NOT NULL,
  `customer_code` varchar(20) NOT NULL,
  `customer_name` varchar(150) NOT NULL,
  `customer_type` enum('Individual','Business') NOT NULL DEFAULT 'Individual',
  `company_name` varchar(150) DEFAULT NULL,
  `mobile_number` varchar(20) NOT NULL,
  `alternate_mobile_number` varchar(20) DEFAULT NULL,
  `email` varchar(150) DEFAULT NULL,
  `gst_number` varchar(30) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `area` varchar(100) DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `district` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `billing_address` text DEFAULT NULL,
  `shipping_address` text DEFAULT NULL,
  `credit_allowed` tinyint(1) NOT NULL DEFAULT 0,
  `credit_limit` decimal(12,2) NOT NULL DEFAULT 0.00,
  `payment_terms` varchar(50) DEFAULT 'Immediate',
  `opening_balance` decimal(12,2) NOT NULL DEFAULT 0.00,
  `opening_balance_type` enum('Debit','Credit') NOT NULL DEFAULT 'Debit',
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_by` int(10) UNSIGNED DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `customer_master`
--

INSERT INTO `customer_master` (`id`, `customer_code`, `customer_name`, `customer_type`, `company_name`, `mobile_number`, `alternate_mobile_number`, `email`, `gst_number`, `address`, `area`, `city`, `district`, `state`, `pincode`, `billing_address`, `shipping_address`, `credit_allowed`, `credit_limit`, `payment_terms`, `opening_balance`, `opening_balance_type`, `status`, `created_by`, `created_at`, `updated_by`, `updated_at`) VALUES
(1, 'CUS-001', 'Ayyappan N', 'Individual', NULL, '9688583687', NULL, NULL, NULL, 'SISh Coloney', NULL, 'Coimbatore', 'Coimbatore', 'Tamil Nadu', '641014', NULL, NULL, 1, 1000.00, '15 Days', 0.00, 'Debit', 1, 2, '2026-08-28 11:54:46', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `customer_transactions`
--

CREATE TABLE `customer_transactions` (
  `id` int(10) UNSIGNED NOT NULL,
  `customer_id` int(10) UNSIGNED NOT NULL,
  `transaction_type` enum('sale','rental','payment','return','adjustment') NOT NULL,
  `reference_number` varchar(50) NOT NULL,
  `transaction_date` datetime NOT NULL,
  `due_date` date DEFAULT NULL,
  `total_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `paid_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `debit_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `credit_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `payment_method` varchar(50) DEFAULT NULL,
  `payment_status` enum('Paid','Partial','Unpaid','Settled') DEFAULT 'Unpaid',
  `reason` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` datetime NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `product_images`
--

CREATE TABLE `product_images` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `image_name` varchar(255) NOT NULL,
  `image_path` varchar(500) NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `product_images`
--

INSERT INTO `product_images` (`id`, `product_id`, `image_name`, `image_path`, `is_primary`, `created_at`) VALUES
(1, 1, '71rDK+hDmHL._SL1500_.jpg', 'uploads/products/product_6a915a68534b16.51281463.jpg', 1, '2026-08-28 15:22:40');

-- --------------------------------------------------------

--
-- Table structure for table `product_master`
--

CREATE TABLE `product_master` (
  `id` int(11) NOT NULL,
  `product_code` varchar(20) NOT NULL,
  `product_name` varchar(200) NOT NULL,
  `short_name` varchar(100) NOT NULL,
  `category_id` int(11) NOT NULL,
  `brand_id` int(11) NOT NULL,
  `description` text DEFAULT NULL,
  `sale_available` tinyint(1) NOT NULL DEFAULT 0,
  `stock_quantity` int(11) NOT NULL DEFAULT 50,
  `purchase_price` decimal(12,2) DEFAULT NULL,
  `selling_price` decimal(12,2) DEFAULT NULL,
  `discount_allowed` tinyint(1) NOT NULL DEFAULT 0,
  `discount_percent` decimal(5,2) DEFAULT NULL,
  `sale_unit` decimal(12,2) DEFAULT NULL,
  `rental_available` tinyint(1) NOT NULL DEFAULT 0,
  `power_rating` varchar(100) DEFAULT NULL,
  `voltage` varchar(100) DEFAULT NULL,
  `rpm` varchar(100) DEFAULT NULL,
  `chuck_disc_size` varchar(100) DEFAULT NULL,
  `weight` varchar(100) DEFAULT NULL,
  `battery_capacity` varchar(100) DEFAULT NULL,
  `warranty_period` varchar(100) DEFAULT NULL,
  `warranty_applicable` tinyint(1) NOT NULL DEFAULT 0,
  `warranty_months` int(11) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `product_master`
--

INSERT INTO `product_master` (`id`, `product_code`, `product_name`, `short_name`, `category_id`, `brand_id`, `description`, `sale_available`, `purchase_price`, `selling_price`, `discount_allowed`, `discount_percent`, `sale_unit`, `rental_available`, `power_rating`, `voltage`, `rpm`, `chuck_disc_size`, `weight`, `battery_capacity`, `warranty_period`, `warranty_applicable`, `warranty_months`, `status`, `created_by`, `created_at`, `updated_by`, `updated_at`) VALUES
(1, 'PRO-001', 'BOSCH GSB 600 Impact Drill Machine for Home & Professional Use, 100Pcs Accessory Kit | 600W Motor | 13mm Chuck | 3000 RPM | 48000 BPM | Variable Speed | 1 Year Warranty', 'BOSCH GSB 600 Impact', 4, 1, '', 1, NULL, 2999.00, 1, 10.00, 0.00, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, 12, 1, 2, '2026-08-28 11:52:40', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `product_rental_rates`
--

CREATE TABLE `product_rental_rates` (
  `id` int(11) NOT NULL,
  `product_id` int(11) NOT NULL,
  `rental_period` enum('hourly','daily','weekly','monthly') NOT NULL,
  `available` tinyint(1) NOT NULL DEFAULT 0,
  `rental_unit_id` int(11) DEFAULT NULL,
  `security_deposit` decimal(12,2) DEFAULT NULL,
  `rental_rate` decimal(12,2) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `product_rental_rates`
--

INSERT INTO `product_rental_rates` (`id`, `product_id`, `rental_period`, `available`, `rental_unit_id`, `security_deposit`, `rental_rate`) VALUES
(1, 1, 'hourly', 0, NULL, NULL, NULL),
(2, 1, 'daily', 1, 2, 499.83, 150.00),
(3, 1, 'weekly', 1, 2, 1000.00, 500.00),
(4, 1, 'monthly', 1, 2, 2000.00, 3000.00);

-- --------------------------------------------------------

--
-- Table structure for table `product_type_master`
--

CREATE TABLE `product_type_master` (
  `id` int(11) NOT NULL,
  `product_type_code` varchar(20) NOT NULL,
  `product_type_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `product_type_master`
--

INSERT INTO `product_type_master` (`id`, `product_type_code`, `product_type_name`, `description`, `status`, `created_by`, `created_at`, `updated_by`, `updated_at`) VALUES
(1, 'PROTY-001', 'Rent', '', 1, 2, '2026-08-28 09:54:48', NULL, NULL),
(2, 'PROTY-002', 'Sales', '', 1, 2, '2026-08-28 09:54:55', NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `rentals`
--

CREATE TABLE `rentals` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `rental_no` varchar(50) NOT NULL UNIQUE,
  `customer_id` int(10) UNSIGNED NOT NULL,
  `product_id` int(11) NOT NULL,
  `rental_period_type` enum('hourly','daily','weekly','monthly','custom') NOT NULL DEFAULT 'daily',
  `rental_rate` decimal(12,2) NOT NULL DEFAULT 0.00,
  `security_deposit` decimal(12,2) NOT NULL DEFAULT 0.00,
  `check_in_datetime` datetime NOT NULL,
  `expected_checkout_datetime` datetime NOT NULL,
  `actual_return_datetime` datetime DEFAULT NULL,
  `advance_rental_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_rental_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `additional_charges` decimal(12,2) NOT NULL DEFAULT 0.00,
  `refund_amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `payment_method` varchar(50) NOT NULL DEFAULT 'Cash',
  `rental_status` enum('Active','Returned','Overdue','Cancelled') NOT NULL DEFAULT 'Active',
  `notes` text DEFAULT NULL,
  `created_by` int(10) UNSIGNED DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(10) UNSIGNED DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_rentals_customer` (`customer_id`),
  KEY `idx_rentals_product` (`product_id`),
  KEY `idx_rentals_status` (`rental_status`),
  KEY `idx_rentals_dates` (`check_in_datetime`, `expected_checkout_datetime`),
  CONSTRAINT `fk_rentals_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer_master` (`id`),
  CONSTRAINT `fk_rentals_product` FOREIGN KEY (`product_id`) REFERENCES `product_master` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `unit_master`
--

CREATE TABLE `unit_master` (
  `id` int(11) NOT NULL,
  `unit_code` varchar(20) NOT NULL,
  `unit_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `unit_master`
--

INSERT INTO `unit_master` (`id`, `unit_code`, `unit_name`, `description`, `status`, `created_by`, `created_at`, `updated_by`, `updated_at`) VALUES
(1, 'UNIT-001', 'Box', '', 1, 1, '2026-08-28 08:41:20', NULL, NULL),
(2, 'UNIT-002', 'Qty', '', 1, 1, '2026-08-28 08:45:39', 2, '2026-08-28 11:50:25'),
(3, 'UNIT-003', 'Count', '', 1, 1, '2026-08-28 08:52:07', NULL, NULL),
(4, 'UNIT-004', 'cc', '', 1, 1, '2026-08-28 08:54:02', NULL, NULL),
(5, 'UNIT-005', 'ac', '', 1, 1, '2026-08-28 08:55:12', NULL, NULL),
(6, 'UNIT-006', 'sss', '', 1, 1, '2026-08-28 08:58:41', NULL, NULL),
(7, 'UNIT-007', 'Update', '', 1, 1, '2026-08-28 09:01:10', 1, '2026-08-28 09:17:44');

-- --------------------------------------------------------

--
-- Table structure for table `user_master`
--

CREATE TABLE `user_master` (
  `id` int(10) UNSIGNED NOT NULL,
  `user_id` varchar(20) NOT NULL,
  `first_name` varchar(50) DEFAULT NULL,
  `last_name` varchar(50) DEFAULT NULL,
  `gender` enum('Male','Female','Other') DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `user_name` varchar(100) NOT NULL,
  `user_email` varchar(150) NOT NULL,
  `user_phone` varchar(20) NOT NULL,
  `address` text DEFAULT NULL,
  `city` varchar(100) DEFAULT NULL,
  `state` varchar(100) DEFAULT NULL,
  `pincode` varchar(10) DEFAULT NULL,
  `avatar` varchar(255) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  `last_login_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `user_master`
--

INSERT INTO `user_master` (`id`, `user_id`, `first_name`, `last_name`, `gender`, `date_of_birth`, `user_name`, `user_email`, `user_phone`, `address`, `city`, `state`, `pincode`, `avatar`, `password`, `role`, `status`, `created_at`, `updated_at`, `last_login_at`) VALUES
(1, 'US-001', NULL, NULL, NULL, NULL, 'Admin123', 'admin123@gmail.com', '9345988595', NULL, NULL, NULL, NULL, NULL, '$2y$10$v9olNAjtygmq0ewOxSlQ2.dCmKBKIrfqjcAsMHwhvDfmkiPLqPP2W', 'admin', 1, '2026-08-25 14:20:44', '2026-08-25 14:21:13', NULL),
(2, 'US-002', 'Navaneetha', 'Krishnan', 'Male', '2004-04-09', 'Navaneetha9345', 'navaneetha123@gmail.com', '9345988594', '', '', '', '', 'US-002_ef37f26a871a54b1.jpg', '$2y$10$BiW22MLUqmhvdZ3GM3cGZ.vZOhwUyH4hYfauXUQTPrXVWpMmjmfAK', 'admin', 1, '2026-08-25 14:56:38', '2026-08-26 10:08:12', '2026-08-28 15:15:01');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `brand_master`
--
ALTER TABLE `brand_master`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `brand_code` (`brand_code`),
  ADD UNIQUE KEY `brand_name` (`brand_name`);

--
-- Indexes for table `category_master`
--
ALTER TABLE `category_master`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `category_code` (`category_code`),
  ADD UNIQUE KEY `uq_category_name` (`category_name`);

--
-- Indexes for table `customer_master`
--
ALTER TABLE `customer_master`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `customer_code` (`customer_code`),
  ADD KEY `idx_customer_mobile` (`mobile_number`),
  ADD KEY `idx_customer_status` (`status`);

--
-- Indexes for table `customer_transactions`
--
ALTER TABLE `customer_transactions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_cust_trans` (`customer_id`),
  ADD KEY `idx_trans_type` (`transaction_type`),
  ADD KEY `idx_trans_date` (`transaction_date`);

--
-- Indexes for table `product_images`
--
ALTER TABLE `product_images`
  ADD PRIMARY KEY (`id`),
  ADD KEY `product_id` (`product_id`);

--
-- Indexes for table `product_master`
--
ALTER TABLE `product_master`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `product_code` (`product_code`),
  ADD KEY `idx_category_id` (`category_id`),
  ADD KEY `idx_brand_id` (`brand_id`),
  ADD KEY `idx_status` (`status`);

--
-- Indexes for table `product_rental_rates`
--
ALTER TABLE `product_rental_rates`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_product_period` (`product_id`,`rental_period`);

--
-- Indexes for table `product_type_master`
--
ALTER TABLE `product_type_master`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `product_type_code` (`product_type_code`),
  ADD UNIQUE KEY `product_type_name` (`product_type_name`);

--
-- Indexes for table `unit_master`
--
ALTER TABLE `unit_master`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unit_code` (`unit_code`),
  ADD UNIQUE KEY `unit_name` (`unit_name`);

--
-- Indexes for table `user_master`
--
ALTER TABLE `user_master`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uk_user_id` (`user_id`),
  ADD UNIQUE KEY `uk_user_email` (`user_email`),
  ADD UNIQUE KEY `uk_user_phone` (`user_phone`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `brand_master`
--
ALTER TABLE `brand_master`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `category_master`
--
ALTER TABLE `category_master`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `customer_master`
--
ALTER TABLE `customer_master`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `customer_transactions`
--
ALTER TABLE `customer_transactions`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `product_images`
--
ALTER TABLE `product_images`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `product_master`
--
ALTER TABLE `product_master`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `product_rental_rates`
--
ALTER TABLE `product_rental_rates`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `product_type_master`
--
ALTER TABLE `product_type_master`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- AUTO_INCREMENT for table `sales_notes`
--
ALTER TABLE `sales_notes`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `sales_note_items`
--
ALTER TABLE `sales_note_items`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `unit_master`
--
ALTER TABLE `unit_master`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `user_master`
--
ALTER TABLE `user_master`
  MODIFY `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `product_images`
--
ALTER TABLE `product_images`
  ADD CONSTRAINT `product_images_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `product_master` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `product_rental_rates`
--
ALTER TABLE `product_rental_rates`
  ADD CONSTRAINT `product_rental_rates_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `product_master` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `sales_note_items`
--
ALTER TABLE `sales_note_items`
  ADD CONSTRAINT `fk_sni_sales_note` FOREIGN KEY (`sales_note_id`) REFERENCES `sales_notes` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
