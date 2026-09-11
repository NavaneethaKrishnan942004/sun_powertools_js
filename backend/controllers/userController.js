const db = require('../config/db');
const bcrypt = require('bcryptjs');

const generateUserId = async () => {
    const [rows] = await db.query('SELECT user_id FROM user_master ORDER BY id DESC LIMIT 1');
    if (!rows || rows.length === 0 || !rows[0].user_id) {
        return 'US-001';
    }
    const last = rows[0].user_id;
    const num = parseInt(last.replace('US-', ''), 10) + 1;
    return 'US-' + String(num).padStart(3, '0');
};

const manageUser = async (req, res, next) => {
    try {
        const search = (req.query.search || '').trim();
        const statusFilter = req.query.status !== undefined ? String(req.query.status) : '';
        const roleFilter = (req.query.role || '').trim();

        const page = Math.max(1, parseInt(req.query.page || 1, 10));
        const limit = 10;
        const offset = (page - 1) * limit;

        let whereSql = ' WHERE 1=1';
        const params = [];

        if (search !== '') {
            whereSql += ' AND (user_id LIKE ? OR user_name LIKE ? OR user_email LIKE ? OR user_phone LIKE ?)';
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
        }

        if (statusFilter === '0' || statusFilter === '1') {
            whereSql += ' AND status = ?';
            params.push(parseInt(statusFilter, 10));
        }

        if (roleFilter === 'user' || roleFilter === 'admin') {
            whereSql += ' AND role = ?';
            params.push(roleFilter);
        }

        const [countRows] = await db.query(
            `SELECT COUNT(*) AS total FROM user_master ${whereSql}`,
            params
        );
        const totalRecords = countRows[0].total;
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));

        const dataSql = `SELECT * FROM user_master ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
        const [users] = await db.query(dataSql, [...params, limit, offset]);

        res.render('manage_user', {
            pageTitle: 'User Master',
            users,
            search,
            statusFilter,
            roleFilter,
            success: req.query.success || '',
            error: req.query.error || '',
            page,
            limit,
            offset,
            totalRecords,
            totalPages,
            queryParams: req.query
        });
    } catch (err) {
        next(err);
    }
};

const createForm = (req, res) => {
    res.render('create_user', {
        pageTitle: 'Create User',
        errors: {},
        v: {
            user_name: '',
            user_email: '',
            user_phone: '',
            role: 'user',
            status: 1
        }
    });
};

const createProcess = async (req, res, next) => {
    try {
        const userName = (req.body.user_name || '').trim();
        const userEmail = (req.body.user_email || '').trim();
        const userPhone = (req.body.user_phone || '').trim();
        const password = req.body.password || '';
        const confirmPassword = req.body.confirm_password || '';
        const role = req.body.role || 'user';
        const status = req.body.status ? 1 : 0;

        const v = {
            user_name: userName,
            user_email: userEmail,
            user_phone: userPhone,
            role,
            status
        };

        const errors = {
            user_name: '',
            user_email: '',
            user_phone: '',
            password: '',
            confirm_password: '',
            role: ''
        };

        if (!userName) {
            errors.user_name = 'User Name is required.';
        } else if (userName.length < 2) {
            errors.user_name = 'User Name must be at least 2 characters.';
        } else if (userName.length > 100) {
            errors.user_name = 'User Name cannot exceed 100 characters.';
        }

        if (!userEmail) {
            errors.user_email = 'User Mail is required.';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
            errors.user_email = 'Please enter a valid email address.';
        } else if (userEmail.length > 150) {
            errors.user_email = 'User Mail cannot exceed 150 characters.';
        }

        if (!userPhone) {
            errors.user_phone = 'User Phone No is required.';
        } else if (!/^[0-9+\-\s]{7,20}$/.test(userPhone)) {
            errors.user_phone = 'Please enter a valid phone number.';
        }

        if (!password) {
            errors.password = 'Password is required.';
        } else if (password.length < 6) {
            errors.password = 'Password must be at least 6 characters.';
        }

        if (!confirmPassword) {
            errors.confirm_password = 'Confirm Password is required.';
        } else if (password !== confirmPassword) {
            errors.confirm_password = 'Password and Confirm Password do not match.';
        }

        if (!['user', 'admin'].includes(role)) {
            errors.role = 'Please select a valid role.';
        }

        if (!errors.user_email) {
            const [emailRows] = await db.query('SELECT COUNT(*) AS cnt FROM user_master WHERE LOWER(user_email) = LOWER(?)', [userEmail]);
            if (emailRows[0].cnt > 0) {
                errors.user_email = 'User Mail already exists.';
            }
        }

        if (!errors.user_phone) {
            const [phoneRows] = await db.query('SELECT COUNT(*) AS cnt FROM user_master WHERE user_phone = ?', [userPhone]);
            if (phoneRows[0].cnt > 0) {
                errors.user_phone = 'User Phone No already exists.';
            }
        }

        const hasErrors = Object.values(errors).some(msg => msg !== '');

        if (hasErrors) {
            return res.render('create_user', {
                pageTitle: 'Create User',
                errors,
                v
            });
        }

        const uid = await generateUserId();
        const hashedPassword = await bcrypt.hash(password, 10);

        await db.query(
            `INSERT INTO user_master (user_id, user_name, user_email, user_phone, password, role, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
            [uid, userName, userEmail, userPhone, hashedPassword, role, status]
        );

        res.redirect(`manage_user.php?success=${encodeURIComponent(`User ${uid} created successfully.`)}`);
    } catch (err) {
        next(err);
    }
};

