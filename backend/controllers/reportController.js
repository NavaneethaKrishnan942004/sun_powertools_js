const pool = require('../config/db');
const { getEffectiveRentalStatus, getRentalStatusBadge, formatDuration } = require('../utils/rentalHelper');
const { getSaleTypeInfo, getPaymentStatusInfo, getPaymentTypeBadge } = require('../utils/salesNoteHelper');

/**
 * Helper to compute date range boundaries based on preset or custom dates
 */
function resolveDateRange(dateRangePreset, fromDateInput, toDateInput) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    let fromDate = (fromDateInput || '').trim();
    let toDate = (toDateInput || '').trim();
    let preset = (dateRangePreset || '').toLowerCase().trim();

    if (fromDate || toDate) {
        if (!preset || preset === 'custom') {
            preset = 'custom';
            return { preset, fromDate, toDate };
        }
    }

    if (!preset && !fromDate && !toDate) {
        preset = 'this_month';
    }

    if (preset === 'today') {
        fromDate = formatDate(now);
        toDate = formatDate(now);
    } else if (preset === 'this_week') {
        const currentDay = now.getDay(); // 0 is Sunday, 1 is Monday
        const diffToMonday = (currentDay === 0 ? -6 : 1) - currentDay;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diffToMonday);

        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        fromDate = formatDate(monday);
        toDate = formatDate(sunday);
    } else if (preset === 'this_month') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        fromDate = formatDate(firstDay);
        toDate = formatDate(lastDay);
    }

    return { preset, fromDate, toDate };
}

/**
 * Fetch filtered Rentals dataset with KPI aggregation
 */
async function fetchRentalsReportData(filters) {
    const {
        fromDate,
        toDate,
        customerId = 0,
        status = '',
        paymentStatus = '',
        rentalPeriodType = '',
        productId = 0
    } = filters;

    let whereSql = ' WHERE 1=1 ';
    const params = [];

    if (fromDate) {
        whereSql += ' AND DATE(r.check_in_datetime) >= ?';
        params.push(fromDate);
    }
    if (toDate) {
        whereSql += ' AND DATE(r.check_in_datetime) <= ?';
        params.push(toDate);
    }
    if (customerId > 0) {
        whereSql += ' AND r.customer_id = ?';
        params.push(customerId);
    }
    if (productId > 0) {
        whereSql += ' AND r.product_id = ?';
        params.push(productId);
    }
    if (rentalPeriodType && rentalPeriodType !== 'all') {
        whereSql += ' AND LOWER(r.rental_period_type) = ?';
        params.push(rentalPeriodType.toLowerCase());
    }

    if (status && status !== 'all') {
        if (status === 'Overdue') {
            whereSql += ` AND (r.rental_status = 'Overdue' OR (r.rental_status = 'Active' AND r.expected_checkout_datetime < NOW()))`;
        } else if (status === 'Active') {
            whereSql += ` AND r.rental_status = 'Active' AND r.expected_checkout_datetime >= NOW()`;
        } else {
            whereSql += ` AND r.rental_status = ?`;
            params.push(status);
        }
    }

    const query = `
        SELECT 
            r.*,
            cm.customer_code,
            cm.customer_name,
            cm.mobile_number,
            pm.product_code,
            pm.product_name,
            pm.short_name,
            b.brand_name,
            c.category_name,
            u.user_name AS created_by_name
        FROM rentals r
        INNER JOIN customer_master cm ON cm.id = r.customer_id
        INNER JOIN product_master pm ON pm.id = r.product_id
        LEFT JOIN brand_master b ON b.id = pm.brand_id
        LEFT JOIN category_master c ON c.id = pm.category_id
        LEFT JOIN user_master u ON u.id = r.created_by
        ${whereSql}
        ORDER BY r.id DESC
    `;

    const [rows] = await pool.query(query, params);

    // Post-process rows for accurate financial status and effective badge
    const records = [];
    let totalRentalAmount = 0;
    let totalAdvanceAmount = 0;
    let totalOutstandingAmount = 0;
    let totalActualAmount = 0;
    let fullyPaidCount = 0;
    let partiallyPaidCount = 0;
    let unpaidCount = 0;

    for (const r of rows) {
        const estTotal = parseFloat(r.total_rental_amount || 0);
        const advPaid = parseFloat(r.advance_rental_amount || 0);
        const isReturned = (r.rental_status === 'Returned');
        
        // Calculated remaining balance
        let balanceDue = 0;
        if (isReturned) {
            balanceDue = Math.max(0, parseFloat(r.remaining_amount || 0));
        } else {
            balanceDue = Math.max(0, estTotal - advPaid);
        }

        // Determine Payment Status
        let pStatus = 'Unpaid';
        if (balanceDue <= 0.001 && (advPaid > 0 || isReturned)) {
            pStatus = 'Paid';
        } else if (advPaid > 0.001) {
            pStatus = 'Partial';
        }

        // Apply in-memory payment_status filter if requested
        if (paymentStatus && paymentStatus !== 'all') {
            const wantPaid = (paymentStatus.toLowerCase() === 'paid' || paymentStatus.toLowerCase() === 'fully paid');
            const wantPartial = (paymentStatus.toLowerCase() === 'partial' || paymentStatus.toLowerCase() === 'partially paid');
            const wantUnpaid = (paymentStatus.toLowerCase() === 'unpaid');

            if (wantPaid && pStatus !== 'Paid') continue;
            if (wantPartial && pStatus !== 'Partial') continue;
            if (wantUnpaid && pStatus !== 'Unpaid') continue;
        }

        const effectiveStatus = getEffectiveRentalStatus(r.rental_status, r.expected_checkout_datetime);
        const statusBadge = getRentalStatusBadge(r.rental_status, r.expected_checkout_datetime);

        const record = {
            ...r,
            effective_status: effectiveStatus,
            status_badge: statusBadge,
            computed_payment_status: pStatus,
            estimated_total: estTotal,
            advance_paid: advPaid,
            remaining_balance: balanceDue,
            actual_total: isReturned ? parseFloat(r.total_rental_amount || 0) : null
        };

        records.push(record);

        // Aggregate KPIs
        totalRentalAmount += estTotal;
        totalAdvanceAmount += advPaid;
        totalOutstandingAmount += balanceDue;
        if (isReturned) totalActualAmount += parseFloat(r.total_rental_amount || 0);

        if (pStatus === 'Paid') fullyPaidCount++;
        else if (pStatus === 'Partial') partiallyPaidCount++;
        else unpaidCount++;
    }

    return {
        records,
        summary: {
            totalRecords: records.length,
            totalRentalAmount,
            totalAdvanceAmount,
            totalOutstandingAmount,
            totalActualAmount,
            fullyPaidCount,
            partiallyPaidCount,
            unpaidCount
        }
    };
}

