const db = require('../config/db');
const { getNextId } = require('../utils/idHelper');

async function generateUnitCode(conn) {
    const [rows] = await conn.query("SELECT unit_code FROM unit_master ORDER BY id DESC LIMIT 1");
    const lastCode = rows && rows.length > 0 ? rows[0].unit_code : null;

    if (!lastCode) {
        return 'UNIT-001';
    }

    const number = parseInt(lastCode.replace('UNIT-', ''), 10) + 1;
    return 'UNIT-' + String(number).padStart(3, '0');
}

const unitController = {
    // GET /manaage_unit.php, /manage_unit.php, or /manage_unit
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
                whereSql += " AND (um.unit_code LIKE ? OR um.unit_name LIKE ?)";
                const sp = `%${search}%`;
                params.push(sp, sp);
            }

            if (statusFilter !== '' && ['0', '1'].includes(statusFilter)) {
                whereSql += " AND um.status = ?";
                params.push(parseInt(statusFilter, 10));
            }

            const [countRows] = await db.query(
                `SELECT COUNT(*) AS total FROM unit_master um ${whereSql}`,
                params
            );
            const totalRecords = countRows[0].total;
            const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

            const dataSql = `
                SELECT um.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                FROM unit_master um
                LEFT JOIN user_master creator ON creator.id = um.created_by
                LEFT JOIN user_master updater ON updater.id = um.updated_by
                ${whereSql}
                ORDER BY um.id DESC
                LIMIT ? OFFSET ?
            `;

            const [units] = await db.query(dataSql, [...params, limit, offset]);

            res.render('manaage_unit', {
                pageTitle: 'Unit Master',
                units,
                search,
                statusFilter,
                formData: {},
                unitNameError: '',
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
            console.error('[UnitController.index] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    },

    // POST /manaage_unit.php, /manage_unit.php
    save: async (req, res) => {
        try {
            const action = req.body.form_action || '';
            const search = (req.query.search || '').trim();
            const statusFilter = req.query.status || '';

            let unitNameError = '';
            let descriptionError = '';
            let duplicateNameError = '';
            const errors = [];

            if (action === 'create') {
                const unitName = (req.body.unit_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (unitName === '') {
                    unitNameError = 'Unit Name is required.';
                } else if (unitName.length < 2) {
                    unitNameError = 'Unit Name must be at least 2 characters.';
                } else if (unitName.length > 100) {
                    unitNameError = 'Unit Name cannot exceed 100 characters.';
                }

                if (description.length > 200) {
                    descriptionError = 'Description cannot exceed 200 characters.';
                }

                if (!unitNameError) {
                    const [dupRows] = await db.query(
                        "SELECT COUNT(*) AS cnt FROM unit_master WHERE LOWER(unit_name) = LOWER(:unit_name)",
                        { unit_name: unitName }
                    );
                    if (parseInt(dupRows[0].cnt, 10) > 0) {
                        duplicateNameError = 'Unit Name already exists.';
                    }
                }

                if (unitNameError) errors.push(unitNameError);
                if (descriptionError) errors.push(descriptionError);
                if (duplicateNameError) errors.push(duplicateNameError);

                if (errors.length === 0) {
                    const unitCode = await generateUnitCode(db);
                    const createdBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;
                    const nextId = await getNextId(db, 'unit_master');

                    await db.query(`
                        INSERT INTO unit_master (id, unit_code, unit_name, description, status, created_by, created_at)
                        VALUES (:id, :unit_code, :unit_name, :description, :status, :created_by, NOW())
                    `, {
                        id: nextId,
                        unit_code: unitCode,
                        unit_name: unitName,
                        description: description || null,
                        status,
                        created_by: createdBy
                    });

                    return res.redirect(`/manaage_unit.php?success=${encodeURIComponent(`Unit ${unitCode} created successfully.`)}`);
                }

                const [units] = await db.query(`
                    SELECT um.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM unit_master um
                    LEFT JOIN user_master creator ON creator.id = um.created_by
                    LEFT JOIN user_master updater ON updater.id = um.updated_by
                    ORDER BY um.id DESC
                `);

                return res.render('manaage_unit', {
                    pageTitle: 'Unit Master',
                    units,
                    search,
                    statusFilter,
                    formData: { unit_name: unitName, description, status },
                    unitNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'create',
                    validationId: 0
                });
            }

            if (action === 'edit') {
                const id = parseInt(req.body.id || 0, 10);
                const unitName = (req.body.unit_name || '').trim();
                const description = (req.body.description || '').trim();
                const status = req.body.status ? 1 : 0;

                if (id <= 0) {
                    errors.push('Invalid unit record.');
                } else {
                    if (unitName === '') {
                        unitNameError = 'Unit Name is required.';
                    } else if (unitName.length < 2) {
                        unitNameError = 'Unit Name must be at least 2 characters.';
                    } else if (unitName.length > 100) {
                        unitNameError = 'Unit Name cannot exceed 100 characters.';
                    }

                    if (description.length > 200) {
                        descriptionError = 'Description cannot exceed 200 characters.';
                    }

                    if (!unitNameError) {
                        const [dupRows] = await db.query(
                            "SELECT COUNT(*) AS cnt FROM unit_master WHERE LOWER(unit_name) = LOWER(:unit_name) AND id != :id",
                            { unit_name: unitName, id }
                        );
                        if (parseInt(dupRows[0].cnt, 10) > 0) {
                            duplicateNameError = 'Unit Name already exists.';
                        }
                    }

                    if (unitNameError) errors.push(unitNameError);
                    if (descriptionError) errors.push(descriptionError);
                    if (duplicateNameError) errors.push(duplicateNameError);

                    if (errors.length === 0) {
                        const updatedBy = req.session?.user_id ? parseInt(req.session.user_id, 10) : 1;

                        await db.query(`
                            UPDATE unit_master 
                            SET unit_name = :unit_name, description = :description, status = :status, updated_by = :updated_by, updated_at = NOW()
                            WHERE id = :id
                        `, {
                            unit_name: unitName,
                            description: description || null,
                            status,
                            updated_by: updatedBy,
                            id
                        });

                        return res.redirect(`/manaage_unit.php?success=${encodeURIComponent('Unit updated successfully.')}`);
                    }
                }

                const [units] = await db.query(`
                    SELECT um.*, creator.user_name AS created_by_name, updater.user_name AS updated_by_name
                    FROM unit_master um
                    LEFT JOIN user_master creator ON creator.id = um.created_by
                    LEFT JOIN user_master updater ON updater.id = um.updated_by
                    ORDER BY um.id DESC
                `);

                return res.render('manaage_unit', {
                    pageTitle: 'Unit Master',
                    units,
                    search,
                    statusFilter,
                    formData: { unit_name: unitName, description, status },
                    unitNameError,
                    descriptionError,
                    duplicateNameError,
                    validationAction: 'edit',
                    validationId: id
                });
            }

            res.redirect('/units');
        } catch (err) {
            console.error('[UnitController.save] Error:', err);
            res.status(500).send('Internal Server Error: ' + err.message);
        }
    },

    // GET /view_unit.php or /view_unit
    view: async (req, res) => {
        try {
            const id = parseInt(req.params.id || req.query.id || 0, 10);
            const [rows] = await db.query(`
                SELECT 
                    um.*,
                    creator.user_name AS created_by_name,
                    updater.user_name AS updated_by_name
                FROM unit_master um
                LEFT JOIN user_master creator ON creator.id = um.created_by
                LEFT JOIN user_master updater ON updater.id = um.updated_by
                WHERE um.id = :id
                LIMIT 1
            `, { id });

            const unit = rows && rows.length > 0 ? rows[0] : null;

            res.render('view_unit', {
                pageTitle: 'View Unit',
                unit
            });
        } catch (err) {
            console.error('[UnitController.view] Error:', err);
            res.status(500).send('Internal Server Error');
        }
    }
};

module.exports = unitController;
