const db = require('../config/db');

async function generateBrandCode(conn) {
    const [rows] = await conn.query("SELECT brand_code FROM brand_master ORDER BY id DESC LIMIT 1");
    const lastCode = rows && rows.length > 0 ? rows[0].brand_code : null;

    if (!lastCode) {
        return 'BRA-001';
    }

    const number = parseInt(lastCode.replace('BRA-', ''), 10) + 1;
    return 'BRA-' + String(number).padStart(3, '0');
}

const brandController = {
    // GET /manage_brand.php or /manage_brand
    index: async (req, res) => {
        try {
            const search = (req.query.search || '').trim();
            const statusFilter = req.query.status || '';

            let sql = `
                SELECT bm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                FROM brand_master bm
                LEFT JOIN user_master creator ON creator.id = bm.created_by
                LEFT JOIN user_master updater ON updater.id = bm.updated_by
                WHERE 1=1
            `;
            const params = {};

            if (search !== '') {
                sql += " AND (bm.brand_code LIKE :search OR bm.brand_name LIKE :search)";
                params.search = `%${search}%`;
            }

            if (statusFilter !== '' && ['0', '1'].includes(statusFilter)) {
                sql += " AND bm.status = :status";
                params.status = parseInt(statusFilter, 10);
            }

            sql += " ORDER BY bm.id DESC";

            const [brands] = await db.query(sql, params);

            res.render('manage_brand', {
                pageTitle: 'Brand Master',
                brands,
                search,
                statusFilter,
                formData: {},
                brandNameError: '',
                descriptionError: '',
                duplicateNameError: '',
                validationAction: '',
                validationId: 0
            });
        } catch (err) {
            console.error('[BrandController.index] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    },

    // POST /manage_brand.php or /manage_brand
    save: async (req, res) => {
        try {
            const action = req.body.form_action || '';
            const search = (req.query.search || '').trim();
            const statusFilter = req.query.status || '';

            let brandNameError = '';
            let descriptionError = '';
            let duplicateNameError = '';
            const errors = [];

            if (action === 'create') {
                const brandName = (req.body.brand_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (brandName === '') {
                    brandNameError = 'Brand Name is required.';
                } else if (brandName.length < 2) {
                    brandNameError = 'Brand Name must be at least 2 characters.';
                } else if (brandName.length > 100) {
                    brandNameError = 'Brand Name cannot exceed 100 characters.';
                }

                if (description.length > 200) {
                    descriptionError = 'Description cannot exceed 200 characters.';
                }

                if (!brandNameError) {
                    const [dupRows] = await db.query(
                        "SELECT COUNT(*) AS cnt FROM brand_master WHERE LOWER(brand_name) = LOWER(:brand_name)",
                        { brand_name: brandName }
                    );
                    if (parseInt(dupRows[0].cnt, 10) > 0) {
                        duplicateNameError = 'Brand Name already exists.';
                    }
                }

                if (brandNameError) errors.push(brandNameError);
                if (descriptionError) errors.push(descriptionError);
                if (duplicateNameError) errors.push(duplicateNameError);

                if (errors.length === 0) {
                    const brandCode = await generateBrandCode(db);
                    const createdBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

                    await db.query(`
                        INSERT INTO brand_master (brand_code, brand_name, description, status, created_by, created_at)
                        VALUES (:brand_code, :brand_name, :description, :status, :created_by, NOW())
                    `, {
                        brand_code: brandCode,
                        brand_name: brandName,
                        description: description || null,
                        status,
                        created_by: createdBy
                    });

                    return res.redirect(`/manage_brand.php?success=${encodeURIComponent(`Brand ${brandCode} created successfully.`)}`);
                }

                const [brands] = await db.query(`
                    SELECT bm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM brand_master bm
                    LEFT JOIN user_master creator ON creator.id = bm.created_by
                    LEFT JOIN user_master updater ON updater.id = bm.updated_by
                    ORDER BY bm.id DESC
                `);

                return res.render('manage_brand', {
                    pageTitle: 'Brand Master',
                    brands,
                    search,
                    statusFilter,
                    formData: { brand_name: brandName, description, status },
                    brandNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'create',
                    validationId: 0
                });
            }

            if (action === 'edit') {
                const id = parseInt(req.body.id || 0, 10);
                const brandName = (req.body.brand_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (id <= 0) {
                    errors.push('Invalid brand record.');
                } else {
                    if (brandName === '') {
                        brandNameError = 'Brand Name is required.';
                    } else if (brandName.length < 2) {
                        brandNameError = 'Brand Name must be at least 2 characters.';
                    } else if (brandName.length > 100) {
                        brandNameError = 'Brand Name cannot exceed 100 characters.';
                    }

                    if (description.length > 200) {
                        descriptionError = 'Description cannot exceed 200 characters.';
                    }

                    if (!brandNameError) {
                        const [dupRows] = await db.query(
                            "SELECT COUNT(*) AS cnt FROM brand_master WHERE LOWER(brand_name) = LOWER(:brand_name) AND id != :id",
                            { brand_name: brandName, id }
                        );
                        if (parseInt(dupRows[0].cnt, 10) > 0) {
                            duplicateNameError = 'Brand Name already exists.';
                        }
                    }

                    if (brandNameError) errors.push(brandNameError);
                    if (descriptionError) errors.push(descriptionError);
                    if (duplicateNameError) errors.push(duplicateNameError);

                    if (errors.length === 0) {
                        const updatedBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

                        await db.query(`
                            UPDATE brand_master 
                            SET brand_name = :brand_name, description = :description, status = :status, updated_by = :updated_by, updated_at = NOW()
                            WHERE id = :id
                        `, {
                            brand_name: brandName,
                            description: description || null,
                            status,
                            updated_by: updatedBy,
                            id
                        });

                        return res.redirect(`/manage_brand.php?success=${encodeURIComponent('Brand updated successfully.')}`);
                    }
                }

                const [brands] = await db.query(`
                    SELECT bm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM brand_master bm
                    LEFT JOIN user_master creator ON creator.id = bm.created_by
                    LEFT JOIN user_master updater ON updater.id = bm.updated_by
                    ORDER BY bm.id DESC
                `);

                return res.render('manage_brand', {
                    pageTitle: 'Brand Master',
                    brands,
                    search,
                    statusFilter,
                    formData: { brand_name: brandName, description, status },
                    brandNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'edit',
                    validationId: id
                });
            }

            res.redirect('/manage_brand.php');
        } catch (err) {
            console.error('[BrandController.save] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    },

    // GET /view_brand.php or /view_brand
    view: async (req, res) => {
        try {
            const id = parseInt(req.query.id || 0, 10);
            const [rows] = await db.query(`
                SELECT 
                    bm.*,
                    creator.user_name AS created_by_name,
                    updater.user_name AS updated_by_name
                FROM brand_master bm
                LEFT JOIN user_master creator ON creator.id = bm.created_by
                LEFT JOIN user_master updater ON updater.id = bm.updated_by
                WHERE bm.id = :id
                LIMIT 1
            `, { id });

            const brand = rows && rows.length > 0 ? rows[0] : null;

            res.render('view_brand', {
                pageTitle: 'View Brand',
                brand
            });
        } catch (err) {
            console.error('[BrandController.view] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    }
};

module.exports = brandController;