/**
 * Fetch filtered Sales dataset with KPI aggregation
 */
async function fetchSalesReportData(filters) {
    const {
        fromDate,
        toDate,
        customerId = 0,
        status = '',
        paymentStatus = '',
        saleType = ''
    } = filters;

    let whereSql = ' WHERE 1=1 ';
    const params = [];

    if (fromDate) {
        whereSql += ' AND DATE(sn.sales_date) >= ?';
        params.push(fromDate);
    }
    if (toDate) {
        whereSql += ' AND DATE(sn.sales_date) <= ?';
        params.push(toDate);
    }
    if (customerId > 0) {
        whereSql += ' AND sn.customer_id = ?';
        params.push(customerId);
    }
    if (status !== '' && status !== 'all') {
        whereSql += ' AND sn.status = ?';
        params.push(parseInt(status, 10));
    }
    if (saleType && saleType !== 'all') {
        whereSql += ' AND sn.sale_type = ?';
        params.push(saleType);
    }

    if (paymentStatus && paymentStatus !== 'all') {
        const pStatusLower = paymentStatus.toLowerCase();
        if (pStatusLower === 'paid' || pStatusLower === 'fully paid') {
            whereSql += ' AND (sn.paid_amount >= sn.total_amount - 0.001)';
        } else if (pStatusLower === 'partial' || pStatusLower === 'partially paid') {
            whereSql += ' AND (sn.paid_amount > 0.001 AND sn.paid_amount < sn.total_amount - 0.001)';
        } else if (pStatusLower === 'unpaid') {
            whereSql += ' AND (sn.paid_amount <= 0.001)';
        }
    }

    const query = `
        SELECT 
            sn.*,
            cm.customer_code,
            cm.customer_name,
            cm.mobile_number,
            u.user_name AS created_by_name
        FROM sales_notes sn
        LEFT JOIN customer_master cm ON cm.id = sn.customer_id
        LEFT JOIN user_master u ON u.id = sn.created_by
        ${whereSql}
        ORDER BY sn.id DESC
    `;

    const [rows] = await pool.query(query, params);

    const records = [];
    let totalSalesAmount = 0;
    let totalPaidAmount = 0;
    let totalCreditAmount = 0;
    let fullyPaidCount = 0;
    let partiallyPaidCount = 0;
    let unpaidCount = 0;

    for (const sn of rows) {
        const total = parseFloat(sn.total_amount || 0);
        const paid = parseFloat(sn.paid_amount || 0);
        const credit = Math.max(0, total - paid);

        const sTypeInfo = getSaleTypeInfo(sn.sale_type, sn.credit_amount, sn.payment_type);
        const pStatusInfo = getPaymentStatusInfo(paid, total);

        const record = {
            ...sn,
            sale_type_label: sTypeInfo.label,
            sale_type_badge: sTypeInfo.badge_html,
            payment_status_label: pStatusInfo.status,
            payment_status_badge: pStatusInfo.badge_html,
            computed_balance: credit
        };

        records.push(record);

        totalSalesAmount += total;
        totalPaidAmount += paid;
        totalCreditAmount += credit;

        if (pStatusInfo.code === 'paid') fullyPaidCount++;
        else if (pStatusInfo.code === 'partial') partiallyPaidCount++;
        else unpaidCount++;
    }

    return {
        records,
        summary: {
            totalRecords: records.length,
            totalSalesAmount,
            totalPaidAmount,
            totalCreditAmount,
            fullyPaidCount,
            partiallyPaidCount,
            unpaidCount
        }
    };
}

