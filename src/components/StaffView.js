// src/components/StaffView.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";

export class StaffView {
  constructor(container, state) {
    this.container = container;
    this.state = state;

    // Subscribe to state updates
    this.state.subscribe(() => this.render());
  }

  init() {
    this.render();
  }

  toggleStylistStatus(stylistId) {
    const stylists = db.get("stylists");
    const idx = stylists.findIndex(s => s.id === stylistId);
    if (idx === -1) return;

    const currentStatus = stylists[idx].status;
    const nextStatus = currentStatus === "Active" ? "On Break" : "Active";
    stylists[idx].status = nextStatus;
    
    db.set("stylists", stylists);
    this.state.addNotification(`Staff member ${stylists[idx].name} marked as ${nextStatus}.`, "info");
    this.state.logAudit("Staff Status Changed", null, { stylistId, status: nextStatus }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    
    this.render();
  }

  render() {
    if (this.state.currentView !== "staff") return;

    const stylists = db.get("stylists");
    const analytics = this.state.getAnalyticsData();
    const rankings = analytics.rankings;

    const totalActive = stylists.filter(s => s.status === "Active").length;

    this.container.innerHTML = `
      <div class="card-header" style="margin-bottom:12px;">
        <h2 class="card-title">Staff Management</h2>
        <span class="badge badge-gold" style="font-size:0.75rem;">${totalActive} / ${stylists.length} Active Stylists</span>
      </div>

      <div style="flex-grow:1; overflow-y:auto; padding-bottom: 20px;">
        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">
          ${stylists.map(s => {
            // Find current commission earned
            const rank = rankings.find(r => r.id === s.id);
            const comm = rank ? rank.commissionEarned : 0;
            const isActive = s.status === "Active";

            return `
              <div class="card" style="flex-direction:row; justify-content:space-between; align-items:center; background-color:var(--bg-card); border-color:${isActive ? 'rgba(16,185,129,0.15)' : 'var(--border-color)'};">
                <div style="display:flex; align-items:center; gap:14px;">
                  <div class="staff-avatar" style="width:44px; height:44px; font-size:1.15rem; font-family:var(--font-display);">${s.name.split(' ')[0][0]}${s.name.split(' ')[1] ? s.name.split(' ')[1][0] : ''}</div>
                  <div style="display:flex; flex-direction:column; line-height:1.2;">
                    <span style="font-weight:600; font-size:0.95rem;">${s.name}</span>
                    <span style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:4px;">${s.title || s.role}</span>
                    <span style="font-size:0.7rem; color:var(--text-muted);">Shift: ${s.shifts}</span>
                  </div>
                </div>

                <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px;">
                  <div style="text-align:right;">
                    <div style="font-size:0.68rem; color:var(--text-secondary); font-weight:600; text-transform:uppercase;">Daily Split Comm</div>
                    <div style="font-size:1.1rem; font-weight:700; color:var(--primary); font-family:var(--font-display);">${formatINR(comm)}</div>
                  </div>

                  <!-- Status slider toggle switch -->
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:0.72rem; color:${isActive ? 'var(--success)' : 'var(--text-muted)'}; font-weight:600;">
                      ${s.status}
                    </span>
                    <label class="switch" style="width:34px; height:18px;">
                      <input type="checkbox" class="staff-toggle" data-id="${s.id}" ${isActive ? 'checked' : ''} />
                      <span class="slider" style="border-radius:18px; before:{width:14px; height:14px;}"></span>
                    </label>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    const toggles = this.container.querySelectorAll(".staff-toggle");
    toggles.forEach(toggle => {
      toggle.addEventListener("change", () => {
        const id = toggle.dataset.id;
        this.toggleStylistStatus(id);
      });
    });
  }
}
