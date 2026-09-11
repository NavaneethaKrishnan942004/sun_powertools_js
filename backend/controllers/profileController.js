const db = require('../config/db');
const fs = require('fs');
const path = require('path');

const getProfile = async (req, res, next) => {
    try {
        const userId = req.session.user_id;
        const [rows] = await db.query(
            `SELECT id, user_id, first_name, last_name, user_name, user_email, user_phone, gender, date_of_birth, address, city, state, pincode, avatar, role, status, created_at 
             FROM user_master 
             WHERE id = ? 
             LIMIT 1`,
            [userId]
        );

        const user = rows[0];
        if (!user) {
            return req.session.destroy(() => res.redirect('/login'));
        }

        const avatarSrc = user.avatar
            ? '/sun_powertools/uploads/avatars/' + user.avatar
            : '/sun_powertools/assets/images/avatar/avatar.jpg';

        res.render('profile', {
            pageTitle: 'My Profile',
            user,
            avatarSrc,
            message: '',
            error: ''
        });
    } catch (err) {
        next(err);
    }
};

const updateProfile = async (req, res, next) => {
    try {
        const userId = req.session.user_id;
        const [userRows] = await db.query('SELECT * FROM user_master WHERE id = ? LIMIT 1', [userId]);
        let user = userRows[0];
        if (!user) {
            return req.session.destroy(() => res.redirect('/login'));
        }

        let message = '';
        let error = '';

        const firstName = (req.body.first_name || '').trim();
        const lastName = (req.body.last_name || '').trim();
        const userName = (req.body.user_name || '').trim();
        const userEmail = (req.body.user_email || '').trim();
        const userPhone = (req.body.user_phone || '').trim();
        const gender = req.body.gender || null;
        const dob = req.body.date_of_birth || null;
        const address = (req.body.address || '').trim();
        const city = (req.body.city || '').trim();
        const state = (req.body.state || '').trim();
        const pincode = (req.body.pincode || '').trim();

        if (!userName) {
            error = 'Username is required.';
        } else if (!userEmail) {
            error = 'Email is required.';
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
            error = 'Please enter a valid email address.';
        } else if (!userPhone) {
            error = 'Phone number is required.';
        } else if (pincode && !/^[0-9]{6}$/.test(pincode)) {
            error = 'Pincode must contain exactly 6 digits.';
        }

        if (!error) {
            const [dups] = await db.query(
                `SELECT id FROM user_master 
                 WHERE (user_email = ? OR user_phone = ? OR user_name = ?) 
                 AND id != ? 
                 LIMIT 1`,
                [userEmail, userPhone, userName, userId]
            );

            if (dups.length > 0) {
                error = 'Email, phone number, or username is already in use by another account.';
            }
        }

        let avatarName = user.avatar || null;

        if (!error && req.file) {
            if (user.avatar) {
                const oldPath = path.join(__dirname, '../../uploads/avatars', user.avatar);
                if (fs.existsSync(oldPath)) {
                    try { fs.unlinkSync(oldPath); } catch (e) {}
                }
            }
            avatarName = req.file.filename;
        }

        if (!error) {
            await db.query(
                `UPDATE user_master SET
                    first_name = ?,
                    last_name = ?,
                    user_name = ?,
                    user_email = ?,
                    user_phone = ?,
                    gender = ?,
                    date_of_birth = ?,
                    address = ?,
                    city = ?,
                    state = ?,
                    pincode = ?,
                    avatar = ?,
                    updated_at = NOW()
                 WHERE id = ?`,
                [
                    firstName || null,
                    lastName || null,
                    userName,
                    userEmail,
                    userPhone,
                    gender || null,
                    dob || null,
                    address || null,
                    city || null,
                    state || null,
                    pincode || null,
                    avatarName,
                    userId
                ]
            );

            req.session.user_name = userName;
            message = 'Profile updated successfully.';

            const [updatedRows] = await db.query('SELECT * FROM user_master WHERE id = ? LIMIT 1', [userId]);
            user = updatedRows[0];
        }

        const avatarSrc = user.avatar
            ? '/sun_powertools/uploads/avatars/' + user.avatar
            : '/sun_powertools/assets/images/avatar/avatar.jpg';

        res.render('profile', {
            pageTitle: 'My Profile',
            user,
            avatarSrc,
            message,
            error
        });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getProfile,
    updateProfile
};
