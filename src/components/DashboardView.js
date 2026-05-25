// src/components/DashboardView.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";
import {
  exportDailyPaymentSheet,
  exportEODRevenueReport,
  exportStaffCommissionReport,
  exportPaymentMethodSummary,
  exportAppointmentsSummary,
  exportTaxSummaryReport
} from "../utils/exporter.js";
import { generateEODReportExcel } from "../services/exportExcel.js";

export class DashboardView {
  constructor(container, state) {
    this.container = container;
    this.state = state;

    // Subscribe to state updates
    this.state.subscribe(() => this.render());
  }

  init() {
    this.render();
  }

  render() {
    const data = this.state.getAnalyticsData();
    const invoices = db.get("invoices").slice(-4).reverse(); // Get last 4 invoices
    const appts = db.get("appointments");
    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    const isAdmin = role === "admin";

    // Calculate weekly revenue trend from real finalized invoices
    const allInvoices = db.get("invoices") || [];
    const finalInvoices = allInvoices.filter(i => i.status === "Final");
    
    const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const weeklyData = [];
    
    // Get last 7 days
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split("T")[0];
      const dayName = daysOfWeek[d.getDay()];
      
      // Sum revenue for this day
      const dayRevenue = finalInvoices
        .filter(inv => inv.createdAt.startsWith(dateStr))
        .reduce((sum, inv) => sum + inv.total, 0);
        
      weeklyData.push({ day: dayName, rev: dayRevenue, dateStr });
    }

    const maxWeekly = Math.max(...weeklyData.map(d => d.rev));
    
    // Services vs Products percentage
    const totalSales = data.serviceSales + data.productSales;
    const servicePercent = totalSales > 0 ? Math.round((data.serviceSales / totalSales) * 100) : 100;
    const productPercent = totalSales > 0 ? Math.round((data.productSales / totalSales) * 100) : 0;

    this.container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:20px; height:100%; overflow-y:auto; padding-right:4px;">
        
        <!-- Top analytical stat KPI cards -->
        <div class="dashboard-stats-grid">
          
          <div class="metric-card">
            <span class="metric-lbl">Daily Revenue</span>
            <span class="metric-val">${formatINR(data.revenue)}</span>
            <span style="font-size:0.7rem; color:var(--text-muted); margin-top: 4px;">Gross settled sales today</span>
          </div>

          <div class="metric-card">
            <span class="metric-lbl">Appointments Today</span>
            <span class="metric-val">${data.bookings} Booked</span>
            <span style="font-size:0.7rem; color:var(--text-muted); margin-top: 4px;">Active bookings in schedule</span>
          </div>

          <div class="metric-card">
            <span class="metric-lbl">Average Ticket</span>
            <span class="metric-val">${formatINR(data.avgTicket)}</span>
            <span style="font-size:0.7rem; color:var(--text-muted); margin-top: 4px;">Average order value today</span>
          </div>

          <div class="metric-card">
            <span class="metric-lbl">Retail Sales</span>
            <span class="metric-val">${formatINR(data.productSales)}</span>
            <span style="font-size:0.7rem; color:var(--text-muted); margin-top: 4px;">${productPercent}% of total revenue</span>
          </div>

        </div>

        <!-- Charts bar graphs and split categories -->
        <div class="charts-grid" style="flex-shrink: 0;">
          
          <!-- Bar Graph Chart -->
          <div class="card" style="justify-content: space-between;">
            <div class="card-header" style="margin-bottom:8px;">
              <h3 class="card-title">Weekly Revenue Trend</h3>
            </div>
            
