const pool = require('../config/db');

async function generateProductCode() {
    const [rows] = await pool.query(`
        SELECT product_code
        FROM product_master
        ORDER BY id DESC
        LIMIT 1
    `);

    if (!rows.length || !rows[0].product_code) {
        return 'PRO-001';
    }

    const lastCode = rows[0].product_code;
    const numPart = parseInt(lastCode.replace('PRO-', ''), 10);
    const nextNum = isNaN(numPart) ? 1 : numPart + 1;
    return 'PRO-' + String(nextNum).padStart(3, '0');
}

// List products
exports.manageProducts = async (req, res) => {
    try {
        const { search = '', status = '', category_id = '', brand_id = '' } = req.query;

        const page = Math.max(1, parseInt(req.query.page || 1, 10));
        const limit = 10;
        const offset = (page - 1) * limit;

        const [categories] = await pool.query(`
            SELECT id, category_code, category_name
            FROM category_master
            WHERE status = 1
            ORDER BY category_name ASC
        `);

        const [brands] = await pool.query(`
            SELECT id, brand_code, brand_name
            FROM brand_master
            WHERE status = 1
            ORDER BY brand_name ASC
        `);

        let whereSql = ' WHERE 1=1';
        const params = [];

        if (search.trim() !== '') {
            whereSql += ` AND (
                p.product_code LIKE ?
                OR p.product_name LIKE ?
                OR p.short_name LIKE ?
            )`;
            const sp = `%${search.trim()}%`;
            params.push(sp, sp, sp);
        }

        if (status !== '' && ['0', '1'].includes(status)) {
            whereSql += ` AND p.status = ?`;
            params.push(parseInt(status, 10));
        }

        if (category_id !== '') {
            whereSql += ` AND p.category_id = ?`;
            params.push(parseInt(category_id, 10));
        }

        if (brand_id !== '') {
            whereSql += ` AND p.brand_id = ?`;
            params.push(parseInt(brand_id, 10));
        }

        // Count total matching records
        const countSql = `SELECT COUNT(*) AS total FROM product_master p ${whereSql}`;
        const [countRows] = await pool.query(countSql, params);
        const totalRecords = countRows && countRows.length > 0 ? countRows[0].total : 0;
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

        // Fetch paginated data
        const dataSql = `
            SELECT
                p.*,
                c.category_code,
                c.category_name,
                b.brand_code,
                b.brand_name,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM product_master p
            LEFT JOIN category_master c ON c.id = p.category_id
            LEFT JOIN brand_master b ON b.id = p.brand_id
            LEFT JOIN user_master creator ON creator.id = p.created_by
            LEFT JOIN user_master updater ON updater.id = p.updated_by
            ${whereSql}
            ORDER BY p.id DESC
            LIMIT ? OFFSET ?
        `;

        const [products] = await pool.query(dataSql, [...params, limit, offset]);

        res.render('manage_product', {
            pageTitle: 'Product Master',
            products,
            categories,
            brands,
            search,
            statusFilter: status,
            categoryFilter: category_id,
            brandFilter: brand_id,
            page,
            limit,
            totalRecords,
            totalPages,
            queryParams: req.query
        });
    } catch (err) {
        console.error('manageProducts error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Show create product form
exports.createProductForm = async (req, res) => {
    try {
        const [categories] = await pool.query(`
            SELECT id, category_code, category_name
            FROM category_master
            WHERE status = 1
            ORDER BY category_name ASC
        `);

        const [brands] = await pool.query(`
            SELECT id, brand_code, brand_name
            FROM brand_master
            WHERE status = 1
            ORDER BY brand_name ASC
        `);

        const [units] = await pool.query(`
            SELECT id, unit_code, unit_name
            FROM unit_master
            WHERE status = 1
            ORDER BY unit_name ASC
        `);

        res.render('create_product', {
            pageTitle: 'Create Product',
            categories,
            brands,
            units,
            old: {},
            errors: [],
            productNameError: '',
            shortNameError: '',
            categoryError: '',
            brandError: '',
            imageError: '',
            saleError: '',
            sellingPriceError: '',
            rentalError: '',
            generalError: ''
        });
    } catch (err) {
        console.error('createProductForm error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Process create product
exports.createProduct = async (req, res) => {
    try {
        const body = req.body || {};
        const files = req.files || [];

        const [categories] = await pool.query(`
            SELECT id, category_code, category_name
            FROM category_master
            WHERE status = 1
            ORDER BY category_name ASC
        `);

        const [brands] = await pool.query(`
            SELECT id, brand_code, brand_name
            FROM brand_master
            WHERE status = 1
            ORDER BY brand_name ASC
        `);

        const [units] = await pool.query(`
            SELECT id, unit_code, unit_name
            FROM unit_master
            WHERE status = 1
            ORDER BY unit_name ASC
        `);

        const status = body.status !== undefined ? 1 : 0;
        const productName = (body.product_name || '').trim();
        const shortName = (body.short_name || '').trim();
        const categoryId = parseInt(body.category_id || 0, 10);
        const brandId = parseInt(body.brand_id || 0, 10);
        const description = (body.description || '').trim();
        const saleAvailable = (body.sale_available || '') === 'yes' ? 1 : 0;
        const purchasePrice = (body.purchase_price || '').trim();
        const sellingPrice = (body.selling_price || '').trim();
        const discountAllowed = (body.discount_allowed || 'no') === 'yes' ? 1 : 0;
        const discountPercent = (body.discount_percent || '').trim();
        const saleUnit = (body.sale_unit || '').trim();
        const rentalAvailable = (body.rental_available || '') === 'yes' ? 1 : 0;
        const powerRating = (body.power_rating || '').trim();
        const voltage = (body.voltage || '').trim();
        const rpm = (body.rpm || '').trim();
        const chuckDiscSize = (body.chuck_disc_size || '').trim();
        const weight = (body.weight || '').trim();
        const batteryCapacity = (body.battery_capacity || '').trim();
        const warrantyPeriod = (body.warranty_period || '').trim();
        const warrantyApplicable = (body.warranty_applicable || 'no') === 'yes' ? 1 : 0;
        const warrantyMonths = (body.warranty_months || '').trim();

        const errors = [];
        let productNameError = '';
        let shortNameError = '';
        let categoryError = '';
        let brandError = '';
        let imageError = '';
        let saleError = '';
        let sellingPriceError = '';
        let rentalError = '';
        let generalError = '';

        // Validation
        if (productName === '') {
            productNameError = 'Product Name is required.';
            errors.push(productNameError);
        } else if (productName.length < 2) {
            productNameError = 'Product Name must be at least 2 characters.';
            errors.push(productNameError);
        } else if (productName.length > 200) {
            productNameError = 'Product Name cannot exceed 200 characters.';
            errors.push(productNameError);
        }

        if (shortName === '') {
            shortNameError = 'Short Name is required.';
            errors.push(shortNameError);
        } else if (shortName.length < 2) {
            shortNameError = 'Short Name must be at least 2 characters.';
            errors.push(shortNameError);
        } else if (shortName.length > 100) {
            shortNameError = 'Short Name cannot exceed 100 characters.';
            errors.push(shortNameError);
        }

        if (categoryId <= 0) {
            categoryError = 'Category is required.';
            errors.push(categoryError);
        }

        if (brandId <= 0) {
            brandError = 'Brand is required.';
            errors.push(brandError);
        }

        if (!body.sale_available) {
            saleError = 'Sale Available is required.';
            errors.push(saleError);
        }

        if (saleAvailable === 1) {
            if (sellingPrice === '') {
                sellingPriceError = 'Selling Price is required.';
                errors.push(sellingPriceError);
            } else if (isNaN(Number(sellingPrice))) {
                sellingPriceError = 'Selling Price must be a valid number.';
                errors.push(sellingPriceError);
            }
        }

        if (!body.rental_available) {
            rentalError = 'Rental Available is required.';
            errors.push(rentalError);
        }

        if (!files || files.length === 0) {
            imageError = 'At least one Product Image is required.';
            errors.push(imageError);
        }

        if (errors.length > 0) {
            return res.render('create_product', {
                pageTitle: 'Create Product',
                categories,
                brands,
                units,
                old: body,
                errors,
                productNameError,
                shortNameError,
                categoryError,
                brandError,
                imageError,
                saleError,
                sellingPriceError,
                rentalError,
                generalError
            });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const productCode = await generateProductCode();
            const createdBy = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
            const createdAt = new Date();

            const [insertResult] = await conn.query(
                `INSERT INTO product_master (
                    product_code,
                    product_name,
                    short_name,
                    category_id,
                    brand_id,
                    description,
                    sale_available,
                    purchase_price,
                    selling_price,
                    discount_allowed,
                    discount_percent,
                    sale_unit,
                    rental_available,
                    power_rating,
                    voltage,
                    rpm,
                    chuck_disc_size,
                    weight,
                    battery_capacity,
                    warranty_period,
                    warranty_applicable,
                    warranty_months,
                    status,
                    created_by,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    productCode,
                    productName,
                    shortName,
                    categoryId,
                    brandId,
                    description || null,
                    saleAvailable,
                    purchasePrice !== '' ? parseFloat(purchasePrice) : null,
                    sellingPrice !== '' ? parseFloat(sellingPrice) : null,
                    discountAllowed,
                    discountPercent !== '' ? parseFloat(discountPercent) : null,
                    saleUnit !== '' ? saleUnit : null,
                    rentalAvailable,
                    powerRating || null,
                    voltage || null,
                    rpm || null,
                    chuckDiscSize || null,
                    weight || null,
                    batteryCapacity || null,
                    warrantyPeriod || null,
                    warrantyApplicable,
                    warrantyMonths !== '' ? parseInt(warrantyMonths, 10) : null,
                    status,
                    createdBy,
                    createdAt
                ]
            );

            const productId = insertResult.insertId;

            // Rental Rates
            if (rentalAvailable === 1) {
                const periods = ['hourly', 'daily', 'weekly', 'monthly'];
                for (const period of periods) {
                    const available = (body.rental_available_period && body.rental_available_period[period]) ? 1 : 0;
                    const rentalUnitId = (body.rental_unit_id && body.rental_unit_id[period]) ? parseInt(body.rental_unit_id[period], 10) : null;
                    const securityDeposit = (body.security_deposit && body.security_deposit[period]) ? body.security_deposit[period].trim() : '';
                    const rentalRate = (body.rental_rate && body.rental_rate[period]) ? body.rental_rate[period].trim() : '';

                    await conn.query(
                        `INSERT INTO product_rental_rates (
                            product_id,
                            rental_period,
                            available,
                            rental_unit_id,
                            security_deposit,
                            rental_rate
                        ) VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            productId,
                            period,
                            available,
                            rentalUnitId,
                            securityDeposit !== '' ? parseFloat(securityDeposit) : null,
                            rentalRate !== '' ? parseFloat(rentalRate) : null
                        ]
                    );
                }
            }

            // Product Images
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const imagePath = 'uploads/products/' + file.filename;
                const isPrimary = (i === 0) ? 1 : 0;

                await conn.query(
                    `INSERT INTO product_images (
                        product_id,
                        image_name,
                        image_path,
                        is_primary
                    ) VALUES (?, ?, ?, ?)`,
                    [
                        productId,
                        file.originalname,
                        imagePath,
                        isPrimary
                    ]
                );
            }

            await conn.commit();
            conn.release();

            return res.redirect(`/manage_product.php?success=${encodeURIComponent(`Product ${productCode} created successfully.`)}`);
        } catch (e) {
            await conn.rollback();
            conn.release();
            console.error('createProduct transaction error:', e);

            return res.render('create_product', {
                pageTitle: 'Create Product',
                categories,
                brands,
                units,
                old: body,
                errors: [e.message],
                productNameError,
                shortNameError,
                categoryError,
                brandError,
                imageError,
                saleError,
                sellingPriceError,
                rentalError,
                generalError: 'Unable to create product. ' + e.message
            });
        }
    } catch (err) {
        console.error('createProduct outer error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Show edit product form
exports.editProductForm = async (req, res) => {
    try {
        const id = parseInt(req.params.id || req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect('/products');
        }

        const [pRows] = await pool.query('SELECT * FROM product_master WHERE id = ?', [id]);
        if (!pRows.length) {
            return res.redirect('/products');
        }
        const product = pRows[0];

        const [categories] = await pool.query('SELECT id, category_code, category_name FROM category_master WHERE status = 1 ORDER BY category_name');
        const [brands] = await pool.query('SELECT id, brand_code, brand_name FROM brand_master WHERE status = 1 ORDER BY brand_name');
        const [units] = await pool.query('SELECT id, unit_code, unit_name FROM unit_master WHERE status = 1 ORDER BY unit_name');
        const [images] = await pool.query('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, id ASC', [id]);

        const [rates] = await pool.query('SELECT * FROM product_rental_rates WHERE product_id = ?', [id]);
        const rentalRates = {};
        rates.forEach(r => {
            rentalRates[r.rental_period] = r;
        });

        res.render('edit_product', {
            pageTitle: 'Edit Product',
            id,
            product,
            categories,
            brands,
            units,
            images,
            rentalRates,
            errors: [],
            generalError: ''
        });
    } catch (err) {
        console.error('editProductForm error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// Process edit product
exports.editProduct = async (req, res) => {
    try {
        const id = parseInt(req.params.id || req.query.id || req.body.id || 0, 10);
        if (id <= 0) {
            return res.redirect('/products');
        }

        const [pRows] = await pool.query('SELECT * FROM product_master WHERE id = ?', [id]);
        if (!pRows.length) {
            return res.redirect('/products');
        }

        const [categories] = await pool.query('SELECT id, category_code, category_name FROM category_master WHERE status = 1 ORDER BY category_name');
        const [brands] = await pool.query('SELECT id, brand_code, brand_name FROM brand_master WHERE status = 1 ORDER BY brand_name');
        const [units] = await pool.query('SELECT id, unit_code, unit_name FROM unit_master WHERE status = 1 ORDER BY unit_name');

        const body = req.body || {};
        const files = req.files || [];

        const status = body.status !== undefined ? 1 : 0;
        const productName = (body.product_name || '').trim();
        const shortName = (body.short_name || '').trim();
        const categoryId = parseInt(body.category_id || 0, 10);
        const brandId = parseInt(body.brand_id || 0, 10);
        const description = (body.description || '').trim();
        const saleAvailable = (body.sale_available || '') === 'yes' ? 1 : 0;
        const purchasePrice = (body.purchase_price || '').trim();
        const sellingPrice = (body.selling_price || '').trim();
        const discountAllowed = (body.discount_allowed || 'no') === 'yes' ? 1 : 0;
        const discountPercent = (body.discount_percent || '').trim();
        const saleUnit = (body.sale_unit || '').trim();
        const rentalAvailable = (body.rental_available || '') === 'yes' ? 1 : 0;
        const powerRating = (body.power_rating || '').trim();
        const voltage = (body.voltage || '').trim();
        const rpm = (body.rpm || '').trim();
        const chuckDiscSize = (body.chuck_disc_size || '').trim();
        const weight = (body.weight || '').trim();
        const batteryCapacity = (body.battery_capacity || '').trim();
        const warrantyPeriod = (body.warranty_period || '').trim();
        const warrantyApplicable = (body.warranty_applicable || 'no') === 'yes' ? 1 : 0;
        const warrantyMonths = (body.warranty_months || '').trim();

        const errors = [];
        if (productName === '') {
            errors.push('Product Name is required.');
        } else if (productName.length < 2) {
            errors.push('Product Name must be at least 2 characters.');
        } else if (productName.length > 200) {
            errors.push('Product Name cannot exceed 200 characters.');
        }

        if (shortName === '') {
            errors.push('Short Name is required.');
        } else if (shortName.length < 2) {
            errors.push('Short Name must be at least 2 characters.');
        } else if (shortName.length > 100) {
            errors.push('Short Name cannot exceed 100 characters.');
        }

        if (categoryId <= 0) errors.push('Category is required.');
        if (brandId <= 0) errors.push('Brand is required.');

        if (saleAvailable === 1 && sellingPrice === '') {
            errors.push('Selling Price is required when Sale Available is Yes.');
        }

        const [images] = await pool.query('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, id ASC', [id]);
        const [rates] = await pool.query('SELECT * FROM product_rental_rates WHERE product_id = ?', [id]);
        const rentalRates = {};
        rates.forEach(r => {
            rentalRates[r.rental_period] = r;
        });

        if (errors.length > 0) {
            return res.render('edit_product', {
                pageTitle: 'Edit Product',
                id,
                product: { ...pRows[0], ...body, status },
                categories,
                brands,
                units,
                images,
                rentalRates,
                errors,
                generalError: errors.join(' ')
            });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const updatedBy = req.session.user_id ? parseInt(req.session.user_id, 10) : 1;
            const updatedAt = new Date();

            await conn.query(
                `UPDATE product_master SET
                    product_name = ?,
                    short_name = ?,
                    category_id = ?,
                    brand_id = ?,
                    description = ?,
                    sale_available = ?,
                    purchase_price = ?,
                    selling_price = ?,
                    discount_allowed = ?,
                    discount_percent = ?,
                    sale_unit = ?,
                    rental_available = ?,
                    power_rating = ?,
                    voltage = ?,
                    rpm = ?,
                    chuck_disc_size = ?,
                    weight = ?,
                    battery_capacity = ?,
                    warranty_period = ?,
                    warranty_applicable = ?,
                    warranty_months = ?,
                    status = ?,
                    updated_by = ?,
                    updated_at = ?
                WHERE id = ?`,
                [
                    productName,
                    shortName,
                    categoryId,
                    brandId,
                    description || null,
                    saleAvailable,
                    purchasePrice !== '' ? parseFloat(purchasePrice) : null,
                    sellingPrice !== '' ? parseFloat(sellingPrice) : null,
                    discountAllowed,
                    discountPercent !== '' ? parseFloat(discountPercent) : null,
                    saleUnit !== '' ? saleUnit : null,
                    rentalAvailable,
                    powerRating || null,
                    voltage || null,
                    rpm || null,
                    chuckDiscSize || null,
                    weight || null,
                    batteryCapacity || null,
                    warrantyPeriod || null,
                    warrantyApplicable,
                    warrantyMonths !== '' ? parseInt(warrantyMonths, 10) : null,
                    status,
                    updatedBy,
                    updatedAt,
                    id
                ]
            );

            // Rental Rates
            const periods = ['hourly', 'daily', 'weekly', 'monthly'];
            if (rentalAvailable === 1) {
                for (const period of periods) {
                    const available = (body.rental_available_period && body.rental_available_period[period]) ? 1 : 0;
                    const rentalUnitId = (body.rental_unit_id && body.rental_unit_id[period]) ? parseInt(body.rental_unit_id[period], 10) : null;
                    const securityDeposit = (body.security_deposit && body.security_deposit[period]) ? body.security_deposit[period].trim() : '';
                    const rentalRate = (body.rental_rate && body.rental_rate[period]) ? body.rental_rate[period].trim() : '';

                    await conn.query(
                        `INSERT INTO product_rental_rates (
                            product_id,
                            rental_period,
                            available,
                            rental_unit_id,
                            security_deposit,
                            rental_rate
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            available = VALUES(available),
                            rental_unit_id = VALUES(rental_unit_id),
                            security_deposit = VALUES(security_deposit),
                            rental_rate = VALUES(rental_rate)`,
                        [
                            id,
                            period,
                            available,
                            rentalUnitId,
                            securityDeposit !== '' ? parseFloat(securityDeposit) : null,
                            rentalRate !== '' ? parseFloat(rentalRate) : null
                        ]
                    );
                }
            } else {
                await conn.query('DELETE FROM product_rental_rates WHERE product_id = ?', [id]);
            }

            // New Images
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const imagePath = 'uploads/products/' + file.filename;
                    await conn.query(
                        `INSERT INTO product_images (
                            product_id,
                            image_name,
                            image_path,
                            is_primary
                        ) VALUES (?, ?, ?, 0)`,
                        [
                            id,
                            file.originalname,
                            imagePath
                        ]
                    );
                }
            }

            await conn.commit();
            conn.release();

            return res.redirect(`/manage_product.php?success=${encodeURIComponent('Product updated successfully.')}`);
        } catch (e) {
            await conn.rollback();
            conn.release();
            console.error('editProduct transaction error:', e);

            return res.render('edit_product', {
                pageTitle: 'Edit Product',
                id,
                product: { ...pRows[0], ...body, status },
                categories,
                brands,
                units,
                images,
                rentalRates,
                errors: [e.message],
                generalError: 'Unable to update product. ' + e.message
            });
        }
    } catch (err) {
        console.error('editProduct outer error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};

// View single product
exports.viewProduct = async (req, res) => {
    try {
        const id = parseInt(req.params.id || req.query.id || 0, 10);
        if (id <= 0) {
            return res.redirect('/products');
        }

        const [pRows] = await pool.query(
            `SELECT
                p.*,
                c.category_code,
                c.category_name,
                b.brand_code,
                b.brand_name,
                creator.user_name AS created_by_name,
                updater.user_name AS updated_by_name
            FROM product_master p
            LEFT JOIN category_master c ON c.id = p.category_id
            LEFT JOIN brand_master b ON b.id = p.brand_id
            LEFT JOIN user_master creator ON creator.id = p.created_by
            LEFT JOIN user_master updater ON updater.id = p.updated_by
            WHERE p.id = ?`,
            [id]
        );

        if (!pRows.length) {
            return res.redirect('/products');
        }

        const product = pRows[0];
        const [images] = await pool.query('SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, id ASC', [id]);

        const [rentalRates] = await pool.query(
            `SELECT
                r.*,
                u.unit_code,
                u.unit_name
            FROM product_rental_rates r
            LEFT JOIN unit_master u ON u.id = r.rental_unit_id
            WHERE r.product_id = ?
            ORDER BY FIELD(r.rental_period, 'hourly', 'daily', 'weekly', 'monthly')`,
            [id]
        );

        res.render('view_product', {
            pageTitle: 'View Product',
            product,
            images,
            rentalRates
        });
    } catch (err) {
        console.error('viewProduct error:', err);
        res.status(500).send('Internal Server Error: ' + err.message);
    }
};
