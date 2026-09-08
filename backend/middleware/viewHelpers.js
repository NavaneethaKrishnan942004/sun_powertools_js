const { formatCustomerBalance } = require('../utils/customerHelper');
const { getPaymentTypeBadge, evaluateCreditStatus } = require('../utils/salesNoteHelper');
const { getRentalStatusBadge } = require('../utils/rentalHelper');

/**
 * Escapes HTML entities
 */
function e(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Converts newlines to <br> tags
 */
function nl2br(str) {
    if (!str) return '';
    return e(str).replace(/(\r\n|\n\r|\r|\n)/g, '<br>$1');
}

/**
 * Formats a number with decimals and commas
 */
function numberFormat(number, decimals = 2) {
    const num = parseFloat(number);
    if (isNaN(num)) return '0.00';
    return num.toLocaleString('en-IN', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

/**
 * Renders Breadcrumbs HTML
 */
function renderBreadcrumbs(items) {
    if (!items || !items.length) return '';
    let html = '<nav aria-label="breadcrumb" class="admin-breadcrumb-nav"><ol class="admin-breadcrumb">';
    const total = items.length;

    items.forEach((item, index) => {
        const isLast = (index === total - 1);
        const title = item.title || '';
        const link = item.link || null;
        const icon = item.icon || null;

        if (isLast || !link) {
            html += '<li class="breadcrumb-item active" aria-current="page">';
            if (icon) {
                html += `<i class="${e(icon)} me-1"></i>`;
            }
            html += e(title);
            html += '</li>';
        } else {
            html += '<li class="breadcrumb-item">';
            html += `<a href="${e(link)}">`;
            if (icon) {
                html += `<i class="${e(icon)} me-1"></i>`;
            }
            html += e(title);
            html += '</a></li>';
        }
    });

    html += '</ol></nav>';
    return html;
}

/**
 * View Helpers Middleware
 */
function viewHelpers(req, res, next) {
    // Current page determination for active menu highlighting
    let reqPath = req.path;
    if (reqPath.startsWith('/')) reqPath = reqPath.slice(1);
    if (!reqPath || reqPath === '') reqPath = 'index.php';
    if (!reqPath.endsWith('.php') && !reqPath.includes('.')) {
        reqPath += '.php';
    }

    res.locals.currentPage = reqPath;
    res.locals.e = e;
    res.locals.nl2br = nl2br;
    res.locals.numberFormat = numberFormat;
    res.locals.renderBreadcrumbs = renderBreadcrumbs;
    res.locals.formatCustomerBalance = formatCustomerBalance;
    res.locals.getPaymentTypeBadge = getPaymentTypeBadge;
    res.locals.evaluateCreditStatus = evaluateCreditStatus;
    res.locals.getRentalStatusBadge = getRentalStatusBadge;
    res.locals.urlencode = encodeURIComponent;
    res.locals.htmlspecialchars = e;

    // Flash/query messages helper
    res.locals.query = req.query || {};
    res.locals.success = req.query.success || '';
    res.locals.error = req.query.error || '';

    next();
}

module.exports = {
    viewHelpers,
    e,
    nl2br,
    numberFormat,
    renderBreadcrumbs,
    formatCustomerBalance,
    getPaymentTypeBadge,
    evaluateCreditStatus,
    getRentalStatusBadge
};
