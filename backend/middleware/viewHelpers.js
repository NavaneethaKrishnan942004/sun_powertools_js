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
 * Renders Standard Pagination Component
 */
function renderPagination(options = {}) {
    const page = parseInt(options.page || 1, 10);
    const totalPages = parseInt(options.totalPages || 1, 10);
    const totalRecords = parseInt(options.totalRecords || 0, 10);
    const limit = parseInt(options.limit || 10, 10);
    const queryParams = options.queryParams || {};
    const baseUrl = options.baseUrl || '';

    if (totalRecords === 0) {
        return '';
    }

    const startRec = (page - 1) * limit + 1;
    const endRec = Math.min(page * limit, totalRecords);

    function getPageUrl(p) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(queryParams)) {
            if (k !== 'page' && v !== '' && v !== null && v !== undefined) {
                params.set(k, v);
            }
        }
        params.set('page', p);
        const qStr = params.toString();
        return (baseUrl ? baseUrl : '') + (qStr ? '?' + qStr : '');
    }

    let pages = [];
    if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
        pages.push(1);
        let start = Math.max(2, page - 2);
        let end = Math.min(totalPages - 1, page + 2);

        if (start > 2) {
            pages.push('...');
        }
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        if (end < totalPages - 1) {
            pages.push('...');
        }
        pages.push(totalPages);
    }

    let html = `
    <div class="table-pagination-container d-flex flex-column flex-sm-row justify-content-between align-items-center gap-3 p-3 p-md-4 border-top bg-surface">
        <div class="small text-muted text-center text-sm-start">
            Showing <strong class="text-body fw-semibold">${startRec}–${endRec}</strong> of <strong class="text-body fw-semibold">${totalRecords.toLocaleString('en-IN')}</strong> records
        </div>
        ${totalPages > 1 ? `
        <nav aria-label="Table navigation">
            <ul class="pagination pagination-sm mb-0 justify-content-center">
                <li class="page-item ${page <= 1 ? 'disabled' : ''}">
                    <a class="page-link" href="${page > 1 ? e(getPageUrl(page - 1)) : '#'}" aria-label="Previous">
                        <i class="bi bi-chevron-left small me-1"></i> Prev
                    </a>
                </li>
                ${pages.map(p => {
                    if (p === '...') {
                        return '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>';
                    }
                    const isActive = (p === page);
                    return `
                        <li class="page-item ${isActive ? 'active' : ''}">
                            <a class="page-link" href="${e(getPageUrl(p))}" ${isActive ? 'aria-current="page"' : ''}>
                                ${p}
                            </a>
                        </li>
                    `;
                }).join('')}
                <li class="page-item ${page >= totalPages ? 'disabled' : ''}">
                    <a class="page-link" href="${page < totalPages ? e(getPageUrl(page + 1)) : '#'}" aria-label="Next">
                        Next <i class="bi bi-chevron-right small ms-1"></i>
                    </a>
                </li>
            </ul>
        </nav>
        ` : ''}
    </div>
    `;

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

    res.locals.currentPath = req.path;
    res.locals.currentPage = reqPath;
    res.locals.e = e;
    res.locals.nl2br = nl2br;
    res.locals.numberFormat = numberFormat;
    res.locals.renderBreadcrumbs = renderBreadcrumbs;
    res.locals.renderPagination = renderPagination;
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
    renderPagination,
    formatCustomerBalance,
    getPaymentTypeBadge,
    evaluateCreditStatus,
    getRentalStatusBadge
};
