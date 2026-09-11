const db = require('../config/db');
const { getNextId } = require('../utils/idHelper');

async function generateProductTypeCode(conn) {
    const [rows] = await conn.query("SELECT product_type_code FROM product_type_master ORDER BY id DESC LIMIT 1");
    const lastCode = rows && rows.length > 0 ? rows[0].product_type_code : null;

    if (!lastCode) {
        return 'PROTY-001';
    }

    const number = parseInt(lastCode.replace('PROTY-', ''), 10) + 1;
    return 'PROTY-' + String(number).padStart(3, '0');
}

const productTypeController = {
    // GET /manage_producttype.php or /manage_producttype
    index: async (req, res) => {
        try {
            const search = (req.query.search || '').trim();
            const statusFilter = req.query.status || '';

            const page = Math.max(1, parseInt(req.query.page || 1, 10));
            const limit = 10;
            const offset = (page - 1) * limit;

            let whereSql = " WHERE 1=1";
            const params = [];

            if (search !== '') {
                whereSql += " AND (ptm.product_type_code LIKE ? OR ptm.product_type_name LIKE ?)";
                const sp = `%${search}%`;
                params.push(sp, sp);
            }

            if (statusFilter !== '' && ['0', '1'].includes(statusFilter)) {
                whereSql += " AND ptm.status = ?";
                params.push(parseInt(statusFilter, 10));
            }

            const [countRows] = await db.query(
                `SELECT COUNT(*) AS total FROM product_type_master ptm ${whereSql}`,
                params
            );
            const totalRecords = countRows[0].total;
            const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

            const dataSql = `
                SELECT ptm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                FROM product_type_master ptm
                LEFT JOIN user_master creator ON creator.id = ptm.created_by
                LEFT JOIN user_master updater ON updater.id = ptm.updated_by
                ${whereSql}
                ORDER BY ptm.id DESC
                LIMIT ? OFFSET ?
            `;

            const [productTypes] = await db.query(dataSql, [...params, limit, offset]);

            res.render('manage_producttype', {
                pageTitle: 'Product Type Master',
                productTypes,
                search,
                statusFilter,
                formData: {},
                productTypeNameError: '',
                descriptionError: '',
                duplicateNameError: '',
                validationAction: '',
                validationId: 0,
                page,
                limit,
                offset,
                totalRecords,
                totalPages,
                queryParams: req.query
            });
        } catch (err) {
            console.error('[ProductTypeController.index] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    },

    // POST /manage_producttype.php or /manage_producttype
    save: async (req, res) => {
        try {
            const action = req.body.form_action || '';
            const search = (req.query.search || '').trim();
            const statusFilter = req.query.status || '';

            let productTypeNameError = '';
            let descriptionError = '';
            let duplicateNameError = '';
            const errors = [];

            if (action === 'create') {
                const productTypeName = (req.body.product_type_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (productTypeName === '') {
                    productTypeNameError = 'Product Type Name is required.';
                } else if (productTypeName.length < 2) {
                    productTypeNameError = 'Product Type Name must be at least 2 characters.';
                } else if (productTypeName.length > 100) {
                    productTypeNameError = 'Product Type Name cannot exceed 100 characters.';
                }

                if (description.length > 200) {
                    descriptionError = 'Description cannot exceed 200 characters.';
                }

                if (!productTypeNameError) {
                    const [dupRows] = await db.query(
                        "SELECT COUNT(*) AS cnt FROM product_type_master WHERE LOWER(product_type_name) = LOWER(:product_type_name)",
                        { product_type_name: productTypeName }
                    );
                    if (parseInt(dupRows[0].cnt, 10) > 0) {
                        duplicateNameError = 'Product Type Name already exists.';
                    }
                }

                if (productTypeNameError) errors.push(productTypeNameError);
                if (descriptionError) errors.push(descriptionError);
                if (duplicateNameError) errors.push(duplicateNameError);

                if (errors.length === 0) {
                    const typeCode = await generateProductTypeCode(db);
                    const createdBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;
                    const nextId = await getNextId(db, 'product_type_master');

                    await db.query(`
                        INSERT INTO product_type_master (id, product_type_code, product_type_name, description, status, created_by, created_at)
                        VALUES (:id, :product_type_code, :product_type_name, :description, :status, :created_by, NOW())
                    `, {
                        id: nextId,
                        product_type_code: typeCode,
                        product_type_name: productTypeName,
                        description: description || null,
                        status,
                        created_by: createdBy
                    });

                    return res.redirect(`/manage_producttype.php?success=${encodeURIComponent(`Product Type ${typeCode} created successfully.`)}`);
                }

                const [productTypes] = await db.query(`
                    SELECT ptm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM product_type_master ptm
                    LEFT JOIN user_master creator ON creator.id = ptm.created_by
                    LEFT JOIN user_master updater ON updater.id = ptm.updated_by
                    ORDER BY ptm.id DESC
                `);

                return res.render('manage_producttype', {
                    pageTitle: 'Product Type Master',
                    productTypes,
                    search,
                    statusFilter,
                    formData: { product_type_name: productTypeName, description, status },
                    productTypeNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'create',
                    validationId: 0
                });
            }

            if (action === 'edit') {
                const id = parseInt(req.body.id || 0, 10);
                const productTypeName = (req.body.product_type_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (id <= 0) {
                    errors.push('Invalid product type record.');
                } else {
                    if (productTypeName === '') {
                        productTypeNameError = 'Product Type Name is required.';
                    } else if (productTypeName.length < 2) {
                        productTypeNameError = 'Product Type Name must be at least 2 characters.';
                    } else if (productTypeName.length > 100) {
                        productTypeNameError = 'Product Type Name cannot exceed 100 characters.';
                    }

                    if (description.length > 200) {
                        descriptionError = 'Description cannot exceed 200 characters.';
                    }

                    if (!productTypeNameError) {
                        const [dupRows] = await db.query(
                            "SELECT COUNT(*) AS cnt FROM product_type_master WHERE LOWER(product_type_name) = LOWER(:product_type_name) AND id != :id",
                            { product_type_name: productTypeName, id }
                        );
                        if (parseInt(dupRows[0].cnt, 10) > 0) {
                            duplicateNameError = 'Product Type Name already exists.';
                        }
                    }

                    if (productTypeNameError) errors.push(productTypeNameError);
                    if (descriptionError) errors.push(descriptionError);
                    if (duplicateNameError) errors.push(duplicateNameError);

                    if (errors.length === 0) {
                        const updatedBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

                        await db.query(`
                            UPDATE product_type_master 
                            SET product_type_name = :product_type_name, description = :description, status = :status, updated_by = :updated_by, updated_at = NOW()
                            WHERE id = :id
                        `, {
                            product_type_name: productTypeName,
                            description: description || null,
                            status,
                            updated_by: updatedBy,
                            id
                        });

                        return res.redirect(`/manage_producttype.php?success=${encodeURIComponent('Product Type updated successfully.')}`);
                    }
                }

                const [productTypes] = await db.query(`
                    SELECT ptm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM product_type_master ptm
                    LEFT JOIN user_master creator ON creator.id = ptm.created_by
                    LEFT JOIN user_master updater ON updater.id = ptm.updated_by
                    ORDER BY ptm.id DESC
                `);

                return res.render('manage_producttype', {
                    pageTitle: 'Product Type Master',
                    productTypes,
                    search,
                    statusFilter,
                    formData: { product_type_name: productTypeName, description, status },
                    productTypeNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'edit',
                    validationId: id
                });
            }

            res.redirect('/product-types');
        } catch (err) {
            console.error('[ProductTypeController.save] Error:', err);
            res.status(500).send('Internal Server Error: ' + err.message);
        }
    },

    // GET /view_producttype.php, /view_product_type.php, or /view_producttype
    view: async (req, res) => {
        try {
            const id = parseInt(req.params.id || req.query.id || 0, 10);
            const [rows] = await db.query(`
                SELECT 
                    ptm.*,
                    creator.user_name AS created_by_name,
                    updater.user_name AS updated_by_name
                FROM product_type_master ptm
                LEFT JOIN user_master creator ON creator.id = ptm.created_by
                LEFT JOIN user_master updater ON updater.id = ptm.updated_by
                WHERE ptm.id = :id
                LIMIT 1
            `, { id });

            const productType = rows && rows.length > 0 ? rows[0] : null;

            res.render('view_producttype', {
                pageTitle: 'View Product Type',
                productType
            });
        } catch (err) {
            console.error('[ProductTypeController.view] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    }
};

module.exports = productTypeController;
