const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist
const productsDir = path.join(__dirname, '../../uploads/products');
const avatarsDir = path.join(__dirname, '../../uploads/avatars');

if (!fs.existsSync(productsDir)) {
    fs.mkdirSync(productsDir, { recursive: true });
}
if (!fs.existsSync(avatarsDir)) {
    fs.mkdirSync(avatarsDir, { recursive: true });
}

// Storage engine for Product Images
const productStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, productsDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueSuffix = Date.now() + '_' + Math.random().toString(36).substring(2, 10);
        cb(null, `product_${uniqueSuffix}${ext}`);
    }
});

// Storage engine for Avatars
const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, avatarsDir);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname).toLowerCase();
        const userId = req.session?.user_id || 'user';
        cb(null, `avatar_${userId}_${Date.now()}${ext}`);
    }
});

const imageFilter = (req, file, cb) => {
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('Only JPG, JPEG, PNG, GIF, and WEBP image formats are allowed.'), false);
    }
};

const uploadProductImages = multer({
    storage: productStorage,
    fileFilter: imageFilter,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB per file
});

const uploadAvatar = multer({
    storage: avatarStorage,
    fileFilter: imageFilter,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB max for avatars
});

module.exports = {
    uploadProductImages,
    uploadProductImage: uploadProductImages,
    uploadAvatar,
    productsDir,
    avatarsDir
};
