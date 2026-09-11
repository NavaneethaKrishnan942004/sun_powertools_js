const db = require('../config/db');
const { getNextId } = require('../utils/idHelper');

async function generateCategoryCode(conn) {
    const [rows] = await conn.query("SELECT category_code FROM category_master ORDER BY id DESC LIMIT 1");
    const lastCode = rows && rows.length > 0 ? rows[0].category_code : null;

    if (!lastCode) {
        return 'CAT-001';
    }

    const number = parseInt(lastCode.replace('CAT-', ''), 10) + 1;
    return 'CAT-' + String(number).padStart(3, '0');
}

const categoryController = {
    // GET /manage_category.php or /manage_category
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
                whereSql += " AND (cm.category_code LIKE ? OR cm.category_name LIKE ?)";
                const sp = `%${search}%`;
                params.push(sp, sp);
            }

            if (statusFilter !== '' && ['0', '1'].includes(statusFilter)) {
                whereSql += " AND cm.status = ?";
                params.push(parseInt(statusFilter, 10));
            }

            const [countRows] = await db.query(
                `SELECT COUNT(*) AS total FROM category_master cm ${whereSql}`,
                params
            );
            const totalRecords = countRows[0].total;
            const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

            const dataSql = `
                SELECT cm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                FROM category_master cm
                LEFT JOIN user_master creator ON creator.id = cm.created_by
                LEFT JOIN user_master updater ON updater.id = cm.updated_by
                ${whereSql}
                ORDER BY cm.id DESC
                LIMIT ? OFFSET ?
            `;

            const [categories] = await db.query(dataSql, [...params, limit, offset]);

            res.render('manage_category', {
                pageTitle: 'Category Master',
                categories,
                search,
                statusFilter,
                formData: {},
                categoryNameError: '',
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
            console.error('[CategoryController.index] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    },

    // POST /manage_category.php or /manage_category
    save: async (req, res) => {
        try {
            const action = req.body.form_action || '';
            const search = (req.query.search || '').trim();
            const statusFilter = req.query.status || '';

            let categoryNameError = '';
            let descriptionError = '';
            let duplicateNameError = '';
            const errors = [];

            if (action === 'create') {
                const categoryName = (req.body.category_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (categoryName === '') {
                    categoryNameError = 'Category Name is required.';
                } else if (categoryName.length < 2) {
                    categoryNameError = 'Category Name must be at least 2 characters.';
                } else if (categoryName.length > 100) {
                    categoryNameError = 'Category Name cannot exceed 100 characters.';
                }

                if (description.length > 200) {
                    descriptionError = 'Description cannot exceed 200 characters.';
                }

                if (!categoryNameError) {
                    const [dupRows] = await db.query(
                        "SELECT COUNT(*) AS cnt FROM category_master WHERE LOWER(category_name) = LOWER(:category_name)",
                        { category_name: categoryName }
                    );
                    if (parseInt(dupRows[0].cnt, 10) > 0) {
                        duplicateNameError = 'Category Name already exists.';
                    }
                }

                if (categoryNameError) errors.push(categoryNameError);
                if (descriptionError) errors.push(descriptionError);
                if (duplicateNameError) errors.push(duplicateNameError);

                if (errors.length === 0) {
                    const categoryCode = await generateCategoryCode(db);
                    const createdBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;
                    const nextId = await getNextId(db, 'category_master');

                    await db.query(`
                        INSERT INTO category_master (id, category_code, category_name, description, status, created_by, created_at)
                        VALUES (:id, :category_code, :category_name, :description, :status, :created_by, NOW())
                    `, {
                        id: nextId,
                        category_code: categoryCode,
                        category_name: categoryName,
                        description: description || null,
                        status,
                        created_by: createdBy
                    });

                    return res.redirect(`/manage_category.php?success=${encodeURIComponent(`Category ${categoryCode} created successfully.`)}`);
                }

                // If errors, re-render with modal opened
                const [categories] = await db.query(`
                    SELECT cm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM category_master cm
                    LEFT JOIN user_master creator ON creator.id = cm.created_by
                    LEFT JOIN user_master updater ON updater.id = cm.updated_by
                    ORDER BY cm.id DESC
                `);

                return res.render('manage_category', {
                    pageTitle: 'Category Master',
                    categories,
                    search,
                    statusFilter,
                    formData: { category_name: categoryName, description, status },
                    categoryNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'create',
                    validationId: 0
                });
            }

            if (action === 'edit') {
                const id = parseInt(req.body.id || 0, 10);
                const categoryName = (req.body.category_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (id <= 0) {
                    errors.push('Invalid category record.');
                } else {
                    if (categoryName === '') {
                        categoryNameError = 'Category Name is required.';
                    } else if (categoryName.length < 2) {
                        categoryNameError = 'Category Name must be at least 2 characters.';
                    } else if (categoryName.length > 100) {
                        categoryNameError = 'Category Name cannot exceed 100 characters.';
                    }

                    if (description.length > 200) {
                        descriptionError = 'Description cannot exceed 200 characters.';
                    }

                    if (!categoryNameError) {
                        const [dupRows] = await db.query(
                            "SELECT COUNT(*) AS cnt FROM category_master WHERE LOWER(category_name) = LOWER(:category_name) AND id != :id",
                            { category_name: categoryName, id }
                        );
                        if (parseInt(dupRows[0].cnt, 10) > 0) {
                            duplicateNameError = 'Category Name already exists.';
                        }
                    }

                    if (categoryNameError) errors.push(categoryNameError);
                    if (descriptionError) errors.push(descriptionError);
                    if (duplicateNameError) errors.push(duplicateNameError);

                    if (errors.length === 0) {
                        const updatedBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

                        await db.query(`
                            UPDATE category_master 
                            SET category_name = :category_name, description = :description, status = :status, updated_by = :updated_by, updated_at = NOW()
                            WHERE id = :id
                        `, {
                            category_name: categoryName,
                            description: description || null,
                            status,
                            updated_by: updatedBy,
                            id
                        });

                        return res.redirect(`/manage_category.php?success=${encodeURIComponent('Category updated successfully.')}`);
                    }
                }

                // If errors, re-render
                const [categories] = await db.query(`
                    SELECT cm.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM category_master cm
                    LEFT JOIN user_master creator ON creator.id = cm.created_by
                    LEFT JOIN user_master updater ON updater.id = cm.updated_by
                    ORDER BY cm.id DESC
                `);

                return res.render('manage_category', {
                    pageTitle: 'Category Master',
                    categories,
                    search,
                    statusFilter,
                    formData: { category_name: categoryName, description, status },
                    categoryNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'edit',
                    validationId: id
                });
            }

            res.redirect('/categories');
        } catch (err) {
            console.error('[CategoryController.save] Error:', err);
            res.status(500).send('Internal Server Error: ' + err.message);
        }
    },

    // GET /view_category.php or /view_category
    view: async (req, res) => {
        try {
            const id = parseInt(req.params.id || req.query.id || 0, 10);
            const [rows] = await db.query(`
                SELECT 
                    cm.*,
                    creator.user_name AS created_by_name,
                    updater.user_name AS updated_by_name
                FROM category_master cm
                LEFT JOIN user_master creator ON creator.id = cm.created_by
                LEFT JOIN user_master updater ON updater.id = cm.updated_by
                WHERE cm.id = :id
                LIMIT 1
            `, { id });

            const category = rows && rows.length > 0 ? rows[0] : null;

            res.render('view_category', {
                pageTitle: 'View Category',
                category
            });
        } catch (err) {
            console.error('[CategoryController.view] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    }
};

module.exports = categoryController;