/**
 * Render Reports Main Dashboard & Generator
 * GET /reports
 */
exports.reportsDashboard = async (req, res) => {
    try {
        const query = req.query || {};
        const reportType = (query.report_type || 'rentals').toLowerCase();
        const dateRangePreset = (query.date_range || '').toLowerCase();
        const { fromDate, toDate, preset } = resolveDateRange(dateRangePreset, query.from_date, query.to_date);

        const customerId = parseInt(query.customer_id || 0, 10);
        const status = query.status || '';
        const paymentStatus = query.payment_status || '';
        const rentalPeriodType = query.rental_period_type || '';
        const productId = parseInt(query.product_id || 0, 10);
        const saleType = query.sale_type || '';

        const filterPayload = {
            fromDate,
            toDate,
            customerId,
            status,
            paymentStatus,
            rentalPeriodType,
            productId,
            saleType
        };

        // Fetch dataset depending on selected report type
        let reportResult = { records: [], summary: {} };
        if (reportType === 'sales') {
            reportResult = await fetchSalesReportData(filterPayload);
        } else {
            reportResult = await fetchRentalsReportData(filterPayload);
        }

        // Fetch filter master options
        const [customersList] = await pool.query(
            `SELECT id, customer_code, customer_name, mobile_number FROM customer_master WHERE status = 1 ORDER BY customer_name ASC`
        );
        const [productsList] = await pool.query(
            `SELECT id, product_code, product_name, rental_available FROM product_master WHERE status = 1 ORDER BY product_name ASC`
        );

        res.render('reports', {
            pageTitle: 'Reports & Analytics',
            reportType,
            dateRangePreset: preset,
            fromDate,
            toDate,
            customerId,
            status,
            paymentStatus,
            rentalPeriodType,
            productId,
            saleType,
            customersList,
            productsList,
            records: reportResult.records,
            summary: reportResult.summary,
            queryParams: query
        });
    } catch (err) {
        console.error('reportsDashboard error:', err);
        res.status(500).send('Internal Server Error generating report: ' + err.message);
    }
};

/**
 * Helper to escape XML/HTML strings
 */
function escapeXml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Export Filtered Dataset to Excel (Native SpreadsheetML format)
 * GET /reports/export/excel
 */
