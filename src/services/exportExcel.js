// src/services/exportExcel.js
import ExcelJS from "exceljs";
import { db } from "../db.js";

// Helper to format Date string into readable Local Time
function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return "N/A";
  }
}

// Fetch Logo as ArrayBuffer for ExcelJS image attachment
async function fetchLogoArrayBuffer() {
  try {
    const response = await fetch('/logo.png');
    if (!response.ok) throw new Error("Logo image status not OK");
    return await response.arrayBuffer();
  } catch (e) {
    console.error("Could not fetch logo image buffer: ", e);
    return null;
  }
}

export async function generateEODReportExcel(date) {
  if (!date) {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    date = `${yyyy}-${mm}-${dd}`;
  }
  // 1. Gather all required daily data
  const invoices = db.get("invoices").filter(i => i.createdAt.startsWith(date) && i.status === "Final");
  const allAppointments = db.get("appointments") || [];
  const dailyAppts = allAppointments.filter(a => a.startTime.startsWith(date));
  const activeAppointments = dailyAppts.filter(a => a.status !== "Canceled");
  const cancelledAppointments = dailyAppts.filter(a => a.status === "Canceled").length;
  
  // -- Section 1 Metrics calculations
  const totalRevenue = invoices.reduce((sum, i) => sum + i.total, 0);
  const totalAppointments = dailyAppts.length;
  const totalDiscountsGiven = invoices.reduce((sum, i) => sum + i.discount, 0);
  
  let totalCashPayments = 0;
  let totalUPIPayments = 0;
  let totalCardPayments = 0;
  let totalRedemptions = 0;
  
  invoices.forEach(inv => {
    inv.payments.forEach(p => {
      const method = p.method.toLowerCase();
      if (method.includes("cash") || method.includes("manual")) {
        totalCashPayments += p.amount;
      } else if (method.includes("upi") || method.includes("online") || method.includes("qr")) {
        totalUPIPayments += p.amount;
      } else if (method.includes("card") || method.includes("pos") || method.includes("terminal")) {
        totalCardPayments += p.amount;
      } else {
        totalRedemptions += p.amount;
      }
    });
  });

  // 2. Initialize ExcelJS Workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SalonFlow Admin";
  workbook.lastModifiedBy = "SalonFlow System";
  workbook.created = new Date();
  workbook.modified = new Date();

  // Load logo buffer
  const logoBuffer = await fetchLogoArrayBuffer();

  // Define Shared Styling Rules
  const titleFont = { name: 'Arial', size: 16, bold: true, color: { argb: '1E1B4B' } };
  const subtitleFont = { name: 'Arial', size: 10, italic: true, color: { argb: '4B5563' } };
  const headerFont = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E1B4B' } }; // Professional Navy
  const totalsFont = { name: 'Arial', size: 11, bold: true, color: { argb: '1E1B4B' } };
  const totalsFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0E7FF' } }; // Light Indigo
  
  const thinBorder = {
    top: { style: 'thin', color: { argb: 'E5E7EB' } },
    left: { style: 'thin', color: { argb: 'E5E7EB' } },
    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
    right: { style: 'thin', color: { argb: 'E5E7EB' } }
  };
  
  const doubleBottomBorder = {
    top: { style: 'thin', color: { argb: '9CA3AF' } },
    bottom: { style: 'double', color: { argb: '1E1B4B' } }
  };

  const rupeeDecimalFormat = '"₹"#,##0.00';
  const timestampStr = new Date().toLocaleString('en-IN');

  // ==========================================
  // --- SHEET 1: SUMMARY ---
  // ==========================================
  const wsSummary = workbook.addWorksheet("Summary", { views: [{ showGridLines: true }] });
  
  wsSummary.columns = [
    { width: 32 },
    { width: 28 }
  ];

  // Title block
  wsSummary.getCell('A1').value = "ASMITA'S BEAUTY SALON & ACADEMY";
  wsSummary.getCell('A1').font = titleFont;
  wsSummary.getCell('A2').value = "End-Of-Day Daily Business Summary Report";
  wsSummary.getCell('A2').font = subtitleFont;
  wsSummary.getCell('A3').value = `Report Date: ${date}`;
  wsSummary.getCell('A3').font = { name: 'Arial', size: 10, bold: true };
  wsSummary.getCell('A4').value = `Generated: ${timestampStr}`;
  wsSummary.getCell('A4').font = { name: 'Arial', size: 9, color: { argb: '6B7280' } };

  // Spacing
  wsSummary.addRow([]);
  wsSummary.addRow([]);

  // Section Header
  const summaryHeaderRow = wsSummary.addRow(["BUSINESS PERFORMANCE METRIC", "VALUE / TOTAL"]);
  summaryHeaderRow.getCell(1).font = headerFont;
  summaryHeaderRow.getCell(1).fill = headerFill;
  summaryHeaderRow.getCell(1).alignment = { horizontal: 'left' };
  summaryHeaderRow.getCell(2).font = headerFont;
  summaryHeaderRow.getCell(2).fill = headerFill;
  summaryHeaderRow.getCell(2).alignment = { horizontal: 'right' };
  
  const summaryData = [
    ["Total Revenue (Gross Settled)", totalRevenue, "currency_bold"],
    ["Total Appointments Logged", totalAppointments, "number"],
    ["Cancelled Appointments", cancelledAppointments, "number"],
    ["Total Discounts Granted", totalDiscountsGiven, "currency"],
    ["Total Cash Collected", totalCashPayments, "currency"],
    ["Total UPI / Online Payments", totalUPIPayments, "currency"],
    ["Total Card Terminals", totalCardPayments, "currency"],
    ["Other Points/Gift Redemptions", totalRedemptions, "currency"],
    ["Generated Timestamp", timestampStr, "text"]
  ];

  summaryData.forEach(item => {
    const row = wsSummary.addRow([item[0], item[1]]);
    row.height = 22;
    const cellLbl = row.getCell(1);
    const cellVal = row.getCell(2);
    
    cellLbl.border = thinBorder;
    cellVal.border = thinBorder;
    cellLbl.font = { name: 'Arial', size: 10, bold: true };

    if (item[2].startsWith("currency")) {
      cellVal.numFmt = rupeeDecimalFormat;
      cellVal.alignment = { horizontal: 'right', vertical: 'middle' };
      if (item[2] === "currency_bold") {
        cellLbl.fill = totalsFill;
        cellVal.fill = totalsFill;
        cellLbl.font = totalsFont;
        cellVal.font = totalsFont;
      }
    } else if (item[2] === "number") {
      cellVal.alignment = { horizontal: 'right', vertical: 'middle' };
      cellVal.font = { name: 'Arial', size: 10 };
    } else {
      cellVal.alignment = { horizontal: 'right', vertical: 'middle' };
      cellVal.font = { name: 'Arial', size: 10, italic: true };
    }
  });

  wsSummary.addRow([]);
  wsSummary.addRow([]);
  const notesRow = wsSummary.addRow(["Disclaimer: This daily summary report compiles final checkouts. Verify raw transaction splits with payment terminal sheets before final bookkeeping."]);
  wsSummary.mergeCells(`A${notesRow.number}:B${notesRow.number}`);
  wsSummary.getCell(`A${notesRow.number}`).font = { name: 'Arial', size: 9, italic: true, color: { argb: '9CA3AF' } };

  // ==========================================
  // --- SHEET 2: APPOINTMENTS ---
  // ==========================================
  const wsAppts = workbook.addWorksheet("Appointments", { views: [{ showGridLines: true }] });
  
  wsAppts.addRow(["DAILY APPOINTMENT LEDGER (Active & Cancelled)", "", "", "", "", ""]);
  wsAppts.mergeCells('A1:F1');
  wsAppts.getCell('A1').font = titleFont;
  wsAppts.addRow([`Report Date: ${date} | Total Bookings: ${dailyAppts.length}`]);
  wsAppts.mergeCells('A2:F2');
  wsAppts.getCell('A2').font = subtitleFont;
  wsAppts.addRow([]);

  const apptHeaders = ["Time Slot", "Customer Name", "Stylist", "Services Booked", "Status", "Notes"];
  const apptHeaderRow = wsAppts.addRow(apptHeaders);
  apptHeaderRow.height = 25;
  apptHeaderRow.eachCell(cell => {
    cell.font = headerFont;
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  dailyAppts.forEach(appt => {
    const formattedStart = formatTime(appt.startTime);
    const formattedEnd = formatTime(appt.endTime);
    const timeStr = `${formattedStart} - ${formattedEnd}`;
    
    const row = wsAppts.addRow([
      timeStr,
      appt.customerName || "Walk-in",
      appt.stylistName || "Unassigned",
      appt.serviceName,
      appt.status,
      appt.notes || ""
    ]);
    row.height = 20;
    row.eachCell(cell => {
      cell.font = { name: 'Arial', size: 10 };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle' };
    });
  });

  // ==========================================
  // --- SHEET 3: PAYMENTS ---
  // ==========================================
  const wsPayments = workbook.addWorksheet("Payments", { views: [{ showGridLines: true }] });
  
  wsPayments.addRow(["DAILY TRANSACTION & PAYMENT LEDGER", "", "", "", "", "", "", "", ""]);
  wsPayments.mergeCells('A1:I1');
  wsPayments.getCell('A1').font = titleFont;
  wsPayments.addRow([`Report Date: ${date} | Total Transactions: ${invoices.length}`]);
  wsPayments.mergeCells('A2:I2');
  wsPayments.getCell('A2').font = subtitleFont;
  wsPayments.addRow([]);

  const payHeaders = [
    "Invoice Number", 
    "Customer Name", 
    "Payment Method", 
    "Subtotal", 
    "Discount Given", 
    "Tax Collected", 
    "Final Total", 
    "Payment Status", 
    "Timestamp"
  ];
  const payHeaderRow = wsPayments.addRow(payHeaders);
  payHeaderRow.height = 25;
  payHeaderRow.eachCell(cell => {
    cell.font = headerFont;
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  let sumSubtotal = 0;
  let sumDiscount = 0;
  let sumTax = 0;
  let sumTotal = 0;

  invoices.forEach(inv => {
    sumSubtotal += inv.subtotal;
    sumDiscount += inv.discount;
    sumTax += inv.tax;
    sumTotal += inv.total;

    const paymentMethods = inv.payments.map(p => p.method).join(" + ") || "None";
    const formattedTimeStr = new Date(inv.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const row = wsPayments.addRow([
      inv.id,
      inv.customerName || "Walk-in",
      paymentMethods,
      inv.subtotal,
      inv.discount,
      inv.tax,
      inv.total,
      inv.status,
      formattedTimeStr
    ]);
    
    row.height = 20;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle' };
      
      if ([4, 5, 6, 7].includes(colNumber)) {
        cell.numFmt = rupeeDecimalFormat;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  });

  // Totals Row
  const payTotalRow = wsPayments.addRow([
    "GRAND TOTALS",
    "",
    "",
    sumSubtotal,
    sumDiscount,
    sumTax,
    sumTotal,
    "",
    ""
  ]);
  payTotalRow.height = 22;
  payTotalRow.eachCell((cell, colNumber) => {
    cell.font = totalsFont;
    cell.fill = totalsFill;
    cell.border = doubleBottomBorder;
    cell.alignment = { vertical: 'middle' };
    
    if ([4, 5, 6, 7].includes(colNumber)) {
      cell.numFmt = rupeeDecimalFormat;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  });

  // ==========================================
  // --- SHEET 4: SERVICES REPORT ---
  // ==========================================
  const wsServices = workbook.addWorksheet("Services Report", { views: [{ showGridLines: true }] });
  
  wsServices.addRow(["DAILY SERVICES & RETAIL SALES BREAKDOWN", "", "", "", "", "", ""]);
  wsServices.mergeCells('A1:G1');
  wsServices.getCell('A1').font = titleFont;
  wsServices.addRow([`Report Date: ${date}`]);
  wsServices.mergeCells('A2:G2');
  wsServices.getCell('A2').font = subtitleFont;
  wsServices.addRow([]);

  const servicesHeaders = [
    "Item ID",
    "Item Name", 
    "Category Type", 
    "Quantity Sold", 
    "Unit Price",
    "Gross Revenue",
    "Discounts Granted",
    "Net Revenue"
  ];
  const servHeaderRow = wsServices.addRow(servicesHeaders);
  servHeaderRow.height = 25;
  servHeaderRow.eachCell(cell => {
    cell.font = headerFont;
    cell.fill = headerFill;
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
  });

  // Aggregate items
  const servicesReportMap = {};
  invoices.forEach(inv => {
    inv.items.forEach(item => {
      const key = item.itemID || item.id || "misc";
      if (!servicesReportMap[key]) {
        servicesReportMap[key] = {
          id: key,
          name: item.name,
          type: item.type || "Service",
          qty: 0,
          price: item.price,
          gross: 0,
          discount: 0,
          net: 0
        };
      }
      const lineQty = item.qty;
      const lineGross = item.price * lineQty;
      const lineDiscount = (item.discount || 0) * lineQty;
      const lineNet = Math.max(0, lineGross - lineDiscount);

      servicesReportMap[key].qty += lineQty;
      servicesReportMap[key].gross += lineGross;
      servicesReportMap[key].discount += lineDiscount;
      servicesReportMap[key].net += lineNet;
    });
  });

  let sumSvcQty = 0;
  let sumSvcGross = 0;
  let sumSvcDiscount = 0;
  let sumSvcNet = 0;

  Object.values(servicesReportMap).forEach(item => {
    sumSvcQty += item.qty;
    sumSvcGross += item.gross;
    sumSvcDiscount += item.discount;
    sumSvcNet += item.net;

    const row = wsServices.addRow([
      item.id,
      item.name,
      item.type,
      item.qty,
      item.price,
      item.gross,
      item.discount,
      item.net
    ]);
    row.height = 20;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: 'Arial', size: 10 };
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle' };

      if (colNumber === 4) {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      if ([5, 6, 7, 8].includes(colNumber)) {
        cell.numFmt = rupeeDecimalFormat;
        cell.alignment = { horizontal: 'right', vertical: 'middle' };
      }
    });
  });

  // Totals Row
  const servTotalRow = wsServices.addRow([
    "GRAND TOTAL SALES",
    "",
    "",
    sumSvcQty,
    "",
    sumSvcGross,
    sumSvcDiscount,
    sumSvcNet
  ]);
  servTotalRow.height = 22;
  servTotalRow.eachCell((cell, colNumber) => {
    cell.font = totalsFont;
    cell.fill = totalsFill;
    cell.border = doubleBottomBorder;
    cell.alignment = { vertical: 'middle' };

    if (colNumber === 4) {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    if ([5, 6, 7, 8].includes(colNumber)) {
      cell.numFmt = rupeeDecimalFormat;
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
    }
  });

  // ==========================================
  // --- AUTO-SIZE COLUMN WIDTHS ---
  // ==========================================
  const allSheets = [wsSummary, wsAppts, wsPayments, wsServices];
  allSheets.forEach(ws => {
    ws.columns.forEach(column => {
      let maxCellLength = 0;
      column.eachCell({ includeEmpty: true }, cell => {
        let valStr = "";
        if (cell.value !== null && cell.value !== undefined) {
          if (typeof cell.value === 'object') {
            if (cell.value.text) {
              valStr = cell.value.text.toString();
            }
          } else {
            valStr = cell.value.toString();
          }
        }
        if (valStr.length > maxCellLength) {
          maxCellLength = valStr.length;
        }
      });
      if (ws !== wsSummary) {
        column.width = Math.max(maxCellLength + 4, 12);
      }
    });
  });

  // 3. Generate file and trigger browser download
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  
  const filename = `SalonFlow_EOD_Report_${date}.xlsx`;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  // Return generated details to log in history
  return {
    filename,
    date,
    revenue: totalRevenue,
    appointments: totalAppointments,
    cancelledAppointments,
    discounts: totalDiscountsGiven,
    cash: totalCashPayments,
    upi: totalUPIPayments,
    card: totalCardPayments,
    timestamp: timestampStr
  };
}
