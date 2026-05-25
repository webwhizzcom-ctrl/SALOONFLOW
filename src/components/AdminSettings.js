// src/components/AdminSettings.js
import { db } from "../db.js";

export class AdminSettings {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.activeSettingsTab = "tax"; // 'tax', 'gateways', 'template', 'security'
    this.isLightTheme = document.body.classList.contains("light-theme");

    // Subscribe to state updates
    this.state.subscribe(() => this.render());
  }

  init() {
    this.render();
  }

  switchSettingsTab(tab) {
    this.activeSettingsTab = tab;
    this.render();
  }

  saveTaxSettings(e) {
    e.preventDefault();
    const settings = db.get("settings");
    const form = e.target;

    settings.taxConfig.serviceTaxRate = parseFloat(form.elements.serviceTaxRate.value);
    settings.taxConfig.productTaxRate = parseFloat(form.elements.productTaxRate.value);
    settings.taxConfig.taxGroupName = form.elements.taxGroupName.value;
    settings.taxConfig.taxNumber = form.elements.taxNumber.value;

    db.set("settings", settings);
    this.state.addNotification("Tax settings updated successfully.", "success");
    this.state.logAudit("Tax Configs Modified", null, settings.taxConfig, "Admin");
    this.render();
  }

  saveTemplateSettings(e) {
    e.preventDefault();
    const settings = db.get("settings");
    const form = e.target;

    settings.templateConfig.headerTitle = form.elements.headerTitle.value;
    settings.templateConfig.headerSubtitle = form.elements.headerSubtitle.value;
    settings.templateConfig.headerPhone = form.elements.headerPhone.value;
    settings.templateConfig.footerText = form.elements.footerText.value;
    settings.templateConfig.fontFamily = form.elements.fontFamily.value;

    db.set("settings", settings);
    document.body.style.fontFamily = settings.templateConfig.fontFamily;

    this.state.addNotification("Receipt template styles applied.", "success");
    this.state.logAudit("Template Layout Modified", null, {}, "Admin");
    this.render();
  }

  saveSystemSettings(e) {
    e.preventDefault();
    const settings = db.get("settings");
    const form = e.target;

    const managerPIN = form.elements.managerPIN.value;
    const adminPIN = form.elements.adminPIN.value;
    const invoicePrefix = form.elements.invoicePrefix.value;

    if (!managerPIN || !adminPIN) {
      alert("Verification PIN codes cannot be empty.");
      return;
    }

    settings.securityCodes.managerPIN = managerPIN;
    settings.securityCodes.adminPIN = adminPIN;
    settings.invoicePrefix = invoicePrefix;

    db.set("settings", settings);
    this.state.addNotification("System configurations updated.", "success");
    this.state.logAudit("System PIN Configurations Modified", null, { invoicePrefix }, "Admin");
    this.render();
  }

  toggleGateway(gateId, enabled) {
    const settings = db.get("settings");
    const gate = settings.paymentGateways.find(g => g.id === gateId);
    if (gate) {
      gate.enabled = enabled;
      db.set("settings", settings);
      this.state.addNotification(`Gateway ${gate.name} is now ${enabled ? 'enabled' : 'disabled'}.`, "info");
      this.state.logAudit("Payment Gateway Toggled", null, { gateId, enabled }, "Admin");
    }
  }

  toggleTheme() {
    this.isLightTheme = !this.isLightTheme;
    if (this.isLightTheme) {
      document.body.classList.add("light-theme");
    } else {
      document.body.classList.remove("light-theme");
    }
    this.state.addNotification(`Active theme toggled to ${this.isLightTheme ? 'Light' : 'Dark'} mode.`, "info");
    this.render();
  }

  resetData() {
    if (confirm("WARNING: This will wipe out all customer databases, invoices, and audit logs. Proceed?")) {
      db.reset();
      this.state.clearCart();
      this.state.clearCustomer();
      this.state.addNotification("System database factory reset completed.", "warning");
      this.state.logAudit("Database Reset", null, {}, "Admin");
      this.render();
    }
  }

  exportBackup() {
    try {
      const backupData = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        data: {
          stylists: db.get("stylists") || [],
          services: db.get("services") || [],
          products: db.get("products") || [],
          memberships: db.get("memberships") || [],
          giftcards: db.get("giftcards") || [],
          customers: db.get("customers") || [],
          settings: db.get("settings") || {},
          invoices: db.get("invoices") || [],
          appointments: db.get("appointments") || [],
          audit_logs: db.get("audit_logs") || []
        }
      };

      const jsonString = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `SalonFlow_Backup_${dateStr}.json`;
      
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      this.state.addNotification("Backup exported successfully.", "success");
      this.state.logAudit("Backup Exported", null, { filename }, "Admin");
    } catch (e) {
      console.error(e);
      this.state.addNotification("Failed to export backup: " + e.message, "error");
    }
  }

  importBackup(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        
        // Validation check
        if (!backup || backup.version !== "1.0" || !backup.data || !backup.data.settings) {
          alert("Invalid backup file format. Please upload a valid SalonFlow backup JSON file.");
          return;
        }

        const confirmMsg = "CRITICAL WARNING:\n\n" +
          "Importing this backup will OVERWRITE all your existing customer records, appointments, invoice history, and settings.\n\n" +
          "This action CANNOT be undone.\n\n" +
          "Are you sure you want to restore the salon database from this backup?";
          
        if (confirm(confirmMsg)) {
          // Write all keys to local database
          const keys = [
            "stylists",
            "services",
            "products",
            "memberships",
            "giftcards",
            "customers",
            "settings",
            "invoices",
            "appointments",
            "audit_logs"
          ];

          keys.forEach(key => {
            if (backup.data[key] !== undefined) {
              db.set(key, backup.data[key]);
            }
          });

          this.state.clearCart();
          this.state.clearCustomer();
          this.state.addNotification("Database restored from backup successfully!", "success");
          this.state.logAudit("Backup Imported", null, { exportedAt: backup.exportedAt }, "Admin");
          
          setTimeout(() => {
            if (confirm("Database restore complete. The page needs to reload to apply all backup data. Reload now?")) {
              window.location.reload();
            }
          }, 500);
        }
      } catch (err) {
        alert("Failed to parse backup JSON: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  render() {
    if (this.state.currentView !== "admin-settings") return;

    const settings = db.get("settings");
    const tax = settings.taxConfig;
    const template = settings.templateConfig;
    const security = settings.securityCodes;

    this.container.innerHTML = `
      <div class="card-header" style="margin-bottom:12px;">
        <h2 class="card-title">Settings Control</h2>
      </div>

      <!-- Horizontal settings tabs -->
      <div class="settings-tabs-row" style="flex-shrink:0;">
        <div class="settings-tab-btn ${this.activeSettingsTab === 'tax' ? 'active' : ''}" data-tab="tax">Tax configuration</div>
        <div class="settings-tab-btn ${this.activeSettingsTab === 'gateways' ? 'active' : ''}" data-tab="gateways">Payment Gateways</div>
        <div class="settings-tab-btn ${this.activeSettingsTab === 'template' ? 'active' : ''}" data-tab="template">Receipt Template</div>
        <div class="settings-tab-btn ${this.activeSettingsTab === 'security' ? 'active' : ''}" data-tab="security">System & Security</div>
      </div>

      <div style="flex-grow:1; overflow-y:auto; padding-top:4px;">
        ${this.activeSettingsTab === 'tax' ? `
          <!-- Tax form configuration -->
          <div class="card" style="max-width:500px; animation:view-fade-in 0.2s ease;">
            <div style="font-weight:600; font-size:0.95rem; margin-bottom:14px; color:var(--text-secondary);">Configure Tax Rates</div>
            <form id="settings-tax-form">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div class="form-group">
                  <label class="form-label">Service Tax (%)</label>
                  <input type="number" name="serviceTaxRate" class="form-input" value="${tax.serviceTaxRate}" step="0.1" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Product Tax (%)</label>
                  <input type="number" name="productTaxRate" class="form-input" value="${tax.productTaxRate}" step="0.1" required />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Tax Label Name</label>
                <input type="text" name="taxGroupName" class="form-input" value="${tax.taxGroupName}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Tax Identification Number</label>
                <input type="text" name="taxNumber" class="form-input" value="${tax.taxNumber}" required />
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%; margin-top:8px;">Save Tax Settings</button>
            </form>
          </div>
        ` : ""}

        ${this.activeSettingsTab === 'gateways' ? `
          <!-- Payment gateway checkboxes toggling -->
          <div class="card" style="max-width:500px; animation:view-fade-in 0.2s ease;">
            <div style="font-weight:600; font-size:0.95rem; margin-bottom:14px; color:var(--text-secondary);">Enable / Disable Checkout Channels</div>
            <div style="display:flex; flex-direction:column; gap:12px;">
              ${settings.paymentGateways.map(g => `
                <div class="offline-toggle-container">
                  <span style="font-size:0.9rem; font-weight:500;">${g.name}</span>
                  <label class="switch">
                    <input type="checkbox" class="gateway-toggle" data-id="${g.id}" ${g.enabled ? 'checked' : ''} />
                    <span class="slider"></span>
                  </label>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ""}

        ${this.activeSettingsTab === 'template' ? `
          <!-- Receipt customization form template -->
          <div class="card" style="max-width:500px; animation:view-fade-in 0.2s ease;">
            <div style="font-weight:600; font-size:0.95rem; margin-bottom:14px; color:var(--text-secondary);">Customize Receipt Layout</div>
            <form id="settings-template-form">
              <div class="form-group">
                <label class="form-label">Receipt Header Title</label>
                <input type="text" name="headerTitle" class="form-input" value="${template.headerTitle}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Receipt Subtitle / Address</label>
                <input type="text" name="headerSubtitle" class="form-input" value="${template.headerSubtitle}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Header Phone Number</label>
                <input type="text" name="headerPhone" class="form-input" value="${template.headerPhone}" required />
              </div>
              <div class="form-group">
                <label class="form-label">Footer Remark Text</label>
                <textarea name="footerText" class="form-input" rows="2" style="resize:none;" required>${template.footerText}</textarea>
              </div>
              <div class="form-group">
                <label class="form-label">Layout Font style</label>
                <select name="fontFamily" class="form-select">
                  <option value="'Plus Jakarta Sans', sans-serif" ${template.fontFamily.includes('Jakarta') ? 'selected':''}>Plus Jakarta Sans (Modern)</option>
                  <option value="Outfit, sans-serif" ${template.fontFamily.includes('Outfit') ? 'selected':''}>Outfit (Display)</option>
                  <option value="Inter, sans-serif" ${template.fontFamily.includes('Inter') ? 'selected':''}>Inter (Sleek)</option>
                  <option value="monospace" ${template.fontFamily.includes('monospace') ? 'selected':''}>Monospace (Retro)</option>
                </select>
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%; margin-top:8px;">Apply Layout Styling</button>
            </form>
          </div>
        ` : ""}

        ${this.activeSettingsTab === 'security' ? `
          <!-- PIN adjust prefix configurations and reset db factory -->
          <div class="card" style="max-width:500px; animation:view-fade-in 0.2s ease; display:flex; flex-direction:column; gap:16px;">
            
            <form id="settings-system-form">
              <div style="font-weight:600; font-size:0.95rem; margin-bottom:12px; color:var(--text-secondary);">Security PIN overrides</div>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:10px;">
                <div class="form-group">
                  <label class="form-label">Manager PIN</label>
                  <input type="password" name="managerPIN" class="form-input" value="${security.managerPIN}" maxLength="20" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Admin PIN</label>
                  <input type="password" name="adminPIN" class="form-input" value="${security.adminPIN}" maxLength="20" required />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Invoice Prefix Sequence</label>
                <input type="text" name="invoicePrefix" class="form-input" value="${settings.invoicePrefix || ''}" required />
              </div>
              <button type="submit" class="btn btn-primary btn-sm" style="width:100%; margin-top:6px;">Save System Overrides</button>
            </form>

            <div style="border-top:1px solid var(--border-color); padding-top:14px; display:flex; flex-direction:column; gap:10px;">
              <div style="font-weight:600; font-size:0.95rem; color:var(--text-secondary);">Database Backup & Portability</div>
              <p style="font-size: 0.72rem; color: var(--text-secondary); margin: 0 0 4px 0;">Export full salon data to JSON or restore from a previous backup file.</p>
              
              <div style="display: flex; gap: 10px;">
                <button class="btn btn-secondary" id="btn-export-backup" style="flex: 1; min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                  📥 Export Backup
                </button>
                <button class="btn btn-secondary" id="btn-import-trigger" style="flex: 1; min-height: 38px; display: flex; align-items: center; justify-content: center; gap: 8px;">
                  📤 Import Backup
                </button>
              </div>
              <input type="file" id="input-import-backup" accept=".json" style="display: none;" />
            </div>

            <div style="border-top:1px solid var(--border-color); padding-top:14px; display:flex; flex-direction:column; gap:10px;">
              <div style="font-weight:600; font-size:0.95rem; color:var(--text-secondary);">Theme & Utilities</div>
              
              <div class="offline-toggle-container">
                <span style="font-size:0.9rem; font-weight:500;">Enable Light UI Mode</span>
                <label class="switch">
                  <input type="checkbox" id="theme-toggle" ${this.isLightTheme ? 'checked':''} />
                  <span class="slider"></span>
                </label>
              </div>

              <button class="btn btn-danger" id="btn-reset-db-settings" style="width:100%; margin-top:8px;">
                Factory Reset Application Data
              </button>
            </div>

          </div>
        ` : ""}
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Tabs switching click listener
    const tabs = this.container.querySelectorAll(".settings-tab-btn");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        this.switchSettingsTab(tab.dataset.tab);
      });
    });

    // Submissions tax form
    const taxForm = this.container.querySelector("#settings-tax-form");
    if (taxForm) {
      taxForm.addEventListener("submit", (e) => this.saveTaxSettings(e));
    }

    // Submissions template form
    const templateForm = this.container.querySelector("#settings-template-form");
    if (templateForm) {
      templateForm.addEventListener("submit", (e) => this.saveTemplateSettings(e));
    }

    // Submissions system PIN prefix form
    const systemForm = this.container.querySelector("#settings-system-form");
    if (systemForm) {
      systemForm.addEventListener("submit", (e) => this.saveSystemSettings(e));
    }

    // Checkbox toggling payment gateway
    const toggles = this.container.querySelectorAll(".gateway-toggle");
    toggles.forEach(toggle => {
      toggle.addEventListener("change", () => {
        const id = toggle.dataset.id;
        const checked = toggle.checked;
        this.toggleGateway(id, checked);
      });
    });

    // Theme toggling switch
    const themeToggle = this.container.querySelector("#theme-toggle");
    if (themeToggle) {
      themeToggle.addEventListener("change", () => this.toggleTheme());
    }

    // Reset database btn click
    const resetBtn = this.container.querySelector("#btn-reset-db-settings");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => this.resetData());
    }

    // Export Backup click
    const exportBtn = this.container.querySelector("#btn-export-backup");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => this.exportBackup());
    }

    // Import Backup click trigger
    const importTriggerBtn = this.container.querySelector("#btn-import-trigger");
    const importInput = this.container.querySelector("#input-import-backup");
    if (importTriggerBtn && importInput) {
      importTriggerBtn.addEventListener("click", () => importInput.click());
      importInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files.length > 0) {
          this.importBackup(e.target.files[0]);
        }
      });
    }
  }
}
