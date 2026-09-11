-- ==============================================================================
-- Sun PowerTools ERP - TiDB Cloud AUTO_INCREMENT Schema Fix Script
-- ==============================================================================
-- TiDB does not allow: ALTER TABLE table MODIFY id INT AUTO_INCREMENT
-- This script safely recreates tables with proper AUTO_INCREMENT PRIMARY KEY
-- while preserving all existing records and IDs.
-- ==============================================================================

SET FOREIGN_KEY_CHECKS = 0;

-- 1. BRAND MASTER
DROP TABLE IF EXISTS `_schema_fix_brand_master`;
CREATE TABLE `_schema_fix_brand_master` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `brand_code` varchar(20) NOT NULL,
  `brand_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `brand_code` (`brand_code`),
  UNIQUE KEY `brand_name` (`brand_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `_schema_fix_brand_master` SELECT * FROM `brand_master`;
DROP TABLE IF EXISTS `_schema_old_brand_master`;
RENAME TABLE `brand_master` TO `_schema_old_brand_master`, `_schema_fix_brand_master` TO `brand_master`;
DROP TABLE IF EXISTS `_schema_old_brand_master`;

-- 2. CATEGORY MASTER
DROP TABLE IF EXISTS `_schema_fix_category_master`;
CREATE TABLE `_schema_fix_category_master` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_code` varchar(20) NOT NULL,
  `category_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(10) UNSIGNED NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(10) UNSIGNED DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `category_code` (`category_code`),
  UNIQUE KEY `uq_category_name` (`category_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `_schema_fix_category_master` SELECT * FROM `category_master`;
DROP TABLE IF EXISTS `_schema_old_category_master`;
RENAME TABLE `category_master` TO `_schema_old_category_master`, `_schema_fix_category_master` TO `category_master`;
DROP TABLE IF EXISTS `_schema_old_category_master`;

-- 3. UNIT MASTER
DROP TABLE IF EXISTS `_schema_fix_unit_master`;
CREATE TABLE `_schema_fix_unit_master` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `unit_code` varchar(20) NOT NULL,
  `unit_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unit_code` (`unit_code`),
  UNIQUE KEY `unit_name` (`unit_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `_schema_fix_unit_master` SELECT * FROM `unit_master`;
DROP TABLE IF EXISTS `_schema_old_unit_master`;
RENAME TABLE `unit_master` TO `_schema_old_unit_master`, `_schema_fix_unit_master` TO `unit_master`;
DROP TABLE IF EXISTS `_schema_old_unit_master`;

-- 4. PRODUCT TYPE MASTER
DROP TABLE IF EXISTS `_schema_fix_product_type_master`;
CREATE TABLE `_schema_fix_product_type_master` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_type_code` varchar(20) NOT NULL,
  `product_type_name` varchar(100) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  `status` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_by` int(11) DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `product_type_code` (`product_type_code`),
  UNIQUE KEY `product_type_name` (`product_type_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `_schema_fix_product_type_master` SELECT * FROM `product_type_master`;
DROP TABLE IF EXISTS `_schema_old_product_type_master`;
RENAME TABLE `product_type_master` TO `_schema_old_product_type_master`, `_schema_fix_product_type_master` TO `product_type_master`;
DROP TABLE IF EXISTS `_schema_old_product_type_master`;

-- 5. CUSTOMER MASTER
DROP TABLE IF EXISTS `_schema_fix_customer_master`;
CREATE TABLE `_schema_fix_customer_master` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
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
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `customer_code` (`customer_code`),
  KEY `idx_customer_mobile` (`mobile_number`),
  KEY `idx_customer_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `_schema_fix_customer_master` SELECT * FROM `customer_master`;
DROP TABLE IF EXISTS `_schema_old_customer_master`;
RENAME TABLE `customer_master` TO `_schema_old_customer_master`, `_schema_fix_customer_master` TO `customer_master`;
DROP TABLE IF EXISTS `_schema_old_customer_master`;

-- 6. PRODUCT MASTER
DROP TABLE IF EXISTS `_schema_fix_product_master`;
CREATE TABLE `_schema_fix_product_master` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
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
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `product_code` (`product_code`),
  KEY `idx_category_id` (`category_id`),
  KEY `idx_brand_id` (`brand_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `_schema_fix_product_master` SELECT * FROM `product_master`;
DROP TABLE IF EXISTS `_schema_old_product_master`;
RENAME TABLE `product_master` TO `_schema_old_product_master`, `_schema_fix_product_master` TO `product_master`;
DROP TABLE IF EXISTS `_schema_old_product_master`;

-- 7. PRODUCT IMAGES
DROP TABLE IF EXISTS `_schema_fix_product_images`;
CREATE TABLE `_schema_fix_product_images` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `image_name` varchar(255) NOT NULL,
  `image_path` varchar(500) NOT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `product_id` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `_schema_fix_product_images` SELECT * FROM `product_images`;
DROP TABLE IF EXISTS `_schema_old_product_images`;
RENAME TABLE `product_images` TO `_schema_old_product_images`, `_schema_fix_product_images` TO `product_images`;
DROP TABLE IF EXISTS `_schema_old_product_images`;

-- 8. PRODUCT RENTAL RATES
DROP TABLE IF EXISTS `_schema_fix_product_rental_rates`;
CREATE TABLE `_schema_fix_product_rental_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `product_id` int(11) NOT NULL,
  `rental_period` enum('hourly','daily','weekly','monthly') NOT NULL,
  `available` tinyint(1) NOT NULL DEFAULT 0,
  `rental_unit_id` int(11) DEFAULT NULL,
  `security_deposit` decimal(12,2) DEFAULT NULL,
  `rental_rate` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_product_period` (`product_id`,`rental_period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `_schema_fix_product_rental_rates` SELECT * FROM `product_rental_rates`;
DROP TABLE IF EXISTS `_schema_old_product_rental_rates`;
RENAME TABLE `product_rental_rates` TO `_schema_old_product_rental_rates`, `_schema_fix_product_rental_rates` TO `product_rental_rates`;
DROP TABLE IF EXISTS `_schema_old_product_rental_rates`;

-- 9. USER MASTER
DROP TABLE IF EXISTS `_schema_fix_user_master`;
CREATE TABLE `_schema_fix_user_master` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
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
  `last_login_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_id` (`user_id`),
  UNIQUE KEY `uk_user_email` (`user_email`),
  UNIQUE KEY `uk_user_phone` (`user_phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `_schema_fix_user_master` SELECT * FROM `user_master`;
DROP TABLE IF EXISTS `_schema_old_user_master`;
RENAME TABLE `user_master` TO `_schema_old_user_master`, `_schema_fix_user_master` TO `user_master`;
DROP TABLE IF EXISTS `_schema_old_user_master`;

-- 10. CUSTOMER TRANSACTIONS
DROP TABLE IF EXISTS `_schema_fix_customer_transactions`;
CREATE TABLE `_schema_fix_customer_transactions` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
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
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cust_trans` (`customer_id`),
  KEY `idx_trans_type` (`transaction_type`),
  KEY `idx_trans_date` (`transaction_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `_schema_fix_customer_transactions` SELECT * FROM `customer_transactions`;
DROP TABLE IF EXISTS `_schema_old_customer_transactions`;
RENAME TABLE `customer_transactions` TO `_schema_old_customer_transactions`, `_schema_fix_customer_transactions` TO `customer_transactions`;
DROP TABLE IF EXISTS `_schema_old_customer_transactions`;

-- 11. SALES NOTES SCHEMA FIX (round_off, first_payment)
-- Note: TiDB requires schema additions one statement at a time
ALTER TABLE `sales_notes` ADD COLUMN `round_off` DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `other_charges`;
ALTER TABLE `sales_notes` ADD COLUMN `first_payment` DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `paid_amount`;

-- 12. RESTORE FOREIGN KEYS (if supported in TiDB cluster)
ALTER TABLE `product_images` ADD CONSTRAINT `product_images_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `product_master` (`id`) ON DELETE CASCADE;
ALTER TABLE `product_rental_rates` ADD CONSTRAINT `product_rental_rates_ibfk_1` FOREIGN KEY (`product_id`) REFERENCES `product_master` (`id`) ON DELETE CASCADE;

SET FOREIGN_KEY_CHECKS = 1;
