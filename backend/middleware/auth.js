const db = require('../config/db');

/**
 * Authentication middleware ensuring user is logged in
 */
function requireLogin(req, res, next) {
    if (!req.session || !req.session.user_id) {
        if (req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({ success: false, message: 'Unauthorized access. Please log in.' });
        }
        return res.redirect('/login.php');
    }
    next();
}

/**
 * Authorization middleware ensuring user is admin
 */
function requireAdmin(req, res, next) {
    requireLogin(req, res, () => {
        const role = (req.session.role || '').toLowerCase();
        if (role !== 'admin') {
            return res.status(403).send('Access Denied');
        }
        next();
    });
}

/**
 * Global User State Middleware - loads user details for templates
 */
async function attachUserContext(req, res, next) {
    res.locals.session = req.session || {};
    res.locals.loggedInUsername = 'User';
    res.locals.loggedInRole = 'User';
    res.locals.loggedInAvatar = '/sun_powertools/assets/images/avatar/avatar.jpg';
    res.locals.loggedInUserId = null;

    if (req.session && req.session.user_id) {
        try {
            const [rows] = await db.query(
                'SELECT id, user_id, user_name, role, avatar FROM user_master WHERE id = :id LIMIT 1',
                { id: req.session.user_id }
            );

            if (rows && rows.length > 0) {
                const user = rows[0];
                res.locals.loggedInUserId = user.id;
                res.locals.loggedInUsername = user.user_name || 'User';
                res.locals.loggedInRole = user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1).toLowerCase()) : 'User';
                if (user.avatar) {
                    res.locals.loggedInAvatar = '/sun_powertools/uploads/avatars/' + user.avatar;
                }
            }
        } catch (err) {
            console.error('[Auth Middleware] Error loading user context:', err.message);
        }
    }

    next();
}

module.exports = {
    requireLogin,
    requireAdmin,
    attachUserContext
};
