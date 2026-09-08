const db = require('../config/db');
const bcrypt = require('bcryptjs');

const showLogin = (req, res) => {
    if (req.session && req.session.user_id) {
        return res.redirect('index.php');
    }
    res.render('login', {
        pageTitle: 'Sign In | Sun PowerTools ERP',
        error: '',
        userName: ''
    });
};

const processLogin = async (req, res, next) => {
    try {
        const userName = (req.body.user_name || '').trim();
        const password = req.body.password || '';

        if (!userName || !password) {
            return res.render('login', {
                pageTitle: 'Sign In | Sun PowerTools ERP',
                error: 'Please enter username and password.',
                userName
            });
        }

        const [rows] = await db.query(
            `SELECT id, user_id, user_name, password, role, status 
             FROM user_master 
             WHERE user_name = ? 
             LIMIT 1`,
            [userName]
        );

        const user = rows[0];

        if (user && parseInt(user.status) === 1) {
            const isMatch = await bcrypt.compare(password, user.password);
            if (isMatch) {
                req.session.regenerate(async (err) => {
                    if (err) return next(err);

                    req.session.user_id = user.id;
                    req.session.user_code = user.user_id;
                    req.session.user_name = user.user_name;
                    req.session.role = user.role;

                    try {
                        await db.query(
                            `UPDATE user_master SET last_login_at = NOW() WHERE id = ?`,
                            [user.id]
                        );
                    } catch (updateErr) {
                        console.error('Error updating last_login_at:', updateErr);
                    }

                    res.redirect('index.php');
                });
                return;
            }
        }

        res.render('login', {
            pageTitle: 'Sign In | Sun PowerTools ERP',
            error: 'Invalid username or password.',
            userName
        });
    } catch (err) {
        next(err);
    }
};

const logout = (req, res) => {
    if (req.session) {
        req.session.destroy(() => {
            res.redirect('login.php');
        });
    } else {
        res.redirect('login.php');
    }
};

module.exports = {
    showLogin,
    processLogin,
    logout
};