const editForm = async (req, res, next) => {
    try {
        const id = parseInt(req.params.id || req.query.id || 0, 10);
        const [rows] = await db.query('SELECT * FROM user_master WHERE id = ? LIMIT 1', [id]);
        const user = rows[0];

        if (!user) {
            return res.redirect(`manage_user.php?error=${encodeURIComponent('User record not found.')}`);
        }

        res.render('edit_user', {
            pageTitle: 'Edit User',
            user,
            errors: {},
            v: {
                user_name: user.user_name,
                user_email: user.user_email,
                user_phone: user.user_phone,
                role: user.role,
                status: parseInt(user.status, 10)
            }
        });
    } catch (err) {
        next(err);
    }
};

const editProcess = async (req, res, next) => {
    try {
        const id = parseInt(req.body.id || req.query.id || 0, 10);
        const [rows] = await db.query('SELECT * FROM user_master WHERE id = ? LIMIT 1', [id]);
        const user = rows[0];

        if (!user) {
            return res.redirect(`manage_user.php?error=${encodeURIComponent('User record not found.')}`);
        }

        const userName = (req.body.user_name || '').trim();
        const userEmail = (req.body.user_email || '').trim();
        const userPhone = (req.body.user_phone || '').trim();
        const password = req.body.password || '';
        const confirmPassword = req.body.confirm_password || '';
        const role = req.body.role || 'user';
        const status = req.body.status ? 1 : 0;

        const v = {
            user_name: userName,
            user_email: userEmail,
            user_phone: userPhone,
            role,
            status
        };

        const errors = {
            user_name: '',
            user_email: '',
            user_phone: '',
            password: '',
            confirm_password: '',
            role: ''
        };

        if (!userName) {
            errors.user_name = 'User Name is required.';
        } else if (userName.length < 2) {
            errors.user_name = 'User Name must be at least 2 characters.';
        } else if (userName.length > 100) {
            errors.user_name = 'User Name cannot exceed 100 characters.';
        }

        if (!userEmail) {
            errors.user_email = 'User Mail is required.';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
            errors.user_email = 'Please enter a valid email address.';
        }

        if (!userPhone) {
            errors.user_phone = 'User Phone No is required.';
        } else if (!/^[0-9+\-\s]{7,20}$/.test(userPhone)) {
            errors.user_phone = 'Please enter a valid phone number.';
        }

        if (password !== '') {
            if (password.length < 6) {
                errors.password = 'Password must be at least 6 characters.';
            } else if (password !== confirmPassword) {
                errors.confirm_password = 'Password and Confirm Password do not match.';
            }
        }

        if (!['user', 'admin'].includes(role)) {
            errors.role = 'Please select a valid role.';
        }

        if (!errors.user_email) {
            const [emailRows] = await db.query(
                'SELECT COUNT(*) AS cnt FROM user_master WHERE LOWER(user_email) = LOWER(?) AND id != ?',
                [userEmail, id]
            );
            if (emailRows[0].cnt > 0) {
                errors.user_email = 'User Mail already exists.';
            }
        }

        if (!errors.user_phone) {
            const [phoneRows] = await db.query(
                'SELECT COUNT(*) AS cnt FROM user_master WHERE user_phone = ? AND id != ?',
                [userPhone, id]
            );
            if (phoneRows[0].cnt > 0) {
                errors.user_phone = 'User Phone No already exists.';
            }
        }

        const hasErrors = Object.values(errors).some(msg => msg !== '');

        if (hasErrors) {
            return res.render('edit_user', {
                pageTitle: 'Edit User',
                user,
                errors,
                v
            });
        }

        if (password !== '') {
            const hashedPassword = await bcrypt.hash(password, 10);
            await db.query(
                `UPDATE user_master SET 
                    user_name = ?, 
                    user_email = ?, 
                    user_phone = ?, 
                    role = ?, 
                    status = ?, 
                    password = ?, 
                    updated_at = NOW() 
                 WHERE id = ?`,
                [userName, userEmail, userPhone, role, status, hashedPassword, id]
            );
        } else {
            await db.query(
                `UPDATE user_master SET 
                    user_name = ?, 
                    user_email = ?, 
                    user_phone = ?, 
                    role = ?, 
                    status = ?, 
                    updated_at = NOW() 
                 WHERE id = ?`,
                [userName, userEmail, userPhone, role, status, id]
            );
        }

        res.redirect(`manage_user.php?success=${encodeURIComponent(`User ${user.user_id} updated successfully.`)}`);
    } catch (err) {
        next(err);
    }
};

const viewUser = async (req, res, next) => {
    try {
        const id = parseInt(req.params.id || req.query.id || 0, 10);
        const [rows] = await db.query('SELECT * FROM user_master WHERE id = ? LIMIT 1', [id]);
        const user = rows[0];

        if (!user) {
            return res.redirect(`manage_user.php?error=${encodeURIComponent('User record not found.')}`);
        }

        res.render('view_user', {
            pageTitle: 'View User',
            user
        });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    manageUser,
    createForm,
    createProcess,
    editForm,
    editProcess,
    viewUser
};