            <div class="chart-bar-container" style="position:relative;">
              ${maxWeekly === 0 ? `
                <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.85rem; color:var(--text-muted); font-weight:600; background:rgba(0,0,0,0.05); border-radius:var(--radius-md);">
                  No sales recorded this week
                </div>
              ` : ""}
              ${weeklyData.map(d => {
                const heightPercent = maxWeekly > 0 ? (d.rev / maxWeekly) * 100 : 5;
                return `
                  <div class="chart-bar-col">
                    <div class="chart-bar-fill" style="height: ${heightPercent}%;">
                      <span class="chart-bar-tooltip">${formatINR(d.rev)}</span>
                    </div>
                    <span class="chart-bar-lbl">${d.day}</span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>

          <!-- Sales Categories splits meter -->
          <div class="card" style="justify-content: space-between;">
            <div class="card-header" style="margin-bottom:8px;">
              <h3 class="card-title">Sales Distribution</h3>
            </div>

            <div style="display:flex; flex-direction:column; gap:16px;">
              <!-- Progress services bar -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:600; margin-bottom:4px;">
                  <span>Services</span>
                  <span>${formatINR(data.serviceSales)} (${servicePercent}%)</span>
                </div>
                <div style="height:8px; border-radius:4px; background-color:var(--bg-input); overflow:hidden;">
                  <div style="height:100%; width:${servicePercent}%; background:var(--primary-gradient); border-radius:4px;"></div>
                </div>
              </div>

              <!-- Progress products bar -->
              <div>
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:600; margin-bottom:4px;">
                  <span>Retail Products</span>
                  <span>${formatINR(data.productSales)} (${productPercent}%)</span>
                </div>
                <div style="height:8px; border-radius:4px; background-color:var(--bg-input); overflow:hidden;">
                  <div style="height:100%; width:${productPercent}%; background-color:var(--success); border-radius:4px;"></div>
                </div>
              </div>
            </div>

            <div style="font-size:0.75rem; color:var(--text-muted); text-align:center; padding-top:10px;">
              Distribution compiled from ${data.invoicesCount} invoices.
            </div>
          </div>

        </div>

        <!-- Leaderboard ranks and recent feed -->
        <div style="display:grid; grid-template-columns:1.2fr 2fr; gap:20px; flex-shrink: 0;">
          
          <!-- Stylist performance ranking -->
          <div class="card">
            <div class="card-header" style="margin-bottom:12px;">
              <h3 class="card-title">Stylist Commission Leaderboard</h3>
            </div>
            
            <div style="display:flex; flex-direction:column; gap:10px; overflow-y:auto; max-height:220px; padding-right:2px;">
              ${data.rankings.length === 0 ? `
                <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.8rem;">No commissions earned today.</div>
              ` : data.rankings.map((st, index) => `
                <div style="display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px 14px;">
                  <div style="display:flex; align-items:center; gap:12px;">
                    <div style="font-weight:700; color:var(--text-muted); font-size:0.95rem; width:16px;">#${index+1}</div>
                    <div style="display:flex; flex-direction:column; line-height:1.2;">
                       <span style="font-weight:600; font-size:0.85rem;">${st.name}</span>
                       <span style="font-size:0.7rem; color:var(--text-secondary);">${st.title || st.role}</span>
                    </div>
                  </div>
                  <span style="font-weight:700; color:var(--primary); font-size:0.9rem;">${formatINR(st.commissionEarned)}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Recent transaction activity log -->
          <div class="card" style="display:flex; flex-direction:column;">
            <div class="card-header" style="margin-bottom:12px;">
              <h3 class="card-title">Recent Billing Operations</h3>
            </div>
            
            <div style="overflow-x:auto; flex-grow:1;">
              <table style="width:100%; border-collapse:collapse; text-align:left; font-size:0.82rem;">
                <thead>
                  <tr style="border-bottom:1px solid var(--border-color);">
                    <th style="padding:8px 12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Invoice</th>
                    <th style="padding:8px 12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Customer</th>
                    <th style="padding:8px 12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Method</th>
                    <th style="padding:8px 12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Amount</th>
                    <th style="padding:8px 12px; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${invoices.length === 0 ? `
                    <tr>
                      <td colspan="5" style="text-align:center; padding:24px; color:var(--text-muted);">No sales recorded yet.</td>
                    </tr>
                  ` : invoices.map(inv => `
                    <tr style="border-bottom:1px solid var(--border-color); cursor:pointer;" class="recent-invoice-row" data-invoice-id="${inv.id}">
                      <td style="padding:10px 12px; font-weight:700; color:var(--primary);">${inv.id}</td>
                      <td style="padding:10px 12px; font-weight:600;">${inv.customerName}</td>
                      <td style="padding:10px 12px; color:var(--text-secondary);">${inv.payments[0] ? inv.payments[0].method.split(' ')[0] : "Draft"}</td>
                      <td style="padding:10px 12px; font-weight:700;">${formatINR(inv.total)}</td>
                      <td style="padding:10px 12px;">
                        <span class="invoice-badge ${inv.status.toLowerCase()}" style="font-size:0.65rem; padding:2px 6px;">${inv.status}</span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        <!-- Admin Reports & Excel Export Center — ADMIN ONLY -->
        ${isAdmin ? `
        <div class="card" style="margin-top: 10px; flex-shrink: 0; border: 1.5px solid rgba(99,102,241,0.3); background: linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(168,85,247,0.04) 100%);">
          <!-- Prominent EOD Report Button -->
          <div style="padding: 20px 20px 0 20px;">
            <button id="btn-eod-hero-report" class="btn btn-primary" style="width:100%; min-height:52px; font-size:1rem; font-weight:700; gap:12px; background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%); box-shadow:0 4px 18px rgba(99,102,241,0.35); letter-spacing:0.3px; border:none;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:22px;height:22px;flex-shrink:0;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Generate End Day Report
            </button>
            <p style="font-size:0.72rem; color:var(--text-muted); text-align:center; margin-top:6px;">Downloads a complete SalonFlow_EOD_Report_${new Date().toISOString().split('T')[0]}.xlsx</p>
          </div>

          <div class="card-header" style="margin: 16px 20px 12px;">
            <h3 class="card-title" style="display: flex; align-items: center; gap: 8px;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width: 20px; height: 20px; color: var(--primary);">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              Individual Report Exports
            </h3>
          </div>
          <div class="export-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; padding: 0 20px 20px;">
            <button class="btn btn-secondary btn-sm btn-export" data-report="daily-payment" style="text-align: left; padding: 12px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; border: 1.5px solid var(--border-color); background-color: var(--bg-card); cursor: pointer; transition: var(--transition-smooth); width: 100%;">
              <strong style="color: var(--text-primary); font-size: 0.85rem;">Daily Payment Sheet</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: left;">Detailed list of today's payments</div>
            </button>
            <button class="btn btn-secondary btn-sm btn-export" data-report="eod-revenue" style="text-align: left; padding: 12px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; border: 1.5px solid var(--border-color); background-color: var(--bg-card); cursor: pointer; transition: var(--transition-smooth); width: 100%;">
              <strong style="color: var(--text-primary); font-size: 0.85rem;">End-of-Day Revenue</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: left;">Daily settlement sheet & breakdown</div>
            </button>
            <button class="btn btn-secondary btn-sm btn-export" data-report="staff-commission" style="text-align: left; padding: 12px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; border: 1.5px solid var(--border-color); background-color: var(--bg-card); cursor: pointer; transition: var(--transition-smooth); width: 100%;">
              <strong style="color: var(--text-primary); font-size: 0.85rem;">Staff Commissions</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: left;">Earnings split commission details</div>
            </button>
            <button class="btn btn-secondary btn-sm btn-export" data-report="payment-method" style="text-align: left; padding: 12px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; border: 1.5px solid var(--border-color); background-color: var(--bg-card); cursor: pointer; transition: var(--transition-smooth); width: 100%;">
              <strong style="color: var(--text-primary); font-size: 0.85rem;">Payment Method Summary</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: left;">Volume collected by gateway</div>
            </button>
            <button class="btn btn-secondary btn-sm btn-export" data-report="appointments-summary" style="text-align: left; padding: 12px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; border: 1.5px solid var(--border-color); background-color: var(--bg-card); cursor: pointer; transition: var(--transition-smooth); width: 100%;">
              <strong style="color: var(--text-primary); font-size: 0.85rem;">Appointment Summary</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: left;">Logs and statuses of guest bookings</div>
            </button>
            <button class="btn btn-secondary btn-sm btn-export" data-report="tax-summary" style="text-align: left; padding: 12px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; border: 1.5px solid var(--border-color); background-color: var(--bg-card); cursor: pointer; transition: var(--transition-smooth); width: 100%;">
              <strong style="color: var(--text-primary); font-size: 0.85rem;">Tax Summary Report</strong>
              <div style="font-size: 0.7rem; color: var(--text-muted); text-align: left;">Net sales vs VAT collections</div>
            </button>
          </div>
        </div>
        ` : ""}

      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Row clicking shortcuts view invoice details in Ledger
    const rows = this.container.querySelectorAll(".recent-invoice-row");
    rows.forEach(row => {
      row.addEventListener("click", () => {
        const id = row.dataset.invoiceId;
        this.state.setView("invoice-history");
        setTimeout(() => {
          const histRow = document.querySelector(`.crm-table tbody tr[data-id="${id}"]`);
          if (histRow) histRow.click();
        }, 100);
      });
    });

    // Hero EOD report button
    const eodHeroBtn = this.container.querySelector("#btn-eod-hero-report");
    if (eodHeroBtn) {
      eodHeroBtn.addEventListener("click", async () => {
        const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
        if (role !== "admin") {
          this.state.addNotification("Access Denied: Admin only.", "error");
          return;
        }
        eodHeroBtn.disabled = true;
        eodHeroBtn.innerHTML = `<span class="spinner"></span><span>Generating Report...</span>`;
        try {
          const today = new Date();
          const yyyy = today.getFullYear();
          const mm = String(today.getMonth() + 1).padStart(2, '0');
          const dd = String(today.getDate()).padStart(2, '0');
          const targetDate = `${yyyy}-${mm}-${dd}`;
          
          await generateEODReportExcel(targetDate);
          this.state.addNotification("End-of-Day Excel Report downloaded successfully.", "success");
        } catch (e) {
          this.state.addNotification("Report generation failed. Please try again.", "error");
        } finally {
          this.render();
        }
      });
    }

    // Bind Excel export clicks
    const exportBtns = this.container.querySelectorAll(".btn-export");
    exportBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
        if (role !== "admin") {
          this.state.addNotification("Access Denied: Reports are admin only.", "error");
          return;
        }
        const report = btn.dataset.report;
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const targetDate = `${yyyy}-${mm}-${dd}`;

        if (report === "daily-payment") {
          exportDailyPaymentSheet(targetDate);
          this.state.addNotification("Downloaded Daily Payment Sheet Excel Report.", "success");
        } else if (report === "eod-revenue") {
          generateEODReportExcel(targetDate);
          this.state.addNotification("Downloaded End-of-Day Settlement Excel Report.", "success");
        } else if (report === "staff-commission") {
          exportStaffCommissionReport(targetDate);
          this.state.addNotification("Downloaded Staff Commission Excel Report.", "success");
        } else if (report === "payment-method") {
          exportPaymentMethodSummary(targetDate);
          this.state.addNotification("Downloaded Payment Method Summary Excel Report.", "success");
        } else if (report === "appointments-summary") {
          exportAppointmentsSummary(targetDate);
          this.state.addNotification("Downloaded Appointments Summary Excel Report.", "success");
        } else if (report === "tax-summary") {
          exportTaxSummaryReport(targetDate);
          this.state.addNotification("Downloaded Tax Summary Excel Report.", "success");
        }
      });
    });
  }
}
