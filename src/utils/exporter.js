import { db } from "../db.js";
import { formatINR } from "./currency.js";

function getTodayDateStr() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function triggerBlobDownload(htmlContent, filename) {
  const blob = new Blob([htmlContent], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const getStyles = () => `
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 20px; color: #333; }
    .branding-header { font-size: 20px; font-weight: bold; color: #1e1b4b; margin-bottom: 2px; }
    .branding-subtitle { font-size: 11px; color: #6b7280; margin-bottom: 8px; }
    .report-title { font-size: 14px; font-weight: bold; color: #4f46e5; margin-bottom: 12px; text-transform: uppercase; border-bottom: 2px solid #4f46e5; padding-bottom: 4px; }
    .meta-table { font-size: 11px; color: #4b5563; margin-bottom: 15px; border-collapse: collapse; }
    .meta-table td { padding: 4px 8px 4px 0; border: none; }
    table.data-table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 10px; }
    table.data-table th { background-color: #4f46e5; color: #ffffff; font-weight: bold; text-align: left; padding: 10px 8px; border: 1px solid #e5e7eb; }
    table.data-table td { padding: 8px; border: 1px solid #e5e7eb; }
    table.data-table tr:nth-child(even) { background-color: #f9fafb; }
    .totals-row { font-weight: bold; background-color: #f3f4f6 !important; }
    .currency-cell { text-align: right; }
    .number-cell { text-align: center; }
  </style>
`;

export function exportDailyPaymentSheet(date = getTodayDateStr()) {
  const invoices = db.get("invoices").filter(i => i.createdAt.startsWith(date) && i.status === "Final");
  const settings = db.get("settings");
  
  let totalPayments = 0;
  const paymentRows = [];

  invoices.forEach(inv => {
    inv.payments.forEach(pay => {
      totalPayments += pay.amount;
      paymentRows.push(`
        <tr>
          <td>${inv.id}</td>
          <td>${inv.customerName}</td>
          <td>${pay.method}</td>
          <td class="currency-cell">${formatINR(pay.amount)}</td>
          <td>${pay.transactionID}</td>
          <td>${new Date(inv.createdAt).toLocaleTimeString()}</td>
        </tr>
      `);
    });
  });

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" />${getStyles()}</head>
    <body>
      <div class="branding-header">${settings.templateConfig.headerTitle}</div>
      <div class="branding-subtitle">${settings.templateConfig.headerSubtitle}</div>
      <div class="report-title">Daily Payment Sheet - ${date}</div>
      
      <table class="meta-table">
        <tr><td><strong>Date Generated:</strong></td><td>${new Date().toLocaleString()}</td></tr>
        <tr><td><strong>Total Invoices:</strong></td><td>${invoices.length}</td></tr>
        <tr><td><strong>Total Payments Logged:</strong></td><td>${paymentRows.length}</td></tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice ID</th>
            <th>Customer</th>
            <th>Payment Method</th>
            <th style="text-align: right;">Amount</th>
            <th>Transaction ID</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${paymentRows.length > 0 ? paymentRows.join("") : `<tr><td colspan="6" style="text-align: center; color: #9ca3af;">No payments logged for this date.</td></tr>`}
          <tr class="totals-row">
            <td colspan="3" style="text-align: right;">TOTAL PAYMENTS COLLECTED</td>
            <td class="currency-cell">${formatINR(totalPayments)}</td>
            <td colspan="2"></td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `;

  triggerBlobDownload(html, `SalonFlow_Daily_Payments_${date}.xlsx`);
}

export function exportEODRevenueReport(date = getTodayDateStr()) {
  const invoices = db.get("invoices").filter(i => i.createdAt.startsWith(date) && i.status === "Final");
  const settings = db.get("settings");
  
  let totalRevenue = 0;
  let totalDiscounts = 0;
  let totalTax = 0;
  
  const paymentBreakdown = {
    "POS Terminal": 0,
    "Cash / Manual Check": 0,
    "Online Stored Card": 0,
    "Points Redemption": 0,
    "Gift Card Balance": 0
  };

  const rows = invoices.map(inv => {
    totalRevenue += inv.total;
    totalDiscounts += inv.discount;
    totalTax += inv.tax;
    
    inv.payments.forEach(p => {
      if (paymentBreakdown[p.method] !== undefined) {
        paymentBreakdown[p.method] += p.amount;
      }
    });

    const stylistNames = inv.items.map(item => {
      let sName = item.stylistName.split(' ')[0];
      if (item.splitStylistName) {
        sName += ` & ${item.splitStylistName.split(' ')[0]} (${100 - item.splitRatio}%)`;
      }
      return sName;
    }).join(", ");

    const serviceNames = inv.items.map(item => `${item.name} (${item.qty}x)`).join(", ");
    const paymentMethods = inv.payments.map(p => p.method).join(" + ") || "None";
    const amountPaid = inv.payments.reduce((sum, p) => sum + p.amount, 0);

    return `
      <tr>
        <td>${inv.id}</td>
        <td>${inv.customerName}</td>
        <td>${stylistNames}</td>
        <td>${serviceNames}</td>
        <td>${paymentMethods}</td>
        <td class="currency-cell">${formatINR(amountPaid)}</td>
        <td class="currency-cell">${formatINR(inv.discount)}</td>
        <td class="currency-cell">${formatINR(inv.tax)}</td>
        <td class="currency-cell">${formatINR(inv.total)}</td>
        <td>${new Date(inv.createdAt).toLocaleTimeString()}</td>
      </tr>
    `;
  }).join("");

  const breakdownRows = Object.keys(paymentBreakdown).map(method => `
    <tr>
      <td colspan="5" style="text-align: right; font-weight: bold;">${method} Total</td>
      <td colspan="5" class="currency-cell" style="font-weight: bold;">${formatINR(paymentBreakdown[method])}</td>
    </tr>
  `).join("");

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" />${getStyles()}</head>
    <body>
      <div class="branding-header">${settings.templateConfig.headerTitle}</div>
      <div class="branding-subtitle">${settings.templateConfig.headerSubtitle}</div>
      <div class="report-title">End-of-Day Settlement Report - ${date}</div>
      
      <table class="meta-table">
        <tr><td><strong>Date Generated:</strong></td><td>${new Date().toLocaleString()}</td></tr>
        <tr><td><strong>Total Bookings Finalized:</strong></td><td>${invoices.length}</td></tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th>Invoice Number</th>
            <th>Customer Name</th>
            <th>Stylist</th>
            <th>Services</th>
            <th>Payment Method</th>
            <th style="text-align: right;">Amount</th>
            <th style="text-align: right;">Discounts</th>
            <th style="text-align: right;">Taxes</th>
            <th style="text-align: right;">Final Total</th>
            <th>Timestamp</th>
          </tr>
        </thead>
        <tbody>
          ${invoices.length > 0 ? rows : `<tr><td colspan="10" style="text-align: center; color: #9ca3af;">No completed invoices for this date.</td></tr>`}
          
          <tr class="totals-row">
            <td colspan="5" style="text-align: right;">GRAND TOTALS</td>
            <td class="currency-cell">${formatINR(invoices.reduce((sum, i) => sum + i.payments.reduce((s, p) => s + p.amount, 0), 0))}</td>
            <td class="currency-cell">${formatINR(totalDiscounts)}</td>
            <td class="currency-cell">${formatINR(totalTax)}</td>
            <td class="currency-cell">${formatINR(totalRevenue)}</td>
            <td>-</td>
          </tr>
          
          <tr><td colspan="10" style="border: none; height: 16px;"></td></tr>
          
          <tr style="background-color: #4f46e5; color: white; font-weight: bold;">
            <td colspan="5" style="text-align: right;">FINANCIAL SUMMARY METRICS</td>
            <td colspan="5">Value</td>
          </tr>
          <tr>
            <td colspan="5" style="text-align: right; font-weight: bold;">Total Daily Gross Revenue (Settled)</td>
            <td colspan="5" class="currency-cell" style="font-weight: bold; color: #10b981;">${formatINR(totalRevenue)}</td>
          </tr>
          <tr>
            <td colspan="5" style="text-align: right; font-weight: bold;">Total Discounts Granted</td>
            <td colspan="5" class="currency-cell" style="font-weight: bold; color: #ef4444;">${formatINR(totalDiscounts)}</td>
          </tr>
          <tr>
            <td colspan="5" style="text-align: right; font-weight: bold;">Total Tax Collected</td>
            <td colspan="5" class="currency-cell" style="font-weight: bold; color: #3b82f6;">${formatINR(totalTax)}</td>
          </tr>
          ${breakdownRows}
        </tbody>
      </table>
    </body>
    </html>
  `;

  triggerBlobDownload(html, `SalonFlow_EOD_Report_${date}.xlsx`);
}

export function exportStaffCommissionReport(date = getTodayDateStr()) {
  const invoices = db.get("invoices").filter(i => i.createdAt.startsWith(date) && i.status === "Final");
  const stylists = db.get("stylists");
  const settings = db.get("settings");
  
  const stylistStats = stylists.reduce((acc, s) => {
    acc[s.id] = {
      name: s.name,
      role: s.role,
      title: s.title || s.role,
      commissionRate: s.commissionRate,
      serviceSales: 0,
      commissionEarned: 0,
      tipsReceived: 0
    };
    return acc;
  }, {});

  invoices.forEach(inv => {
    inv.items.forEach(item => {
      const itemRev = (item.price - (item.discount || 0)) * item.qty;
      const primaryShare = itemRev * (item.splitRatio / 100);
      
      if (stylistStats[item.stylistID]) {
        stylistStats[item.stylistID].serviceSales += primaryShare;
        stylistStats[item.stylistID].commissionEarned += primaryShare * stylistStats[item.stylistID].commissionRate;
      }

      if (item.splitStylistID && stylistStats[item.splitStylistID]) {
        const secondaryShare = itemRev * ((100 - item.splitRatio) / 100);
        stylistStats[item.splitStylistID].serviceSales += secondaryShare;
        stylistStats[item.splitStylistID].commissionEarned += secondaryShare * stylistStats[item.splitStylistID].commissionRate;
      }
    });

    // Award tips to the primary stylist of the first service item (approximate tip allocation)
    if (inv.tip > 0 && inv.items.length > 0) {
      const primaryStylist = inv.items[0].stylistID;
      if (stylistStats[primaryStylist]) {
        stylistStats[primaryStylist].tipsReceived += inv.tip;
      }
    }
  });

  let totalSales = 0;
  let totalCommissions = 0;
  let totalTips = 0;
  let totalPayout = 0;

  const rows = Object.values(stylistStats).map(s => {
    const stylistPayout = s.commissionEarned + s.tipsReceived;
    totalSales += s.serviceSales;
    totalCommissions += s.commissionEarned;
    totalTips += s.tipsReceived;
    totalPayout += stylistPayout;

    return `
      <tr>
        <td>${s.name}</td>
        <td>${s.title}</td>
        <td class="number-cell">${(s.commissionRate * 100).toFixed(0)}%</td>
        <td class="currency-cell">${formatINR(s.serviceSales)}</td>
        <td class="currency-cell">${formatINR(s.commissionEarned)}</td>
        <td class="currency-cell">${formatINR(s.tipsReceived)}</td>
        <td class="currency-cell" style="font-weight: bold; color: #4f46e5;">${formatINR(stylistPayout)}</td>
      </tr>
    `;
  }).join("");

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" />${getStyles()}</head>
    <body>
      <div class="branding-header">${settings.templateConfig.headerTitle}</div>
      <div class="branding-subtitle">${settings.templateConfig.headerSubtitle}</div>
      <div class="report-title">Staff Commission & Earnings Report - ${date}</div>
      
      <table class="meta-table">
        <tr><td><strong>Date Generated:</strong></td><td>${new Date().toLocaleString()}</td></tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th>Stylist Name</th>
            <th>Designation</th>
            <th style="text-align: center;">Commission Rate</th>
            <th style="text-align: right;">Service Sales (Split Volume)</th>
            <th style="text-align: right;">Commission Earned</th>
            <th style="text-align: right;">Tips Received</th>
            <th style="text-align: right;">Estimated Net Payout</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="totals-row">
            <td colspan="3" style="text-align: right;">TOTAL STYLIST PAYROLL</td>
            <td class="currency-cell">${formatINR(totalSales)}</td>
            <td class="currency-cell">${formatINR(totalCommissions)}</td>
            <td class="currency-cell">${formatINR(totalTips)}</td>
            <td class="currency-cell" style="color: #4f46e5;">${formatINR(totalPayout)}</td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `;

  triggerBlobDownload(html, `SalonFlow_Staff_Commissions_${date}.xlsx`);
}

export function exportPaymentMethodSummary(date = getTodayDateStr()) {
  const invoices = db.get("invoices").filter(i => i.createdAt.startsWith(date) && i.status === "Final");
  const settings = db.get("settings");

  const methods = {
    "POS Terminal": { count: 0, amount: 0 },
    "Cash / Manual Check": { count: 0, amount: 0 },
    "Online Stored Card": { count: 0, amount: 0 },
    "Points Redemption": { count: 0, amount: 0 },
    "Gift Card Balance": { count: 0, amount: 0 }
  };

  let grandTotal = 0;
  let totalTransactions = 0;

  invoices.forEach(inv => {
    inv.payments.forEach(p => {
      if (methods[p.method]) {
        methods[p.method].count++;
        methods[p.method].amount += p.amount;
        grandTotal += p.amount;
        totalTransactions++;
      }
    });
  });

  const rows = Object.keys(methods).map(name => {
    const m = methods[name];
    const percentage = grandTotal > 0 ? ((m.amount / grandTotal) * 100).toFixed(1) : "0.0";
    return `
      <tr>
        <td>${name}</td>
        <td class="number-cell">${m.count}</td>
        <td class="currency-cell">${formatINR(m.amount)}</td>
        <td class="number-cell">${percentage}%</td>
      </tr>
    `;
  }).join("");

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" />${getStyles()}</head>
    <body>
      <div class="branding-header">${settings.templateConfig.headerTitle}</div>
      <div class="branding-subtitle">${settings.templateConfig.headerSubtitle}</div>
      <div class="report-title">Payment Method Volume Summary - ${date}</div>
      
      <table class="meta-table">
        <tr><td><strong>Date Generated:</strong></td><td>${new Date().toLocaleString()}</td></tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th>Payment Method</th>
            <th style="text-align: center;">Transaction Count</th>
            <th style="text-align: right;">Total Volume Collected</th>
            <th style="text-align: center;">Sales Percentage</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="totals-row">
            <td style="text-align: right;">GRAND TOTAL COLLECTED</td>
            <td class="number-cell">${totalTransactions}</td>
            <td class="currency-cell">${formatINR(grandTotal)}</td>
            <td class="number-cell">100%</td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `;

  triggerBlobDownload(html, `SalonFlow_Payment_Methods_${date}.xlsx`);
}

export function exportAppointmentsSummary(date = getTodayDateStr()) {
  const appointments = db.get("appointments").filter(a => a.startTime.startsWith(date));
  const settings = db.get("settings");

  const rows = appointments.map(a => {
    const formattedStart = new Date(a.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedEnd = new Date(a.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `
      <tr>
        <td>${a.id}</td>
        <td>${a.customerName}</td>
        <td>${a.serviceName}</td>
        <td>${a.stylistName}</td>
        <td>${formattedStart} - ${formattedEnd}</td>
        <td style="font-weight: 600;">${a.status}</td>
      </tr>
    `;
  }).join("");

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" />${getStyles()}</head>
    <body>
      <div class="branding-header">${settings.templateConfig.headerTitle}</div>
      <div class="branding-subtitle">${settings.templateConfig.headerSubtitle}</div>
      <div class="report-title">Appointment Summary Log - ${date}</div>
      
      <table class="meta-table">
        <tr><td><strong>Date Generated:</strong></td><td>${new Date().toLocaleString()}</td></tr>
        <tr><td><strong>Total Appointments Booked:</strong></td><td>${appointments.length}</td></tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th>Appointment ID</th>
            <th>Customer Name</th>
            <th>Service Name</th>
            <th>Assigned Stylist</th>
            <th>Time Slot</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${appointments.length > 0 ? rows : `<tr><td colspan="6" style="text-align: center; color: #9ca3af;">No appointments logged for this date.</td></tr>`}
        </tbody>
      </table>
    </body>
    </html>
  `;

  triggerBlobDownload(html, `SalonFlow_Appointments_${date}.xlsx`);
}

export function exportTaxSummaryReport(date = getTodayDateStr()) {
  const invoices = db.get("invoices").filter(i => i.createdAt.startsWith(date) && i.status === "Final");
  const settings = db.get("settings");
  
  const taxStats = {
    "Service": { netSales: 0, taxCollected: 0, rate: settings.taxConfig.serviceTaxRate },
    "Product": { netSales: 0, taxCollected: 0, rate: settings.taxConfig.productTaxRate },
    "Membership": { netSales: 0, taxCollected: 0, rate: settings.taxConfig.membershipTaxRate },
    "GiftCard": { netSales: 0, taxCollected: 0, rate: settings.taxConfig.giftCardTaxRate }
  };

  invoices.forEach(inv => {
    inv.items.forEach(item => {
      const lineOriginalTotal = item.price * item.qty;
      const lineDiscount = item.discount * item.qty;
      const lineSubtotal = Math.max(0, lineOriginalTotal - lineDiscount);

      if (taxStats[item.type]) {
        taxStats[item.type].netSales += lineSubtotal;
        
        // Recalculate tax collected
        const taxRate = taxStats[item.type].rate;
        taxStats[item.type].taxCollected += lineSubtotal * (taxRate / 100);
      }
    });
  });

  let totalNetSales = 0;
  let totalTaxCollected = 0;
  let totalGrossSales = 0;

  const rows = Object.keys(taxStats).map(type => {
    const s = taxStats[type];
    const gross = s.netSales + s.taxCollected;
    totalNetSales += s.netSales;
    totalTaxCollected += s.taxCollected;
    totalGrossSales += gross;

    return `
      <tr>
        <td><strong>${type} Sales</strong></td>
        <td class="number-cell">${s.rate}%</td>
        <td class="currency-cell">${formatINR(s.netSales)}</td>
        <td class="currency-cell">${formatINR(s.taxCollected)}</td>
        <td class="currency-cell" style="font-weight: bold;">${formatINR(gross)}</td>
      </tr>
    `;
  }).join("");

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8" />${getStyles()}</head>
    <body>
      <div class="branding-header">${settings.templateConfig.headerTitle}</div>
      <div class="branding-subtitle">${settings.templateConfig.headerSubtitle}</div>
      <div class="report-title">Tax Collection & Summary Report - ${date}</div>
      
      <table class="meta-table">
        <tr><td><strong>Date Generated:</strong></td><td>${new Date().toLocaleString()}</td></tr>
        <tr><td><strong>Tax Authority Name:</strong></td><td>${settings.taxConfig.taxGroupName}</td></tr>
        <tr><td><strong>Tax Registry Number:</strong></td><td>${settings.taxConfig.taxNumber}</td></tr>
      </table>

      <table class="data-table">
        <thead>
          <tr>
            <th>Item Category</th>
            <th style="text-align: center;">Tax Rate</th>
            <th style="text-align: right;">Net Sales Volume</th>
            <th style="text-align: right;">Tax Amount Collected</th>
            <th style="text-align: right;">Gross Sales Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="totals-row">
            <td colspan="2" style="text-align: right;">GRAND TAX TOTALS</td>
            <td class="currency-cell">${formatINR(totalNetSales)}</td>
            <td class="currency-cell" style="color: #3b82f6;">${formatINR(totalTaxCollected)}</td>
            <td class="currency-cell">${formatINR(totalGrossSales)}</td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `;

  triggerBlobDownload(html, `SalonFlow_Tax_Summary_${date}.xlsx`);
}