exports.exportExcel = async (req, res) => {
    try {
        const query = req.query || {};
        const reportType = (query.report_type || 'rentals').toLowerCase();
        const { fromDate, toDate } = resolveDateRange(query.date_range, query.from_date, query.to_date);

        const filterPayload = {
            fromDate,
            toDate,
            customerId: parseInt(query.customer_id || 0, 10),
            status: query.status || '',
            paymentStatus: query.payment_status || '',
            rentalPeriodType: query.rental_period_type || '',
            productId: parseInt(query.product_id || 0, 10),
            saleType: query.sale_type || ''
        };

        const nowStr = new Date().toLocaleString('en-IN');
        const filename = `Sun_PowerTools_${reportType === 'sales' ? 'Sales' : 'Rentals'}_Report_${fromDate || 'all'}_to_${toDate || 'all'}.xls`;

        let xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Center"/>
   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>
  </Style>
  <Style ss:ID="HeaderTitle">
   <Font ss:FontName="Calibri" ss:Size="16" ss:Bold="1" ss:Color="#0d6efd"/>
   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>
  </Style>
  <Style ss:ID="MetaLabel">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1" ss:Color="#6c757d"/>
  </Style>
  <Style ss:ID="MetaValue">
   <Font ss:FontName="Calibri" ss:Size="10" ss:Color="#212529"/>
  </Style>
  <Style ss:ID="ColHeader">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0d6efd" ss:Pattern="Solid"/>
   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#000000"/>
   </Borders>
  </Style>
  <Style ss:ID="DataCell">
   <Font ss:FontName="Calibri" ss:Size="10"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#e9ecef"/>
   </Borders>
  </Style>
  <Style ss:ID="DataCellNumber">
   <Font ss:FontName="Calibri" ss:Size="10"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Alignment ss:Horizontal="Right"/>
   <Borders>
    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#e9ecef"/>
   </Borders>
  </Style>
  <Style ss:ID="SummaryRow">
   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#000000"/>
   <Interior ss:Color="#e2e3e5" ss:Pattern="Solid"/>
   <NumberFormat ss:Format="#,##0.00"/>
   <Borders>
    <Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#000000"/>
    <Border ss:Position="Bottom" ss:LineStyle="Double" ss:Weight="2" ss:Color="#000000"/>
   </Borders>
  </Style>
 </Styles>
 <Worksheet ss:Name="${reportType === 'sales' ? 'Sales Report' : 'Rentals Report'}">
  <Table>`;

        if (reportType === 'sales') {
            const { records, summary } = await fetchSalesReportData(filterPayload);

            xml += `
   <Column ss:Width="40"/>
   <Column ss:Width="110"/>
   <Column ss:Width="120"/>
   <Column ss:Width="180"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="100"/>
   <Column ss:Width="90"/>
   <Column ss:Width="100"/>

   <Row ss:Height="25">
    <Cell ss:StyleID="HeaderTitle" ss:MergeAcross="8"><Data ss:Type="String">Sun PowerTools - Sales Report</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Date Range:</Data></Cell>
    <Cell ss:StyleID="MetaValue" ss:MergeAcross="2"><Data ss:Type="String">${escapeXml(fromDate || 'All')} to ${escapeXml(toDate || 'All')}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Generated At:</Data></Cell>
    <Cell ss:StyleID="MetaValue" ss:MergeAcross="3"><Data ss:Type="String">${escapeXml(nowStr)}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Total Records:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${summary.totalRecords}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Total Sales:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${summary.totalSalesAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Total Paid:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${summary.totalPaidAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Outstanding:</Data></Cell>
    <Cell ss:StyleID="MetaValue" ss:MergeAcross="1"><Data ss:Type="Number">${summary.totalCreditAmount.toFixed(2)}</Data></Cell>
   </Row>
   <Row ss:Height="10"></Row>

   <Row ss:Height="22">
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">#</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Sales Note #</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Date &amp; Time</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Customer</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Total Amount (₹)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Paid Amount (₹)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Balance (₹)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Sale Type</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Payment Status</Data></Cell>
   </Row>`;

            if (records.length === 0) {
                xml += `
   <Row>
    <Cell ss:StyleID="DataCell" ss:MergeAcross="8"><Data ss:Type="String">No records found for the selected filters.</Data></Cell>
   </Row>`;
            } else {
                records.forEach((r, idx) => {
                    xml += `
   <Row>
    <Cell ss:StyleID="DataCell"><Data ss:Type="Number">${idx + 1}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.sales_note_no)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.sales_datetime)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.customer_name ? `${r.customer_code} - ${r.customer_name}` : 'Walk-in')}</Data></Cell>
    <Cell ss:StyleID="DataCellNumber"><Data ss:Type="Number">${parseFloat(r.total_amount || 0).toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="DataCellNumber"><Data ss:Type="Number">${parseFloat(r.paid_amount || 0).toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="DataCellNumber"><Data ss:Type="Number">${parseFloat(r.computed_balance || 0).toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.sale_type_label)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.payment_status_label)}</Data></Cell>
   </Row>`;
                });

                xml += `
   <Row ss:Height="20">
    <Cell ss:StyleID="SummaryRow" ss:MergeAcross="3"><Data ss:Type="String">TOTALS (${records.length} Records)</Data></Cell>
    <Cell ss:StyleID="SummaryRow"><Data ss:Type="Number">${summary.totalSalesAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="SummaryRow"><Data ss:Type="Number">${summary.totalPaidAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="SummaryRow"><Data ss:Type="Number">${summary.totalCreditAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="SummaryRow" ss:MergeAcross="1"><Data ss:Type="String"></Data></Cell>
   </Row>`;
            }
        } else {
            const { records, summary } = await fetchRentalsReportData(filterPayload);

            xml += `
   <Column ss:Width="40"/>
   <Column ss:Width="105"/>
   <Column ss:Width="115"/>
   <Column ss:Width="160"/>
   <Column ss:Width="170"/>
   <Column ss:Width="80"/>
   <Column ss:Width="80"/>
   <Column ss:Width="95"/>
   <Column ss:Width="95"/>
   <Column ss:Width="95"/>
   <Column ss:Width="90"/>
   <Column ss:Width="90"/>

   <Row ss:Height="25">
    <Cell ss:StyleID="HeaderTitle" ss:MergeAcross="11"><Data ss:Type="String">Sun PowerTools - Rental Report</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Date Range:</Data></Cell>
    <Cell ss:StyleID="MetaValue" ss:MergeAcross="3"><Data ss:Type="String">${escapeXml(fromDate || 'All')} to ${escapeXml(toDate || 'All')}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Generated At:</Data></Cell>
    <Cell ss:StyleID="MetaValue" ss:MergeAcross="5"><Data ss:Type="String">${escapeXml(nowStr)}</Data></Cell>
   </Row>
   <Row>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Total Records:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${summary.totalRecords}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Estimated Rental Total:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${summary.totalRentalAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Advance Collected:</Data></Cell>
    <Cell ss:StyleID="MetaValue"><Data ss:Type="Number">${summary.totalAdvanceAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="MetaLabel"><Data ss:Type="String">Balance Remaining:</Data></Cell>
    <Cell ss:StyleID="MetaValue" ss:MergeAcross="4"><Data ss:Type="Number">${summary.totalOutstandingAmount.toFixed(2)}</Data></Cell>
   </Row>
   <Row ss:Height="10"></Row>

   <Row ss:Height="22">
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">#</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Rental #</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Start Date &amp; Time</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Customer</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Product Equipment</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Period Unit</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Duration</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Rental Rate (₹)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Estimated Total (₹)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Advance Paid (₹)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Balance Due (₹)</Data></Cell>
    <Cell ss:StyleID="ColHeader"><Data ss:Type="String">Rental Status</Data></Cell>
   </Row>`;

            if (records.length === 0) {
                xml += `
   <Row>
    <Cell ss:StyleID="DataCell" ss:MergeAcross="11"><Data ss:Type="String">No records found for the selected filters.</Data></Cell>
   </Row>`;
            } else {
                records.forEach((r, idx) => {
                    xml += `
   <Row>
    <Cell ss:StyleID="DataCell"><Data ss:Type="Number">${idx + 1}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.rental_no)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.check_in_datetime)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(`${r.customer_code} - ${r.customer_name}`)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(`${r.product_code} - ${r.product_name}`)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.rental_period_type)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.estimated_duration)}</Data></Cell>
    <Cell ss:StyleID="DataCellNumber"><Data ss:Type="Number">${parseFloat(r.rental_rate || 0).toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="DataCellNumber"><Data ss:Type="Number">${r.estimated_total.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="DataCellNumber"><Data ss:Type="Number">${r.advance_paid.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="DataCellNumber"><Data ss:Type="Number">${r.remaining_balance.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="DataCell"><Data ss:Type="String">${escapeXml(r.effective_status)}</Data></Cell>
   </Row>`;
                });

                xml += `
   <Row ss:Height="20">
    <Cell ss:StyleID="SummaryRow" ss:MergeAcross="7"><Data ss:Type="String">TOTALS (${records.length} Records)</Data></Cell>
    <Cell ss:StyleID="SummaryRow"><Data ss:Type="Number">${summary.totalRentalAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="SummaryRow"><Data ss:Type="Number">${summary.totalAdvanceAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="SummaryRow"><Data ss:Type="Number">${summary.totalOutstandingAmount.toFixed(2)}</Data></Cell>
    <Cell ss:StyleID="SummaryRow"><Data ss:Type="String"></Data></Cell>
   </Row>`;
            }
        }

        xml += `
  </Table>
 </Worksheet>
</Workbook>`;

        res.setHeader('Content-Type', 'application/vnd.ms-excel');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(xml);
    } catch (err) {
        console.error('exportExcel error:', err);
        res.status(500).send('Error generating Excel export: ' + err.message);
    }
};

/**
 * Export Filtered Dataset to Word Document
 * GET /reports/export/word
 */
exports.exportWord = async (req, res) => {
    try {
        const query = req.query || {};
        const reportType = (query.report_type || 'rentals').toLowerCase();
        const { fromDate, toDate } = resolveDateRange(query.date_range, query.from_date, query.to_date);

        const filterPayload = {
            fromDate,
            toDate,
            customerId: parseInt(query.customer_id || 0, 10),
            status: query.status || '',
            paymentStatus: query.payment_status || '',
            rentalPeriodType: query.rental_period_type || '',
            productId: parseInt(query.product_id || 0, 10),
            saleType: query.sale_type || ''
        };

        const nowStr = new Date().toLocaleString('en-IN');
        const filename = `Sun_PowerTools_${reportType === 'sales' ? 'Sales' : 'Rentals'}_Report_${fromDate || 'all'}_to_${toDate || 'all'}.doc`;

        let docHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
    <meta charset="utf-8">
    <title>Sun PowerTools Report</title>
    <!--[if gte mso 9]>
    <xml>
        <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>90</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
        </w:WordDocument>
    </xml>
    <![endif]-->
    <style>
        body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; color: #212529; margin: 20px; }
        h1 { color: #0d6efd; font-size: 20pt; margin-bottom: 4px; }
        .meta-table { width: 100%; margin-bottom: 20px; border-bottom: 2px solid #0d6efd; padding-bottom: 10px; }
        .summary-card { background-color: #f8f9fa; border: 1px solid #dee2e6; padding: 12px; margin-bottom: 20px; border-radius: 6px; }
        .data-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
        .data-table th { background-color: #0d6efd; color: #ffffff; padding: 8px 6px; text-align: left; font-size: 10pt; border: 1px solid #0d6efd; }
        .data-table td { padding: 6px; font-size: 9.5pt; border: 1px solid #dee2e6; vertical-align: middle; }
        .data-table tr:nth-child(even) td { background-color: #f8f9fa; }
        .text-end { text-align: right; }
        .text-center { text-align: center; }
        .fw-bold { font-weight: bold; }
        .footer-note { margin-top: 25px; font-size: 9pt; color: #6c757d; text-align: center; border-top: 1px solid #dee2e6; padding-top: 8px; }
    </style>
</head>
<body>
    <h1>Sun PowerTools - ${reportType === 'sales' ? 'Sales Report' : 'Rentals Report'}</h1>
    <table class="meta-table">
        <tr>
            <td><strong>Date Range:</strong> ${escapeXml(fromDate || 'All')} to ${escapeXml(toDate || 'All')}</td>
            <td class="text-end"><strong>Generated At:</strong> ${escapeXml(nowStr)}</td>
        </tr>
    </table>
`;

        if (reportType === 'sales') {
            const { records, summary } = await fetchSalesReportData(filterPayload);

            docHtml += `
    <div class="summary-card">
        <strong>Summary Metrics:</strong> Total Records: <strong>${summary.totalRecords}</strong> &bull;
        Total Sales: <strong>₹${summary.totalSalesAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong> &bull;
        Total Paid: <strong>₹${summary.totalPaidAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong> &bull;
        Total Outstanding: <strong>₹${summary.totalCreditAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong>
    </div>

    <table class="data-table">
        <thead>
            <tr>
                <th class="text-center" style="width: 30px;">#</th>
                <th>Sales Note #</th>
                <th>Date</th>
                <th>Customer</th>
                <th class="text-end">Total (₹)</th>
                <th class="text-end">Paid (₹)</th>
                <th class="text-end">Balance (₹)</th>
                <th>Type</th>
                <th>Payment Status</th>
            </tr>
        </thead>
        <tbody>
`;
            if (records.length === 0) {
                docHtml += `<tr><td colspan="9" class="text-center" style="padding: 20px;">No records found for the selected filters.</td></tr>`;
            } else {
                records.forEach((r, idx) => {
                    docHtml += `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td class="fw-bold">${escapeXml(r.sales_note_no)}</td>
                <td>${escapeXml(r.sales_datetime)}</td>
                <td>${escapeXml(r.customer_name ? `${r.customer_code} - ${r.customer_name}` : 'Walk-in Customer')}</td>
                <td class="text-end">₹${parseFloat(r.total_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${parseFloat(r.paid_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end fw-bold">₹${parseFloat(r.computed_balance || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td>${escapeXml(r.sale_type_label)}</td>
                <td>${escapeXml(r.payment_status_label)}</td>
            </tr>
`;
                });

                docHtml += `
            <tr style="background-color: #e2e3e5; font-weight: bold;">
                <td colspan="4">TOTALS (${records.length} Records)</td>
                <td class="text-end">₹${summary.totalSalesAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${summary.totalPaidAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${summary.totalCreditAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td colspan="2"></td>
            </tr>
`;
            }
            docHtml += `</tbody></table>`;
        } else {
            const { records, summary } = await fetchRentalsReportData(filterPayload);

            docHtml += `
    <div class="summary-card">
        <strong>Summary Metrics:</strong> Total Records: <strong>${summary.totalRecords}</strong> &bull;
        Estimated Rental Total: <strong>₹${summary.totalRentalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong> &bull;
        Advance Collected: <strong>₹${summary.totalAdvanceAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong> &bull;
        Estimated Remaining: <strong>₹${summary.totalOutstandingAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong>
    </div>

    <table class="data-table">
        <thead>
            <tr>
                <th class="text-center" style="width: 30px;">#</th>
                <th>Rental #</th>
                <th>Check-In Date</th>
                <th>Customer</th>
                <th>Equipment Product</th>
                <th>Unit</th>
                <th>Dur</th>
                <th class="text-end">Rate (₹)</th>
                <th class="text-end">Estimated Total (₹)</th>
                <th class="text-end">Advance (₹)</th>
                <th class="text-end">Remaining (₹)</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
`;
            if (records.length === 0) {
                docHtml += `<tr><td colspan="12" class="text-center" style="padding: 20px;">No records found for the selected filters.</td></tr>`;
            } else {
                records.forEach((r, idx) => {
                    docHtml += `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td class="fw-bold">${escapeXml(r.rental_no)}</td>
                <td>${escapeXml(r.check_in_datetime)}</td>
                <td>${escapeXml(`${r.customer_code} - ${r.customer_name}`)}</td>
                <td>${escapeXml(`${r.product_code} - ${r.product_name}`)}</td>
                <td>${escapeXml(r.rental_period_type)}</td>
                <td>${escapeXml(r.estimated_duration)}</td>
                <td class="text-end">₹${parseFloat(r.rental_rate || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${r.estimated_total.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${r.advance_paid.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end fw-bold">₹${r.remaining_balance.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td>${escapeXml(r.effective_status)}</td>
            </tr>
`;
                });

                docHtml += `
            <tr style="background-color: #e2e3e5; font-weight: bold;">
                <td colspan="8">TOTALS (${records.length} Records)</td>
                <td class="text-end">₹${summary.totalRentalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${summary.totalAdvanceAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${summary.totalOutstandingAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td></td>
            </tr>
`;
            }
            docHtml += `</tbody></table>`;
        }

        docHtml += `
    <div class="footer-note">
        Sun PowerTools ERP Report &bull; Generated automatically on ${escapeXml(nowStr)}
    </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(docHtml);
    } catch (err) {
        console.error('exportWord error:', err);
        res.status(500).send('Error generating Word export: ' + err.message);
    }
};

/**
 * Export / Printable PDF View with auto-print & pagination styling
 * GET /reports/export/pdf
 */
exports.exportPdf = async (req, res) => {
    try {
        const query = req.query || {};
        const reportType = (query.report_type || 'rentals').toLowerCase();
        const { fromDate, toDate } = resolveDateRange(query.date_range, query.from_date, query.to_date);

        const filterPayload = {
            fromDate,
            toDate,
            customerId: parseInt(query.customer_id || 0, 10),
            status: query.status || '',
            paymentStatus: query.payment_status || '',
            rentalPeriodType: query.rental_period_type || '',
            productId: parseInt(query.product_id || 0, 10),
            saleType: query.sale_type || ''
        };

        const nowStr = new Date().toLocaleString('en-IN');

        let reportResult = { records: [], summary: {} };
        if (reportType === 'sales') {
            reportResult = await fetchSalesReportData(filterPayload);
        } else {
            reportResult = await fetchRentalsReportData(filterPayload);
        }

        // Render clean, printer-optimized standalone HTML view
        let pdfHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Sun PowerTools - ${reportType === 'sales' ? 'Sales' : 'Rentals'} Report</title>
    <link rel="stylesheet" href="/assets/css/bootstrap.min.css">
    <link rel="stylesheet" href="/assets/css/bootstrap-icons.min.css">
    <style>
        @page {
            size: A4 landscape;
            margin: 12mm;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            color: #212529;
            background: #ffffff;
            font-size: 11px;
            padding: 15px;
        }
        .report-header {
            border-bottom: 2px solid #0d6efd;
            padding-bottom: 10px;
            margin-bottom: 15px;
        }
        .report-title {
            color: #0d6efd;
            font-size: 20px;
            font-weight: 700;
        }
        .summary-box {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 6px;
            padding: 10px 15px;
            margin-bottom: 15px;
        }
        .table-report {
            width: 100%;
            border-collapse: collapse;
            font-size: 10.5px;
        }
        .table-report th {
            background-color: #0d6efd !important;
            color: #ffffff !important;
            padding: 6px 8px;
            border: 1px solid #0d6efd;
            font-weight: 600;
            text-align: left;
        }
        .table-report td {
            padding: 5px 8px;
            border: 1px solid #dee2e6;
            vertical-align: middle;
        }
        .table-report tr:nth-child(even) td {
            background-color: #f9fbfd;
        }
        .table-report tfoot tr td {
            background-color: #e9ecef !important;
            font-weight: 700;
            border-top: 2px solid #000000;
        }
        .no-print {
            margin-bottom: 15px;
        }
        @media print {
            .no-print { display: none !important; }
            body { padding: 0; }
            .table-report th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .table-report tfoot tr td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
    </style>
</head>
<body>
    <div class="no-print d-flex justify-content-between align-items-center bg-light p-2 rounded mb-3 border">
        <div>
            <button onclick="window.print()" class="btn btn-primary btn-sm fw-bold">
                <i class="bi bi-printer me-1"></i> Print / Save as PDF
            </button>
            <button onclick="window.close()" class="btn btn-outline-secondary btn-sm ms-2">
                Close Window
            </button>
        </div>
        <small class="text-muted">Tip: Choose "Save as PDF" in the print dialog to save the document.</small>
    </div>

    <div class="report-header d-flex justify-content-between align-items-end">
        <div>
            <div class="report-title">
                <i class="bi bi-tools text-primary me-2"></i>Sun PowerTools ERP
            </div>
            <div class="fs-6 fw-bold text-dark mt-1">
                ${reportType === 'sales' ? 'Sales Financial & Status Report' : 'Equipment Rental & Checkout Report'}
            </div>
        </div>
        <div class="text-end small">
            <div><strong>Date Filter:</strong> ${escapeXml(fromDate || 'All')} &mdash; ${escapeXml(toDate || 'All')}</div>
            <div class="text-muted">Generated: ${escapeXml(nowStr)}</div>
        </div>
    </div>

    <!-- Summary Metrics -->
    <div class="summary-box d-flex justify-content-between align-items-center flex-wrap gap-3">
        <div>Total Records: <strong>${reportResult.summary.totalRecords}</strong></div>
        ${reportType === 'sales' ? `
        <div>Total Sales: <strong class="text-primary">₹${reportResult.summary.totalSalesAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong></div>
        <div>Total Paid: <strong class="text-success">₹${reportResult.summary.totalPaidAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong></div>
        <div>Total Outstanding: <strong class="text-danger">₹${reportResult.summary.totalCreditAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong></div>
        <div>Fully Paid: <strong>${reportResult.summary.fullyPaidCount}</strong> &bull; Partial: <strong>${reportResult.summary.partiallyPaidCount}</strong></div>
        ` : `
        <div>Estimated Total: <strong class="text-primary">₹${reportResult.summary.totalRentalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong></div>
        <div>Advance Paid: <strong class="text-success">₹${reportResult.summary.totalAdvanceAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong></div>
        <div>Estimated Remaining: <strong class="text-danger">₹${reportResult.summary.totalOutstandingAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</strong></div>
        <div>Paid Upfront: <strong>${reportResult.summary.fullyPaidCount}</strong> &bull; Partial: <strong>${reportResult.summary.partiallyPaidCount}</strong></div>
        `}
    </div>

    <!-- Table -->
    <table class="table-report">
        <thead>
`;

        if (reportType === 'sales') {
            pdfHtml += `
            <tr>
                <th style="width: 30px;" class="text-center">#</th>
                <th>Sales Note #</th>
                <th>Date &amp; Time</th>
                <th>Customer</th>
                <th class="text-end">Total Amount (₹)</th>
                <th class="text-end">Paid Amount (₹)</th>
                <th class="text-end">Balance (₹)</th>
                <th>Sale Type</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
`;
            if (reportResult.records.length === 0) {
                pdfHtml += `<tr><td colspan="9" class="text-center py-4 text-muted">No records found for the selected filters.</td></tr>`;
            } else {
                reportResult.records.forEach((r, idx) => {
                    pdfHtml += `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td class="fw-semibold">${escapeXml(r.sales_note_no)}</td>
                <td>${escapeXml(r.sales_datetime)}</td>
                <td>${escapeXml(r.customer_name ? `${r.customer_code} - ${r.customer_name}` : 'Walk-in')}</td>
                <td class="text-end">₹${parseFloat(r.total_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end text-success">₹${parseFloat(r.paid_amount || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end fw-bold ${parseFloat(r.computed_balance || 0) > 0 ? 'text-danger' : 'text-muted'}">₹${parseFloat(r.computed_balance || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td>${escapeXml(r.sale_type_label)}</td>
                <td>${escapeXml(r.payment_status_label)}</td>
            </tr>
`;
                });
                pdfHtml += `
        </tbody>
        <tfoot>
            <tr>
                <td colspan="4">TOTALS (${reportResult.records.length} Records)</td>
                <td class="text-end">₹${reportResult.summary.totalSalesAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${reportResult.summary.totalPaidAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${reportResult.summary.totalCreditAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td colspan="2"></td>
            </tr>
        </tfoot>
`;
            }
        } else {
            pdfHtml += `
            <tr>
                <th style="width: 25px;" class="text-center">#</th>
                <th>Rental #</th>
                <th>Check-In Date</th>
                <th>Customer</th>
                <th>Equipment Product</th>
                <th>Unit</th>
                <th>Dur</th>
                <th class="text-end">Rate (₹)</th>
                <th class="text-end">Estimated (₹)</th>
                <th class="text-end">Advance (₹)</th>
                <th class="text-end">Remaining (₹)</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
`;
            if (reportResult.records.length === 0) {
                pdfHtml += `<tr><td colspan="12" class="text-center py-4 text-muted">No records found for the selected filters.</td></tr>`;
            } else {
                reportResult.records.forEach((r, idx) => {
                    pdfHtml += `
            <tr>
                <td class="text-center">${idx + 1}</td>
                <td class="fw-semibold">${escapeXml(r.rental_no)}</td>
                <td>${escapeXml(r.check_in_datetime)}</td>
                <td>${escapeXml(`${r.customer_code} - ${r.customer_name}`)}</td>
                <td>${escapeXml(`${r.product_code} - ${r.product_name}`)}</td>
                <td class="text-capitalize">${escapeXml(r.rental_period_type)}</td>
                <td>${escapeXml(r.estimated_duration)}</td>
                <td class="text-end">₹${parseFloat(r.rental_rate || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${r.estimated_total.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end text-success">₹${r.advance_paid.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end fw-bold ${r.remaining_balance > 0 ? 'text-danger' : 'text-muted'}">₹${r.remaining_balance.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td>${escapeXml(r.effective_status)}</td>
            </tr>
`;
                });
                pdfHtml += `
        </tbody>
        <tfoot>
            <tr>
                <td colspan="8">TOTALS (${reportResult.records.length} Records)</td>
                <td class="text-end">₹${reportResult.summary.totalRentalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${reportResult.summary.totalAdvanceAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td class="text-end">₹${reportResult.summary.totalOutstandingAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                <td></td>
            </tr>
        </tfoot>
`;
            }
        }

        pdfHtml += `
    </table>

    <div class="mt-4 text-center text-muted" style="font-size: 9px;">
        Sun PowerTools ERP Report &bull; Page 1 of 1 &bull; ${escapeXml(nowStr)}
    </div>
</body>
</html>`;

        res.send(pdfHtml);
    } catch (err) {
        console.error('exportPdf error:', err);
        res.status(500).send('Error generating PDF export: ' + err.message);
    }
};
