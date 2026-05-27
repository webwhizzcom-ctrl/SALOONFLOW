// src/components/CustomerDashboard.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";

export class CustomerDashboard {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.searchQuery = "";
    this.searchQueryLocal = "";
    this.showSuggestions = false;
    this.isEditing = false;
    this.showHistoryModal = false;

    // Full CRM View States
    this.crmSearchQuery = "";
    this.crmSearchQueryLocal = "";
    this.showAddCustomerModal = false;

    // Debounced searches to prevent rendering lag
    this.debouncedSearchCRM = this.debounce((query) => {
      this.crmSearchQuery = query;
      this.render();
    }, 150);

    this.debouncedSearchPOS = this.debounce((query) => {
      this.searchQuery = query;
      this.showSuggestions = query.trim().length > 0;
      this.render();
    }, 150);

    // Subscribe to state updates
    this.state.subscribe(() => this.render());
  }

  debounce(func, timeout = 150) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
  }

  init() {
    this.render();
  }

  handleSearch(e, crm = false) {
    const val = e.target.value;
    if (crm) {
      this.crmSearchQueryLocal = val;
      this.debouncedSearchCRM(val);
    } else {
      this.searchQueryLocal = val;
      this.showSuggestions = val.trim().length > 0;
      this.debouncedSearchPOS(val);
    }
  }

  selectCustomer(customer) {
    this.state.selectCustomer(customer);
    this.searchQuery = "";
    this.searchQueryLocal = "";
    this.showSuggestions = false;
    this.isEditing = false;
    this.render();
    const overlay = document.getElementById("drawer-customer-overlay");
    if (overlay) overlay.classList.remove("active");
  }

  toggleEdit() {
    this.isEditing = !this.isEditing;
    this.render();
  }

  saveProfile(e) {
    e.preventDefault();
    if (!this.state.activeCustomer) return;

    const customers = db.get("customers");
    const index = customers.findIndex(c => c.id === this.state.activeCustomer.id);
    if (index === -1) return;

    const form = e.target;
    customers[index].phone = form.elements.phone.value;
    customers[index].email = form.elements.email.value;
    customers[index].notes = form.elements.notes.value;

    db.set("customers", customers);
    this.state.activeCustomer = customers[index];
    this.isEditing = false;
    this.state.addNotification("Client profile updated.", "success");
    this.state.logAudit("Customer Profile Edited", null, { customerId: this.state.activeCustomer.id }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    this.render();
  }

  addNewCustomer(e) {
    e.preventDefault();
    const form = e.target;
    const name = form.elements.name.value.trim();
    const phone = form.elements.phone.value.trim();

    if (!name || !phone) {
      alert("Name and Phone are required.");
      return;
    }

    const customers = db.get("customers") || [];
    
    // Quick returning check
    const existing = customers.find(c => c.phone === phone);
    if (existing) {
      this.selectCustomer(existing);
      this.showAddCustomerModal = false;
      this.state.addNotification(`Returning guest ${existing.name} selected automatically.`, "info");
      this.render();
      return;
    }

    // Auto increment ID
    const newId = `CU-0${customers.length + 1}`;
    const newCust = {
      id: newId,
      name,
      phone,
      email: "",
      membershipID: "None",
      pointsBalance: 0,
      giftCardBalance: 0.0,
      totalVisits: 0,
      lastVisitDate: "Never",
      outstandingDues: 0.0,
      notes: ""
    };

    customers.push(newCust);
    db.set("customers", customers);

    this.state.addNotification(`Client ${name} registered successfully.`, "success");
    this.state.logAudit("Customer Created", null, { customerId: newId }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    
    // Auto select if in POS Checkout view
    if (this.state.currentView === "invoice-creator") {
      this.selectCustomer(newCust);
    }
    
    this.showAddCustomerModal = false;
    this.render();
  }

  renderAddModal() {
    if (!this.showAddCustomerModal) return "";
    return `
      <div class="modal-overlay active" id="add-customer-modal-overlay">
        <div class="modal-box" style="max-width: 380px;">
          <div class="modal-header" style="margin-bottom: 12px;">
            <h3 class="modal-title">Quick Register Client</h3>
            <button class="modal-close-btn" id="btn-close-add-modal">&times;</button>
          </div>
          <form id="add-customer-form">
            <div class="modal-body" style="display:flex; flex-direction:column; gap:14px;">
              <div class="form-group">
                <label class="form-label" style="font-size:0.75rem; font-weight:700;">Full Name</label>
                <input type="text" name="name" id="new-customer-name" class="form-input" placeholder="e.g. John Doe" style="font-size:1.05rem; padding:12px; height:48px;" required />
              </div>
              <div class="form-group">
                <label class="form-label" style="font-size:0.75rem; font-weight:700;">Phone Number</label>
                <input type="tel" name="phone" id="new-customer-phone" class="form-input" placeholder="e.g. 555-0100" style="font-size:1.05rem; padding:12px; height:48px;" required />
              </div>
              
              <!-- Match suggestions container -->
              <div id="customer-phone-matches" style="display:none; flex-direction:column; gap:6px; background-color:rgba(245, 158, 11, 0.08); border:1.5px solid rgba(245, 158, 11, 0.2); padding:10px; border-radius:var(--radius-md);">
                <span style="font-size:0.7rem; color:#d97706; font-weight:700; text-transform:uppercase;">Returning Guest Detected</span>
                <div id="customer-phone-matches-list" style="display:flex; flex-direction:column; gap:4px;"></div>
              </div>
            </div>
            <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-add-modal">Cancel</button>
              <button type="submit" class="btn btn-primary btn-sm">Create Profile</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  bindAddCustomerModalEvents() {
    if (!this.showAddCustomerModal) return;

    const nameInput = this.container.querySelector("#new-customer-name");
    const phoneInput = this.container.querySelector("#new-customer-phone");
    const matchesBox = this.container.querySelector("#customer-phone-matches");
    const matchesList = this.container.querySelector("#customer-phone-matches-list");

    setTimeout(() => {
      if (nameInput) nameInput.focus();
    }, 100);

    if (nameInput && phoneInput) {
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          phoneInput.focus();
        }
      });
    }

    if (phoneInput && matchesBox && matchesList) {
      phoneInput.addEventListener("input", (e) => {
        const val = e.target.value.trim();
        if (val.length >= 3) {
          const customers = db.get("customers") || [];
          const matched = customers.filter(c => c.phone.includes(val) || c.name.toLowerCase().includes(val.toLowerCase()));
          if (matched.length > 0) {
            matchesList.innerHTML = matched.map(c => `
              <div class="match-suggestion-row" data-id="${c.id}" style="display:flex; justify-content:space-between; align-items:center; padding:6px 8px; background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-sm); cursor:pointer; font-size:0.8rem; font-weight:600; transition:var(--transition-smooth);">
                <span>${c.name} (${c.phone})</span>
                <span style="font-size:0.65rem; color:var(--primary); text-transform:uppercase; font-weight:700;">Select</span>
              </div>
            `).join('');
            matchesBox.style.display = "flex";
          } else {
            matchesBox.style.display = "none";
          }
        } else {
          matchesBox.style.display = "none";
        }
      });

      matchesList.addEventListener("click", (e) => {
        const row = e.target.closest(".match-suggestion-row");
        if (row) {
          const id = row.dataset.id;
          const customers = db.get("customers") || [];
          const cust = customers.find(c => c.id === id);
          if (cust) {
            this.selectCustomer(cust);
            this.showAddCustomerModal = false;
            this.state.addNotification(`Returning guest ${cust.name} selected.`, "info");
            this.render();
          }
        }
      });
    }
  }

  openHistory() { this.showHistoryModal = true; this.render(); }
  closeHistory() { this.showHistoryModal = false; this.render(); }

  render() {
    const activeElementId = document.activeElement ? document.activeElement.id : null;
    const selectionStart = document.activeElement && 'selectionStart' in document.activeElement ? document.activeElement.selectionStart : null;
    const selectionEnd = document.activeElement && 'selectionEnd' in document.activeElement ? document.activeElement.selectionEnd : null;

    this.renderHtml();

    if (activeElementId) {
      const elementToFocus = this.container.querySelector(`#${activeElementId}`);
      if (elementToFocus) {
        elementToFocus.focus();
        if (selectionStart !== null && selectionEnd !== null && 'setSelectionRange' in elementToFocus) {
          try {
            elementToFocus.setSelectionRange(selectionStart, selectionEnd);
          } catch (e) {}
        }
      }
    }
  }

  renderHtml() {
    const view = this.state.currentView;
    const customer = this.state.activeCustomer;
    const customers = db.get("customers");

    // 1. POS Drawer CRM Widget Layout
    if (view === "invoice-creator") {
      let suggestions = [];
      if (this.searchQuery.trim().length > 0) {
        const q = this.searchQuery.toLowerCase();
        suggestions = customers.filter(
          c => c.name.toLowerCase().includes(q) || 
               c.phone.includes(q) || 
               c.id.toLowerCase().includes(q)
        );
      }

      this.container.innerHTML = `
        <div style="height: 100%; display: flex; flex-direction: column; gap: 16px; padding: var(--sp-1);">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-color); padding-bottom:12px;">
            <h3 style="margin:0; font-size:1.15rem; font-weight:700; display:flex; align-items:center; gap:8px;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:20px; height:20px; color:var(--primary);">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              Guest Selection
            </h3>
            <button class="drawer-close-btn" id="btn-close-customer-drawer" style="background:none; border:none; font-size:1.6rem; cursor:pointer; color:var(--text-muted); padding:4px;">&times;</button>
          </div>

          <!-- CRM Lookup search -->
          <div class="search-container" style="position:relative; margin-bottom:4px;">
            <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); width:16px; height:16px; color:var(--text-muted);">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input type="text" class="form-input" id="customer-search-input" placeholder="Search guests by name or phone..." value="${this.searchQueryLocal}" style="padding-left:36px; min-height:40px; height:40px; font-size:0.85rem;" autocomplete="off" />
            
            ${this.showSuggestions ? `
              <div class="suggestions-dropdown" style="position:absolute; width:100%; top:calc(100% + 4px); z-index:1000; box-shadow:var(--shadow-md);">
                ${suggestions.length === 0 ? `
                  <div style="padding:12px 14px; font-size:0.82rem; color:var(--text-muted); cursor:pointer;" id="btn-quick-add-search">
                    + Register New Client: "${this.searchQuery}"
                  </div>
                ` : suggestions.map(c => `
                  <div class="suggestion-item" data-id="${c.id}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--border-color); cursor:pointer;">
                    <div>
                      <div style="font-weight:600; font-size:0.85rem;">${c.name}</div>
                      <div style="font-size:0.72rem; color:var(--text-muted);">${c.phone}</div>
                    </div>
                    <span class="badge ${c.membershipID !== 'None' ? 'badge-gold' : 'badge-none'}" style="font-size:0.65rem;">${c.membershipID.split(' ')[0]}</span>
                  </div>
                `).join('')}
              </div>
            ` : ""}
          </div>

          <div style="flex-grow:1; display:flex; flex-direction:column; overflow-y:auto;">
            ${this.searchQuery.trim().length === 0 ? `
              <!-- Recent Guests List -->
              <div style="margin-top:12px; margin-bottom:12px;">
                <label class="form-label" style="font-size:0.75rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.3px; display:block; margin-bottom:8px;">Recent Customers</label>
                <div style="display:flex; flex-direction:column; gap:8px;">
                  ${customers.slice(-5).reverse().map(c => `
                    <div class="recent-guest-item" data-id="${c.id}" style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); cursor:pointer; transition:var(--transition-smooth);">
                      <div style="line-height:1.2;">
                        <div style="font-weight:600; font-size:0.85rem; color:var(--text-primary);">${c.name}</div>
                        <div style="font-size:0.72rem; color:var(--text-muted);">${c.phone}</div>
                      </div>
                      <span class="badge ${c.membershipID !== 'None' ? 'badge-gold' : 'badge-none'}" style="font-size:0.65rem;">${c.membershipID.split(' ')[0]}</span>
                    </div>
                  `).join('')}
                  ${customers.length === 0 ? `
                    <div style="text-align:center; padding:20px; color:var(--text-muted); font-size:0.8rem;">No registered guests yet.</div>
                  ` : ""}
                </div>
              </div>
            ` : `
              <div style="font-size:0.82rem; color:var(--text-muted); text-align:center; padding:20px 0;">
                Showing search results for "${this.searchQuery}"...
              </div>
            `}
          </div>

          <div style="margin-top:auto; padding-top:16px; border-top:1px solid var(--border-color);">
            <button class="btn btn-secondary btn-sm" id="btn-crm-add-customer-pos" style="width:100%; min-height:40px; font-size:0.85rem; display:flex; justify-content:center; align-items:center; gap:8px;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px; height:16px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Register New Client
            </button>
          </div>
        </div>

        <!-- Add Customer Sheet Popup modal -->
        ${this.renderAddModal()}

        <!-- History Modal overlay -->
        ${this.showHistoryModal && customer ? `
          <div class="modal-overlay active" id="history-modal-overlay">
            <div class="modal-box" style="max-width: 500px;">
              <div class="modal-header">
                <h3 class="modal-title">${customer.name} - Checkout History</h3>
                <button class="modal-close-btn" id="btn-close-history-modal">&times;</button>
              </div>
              <div class="modal-body" style="max-height:300px; overflow-y:auto; padding-right:4px;">
                
                <h5 style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:8px;">Appointments Scheduled</h5>
                ${db.get("appointments").filter(a => a.customerID === customer.id).length === 0 ? `
                  <div style="font-size:0.8rem; color:var(--text-secondary); margin-bottom:16px;">No bookings found.</div>
                ` : db.get("appointments").filter(a => a.customerID === customer.id).map(a => `
                  <div style="background-color:var(--bg-input); border:1px solid var(--border-color); padding:8px 12px; border-radius:8px; font-size:0.8rem; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                      <div style="font-weight:600;">${a.serviceName}</div>
                      <div style="font-size:0.7rem; color:var(--text-secondary);">${new Date(a.startTime).toLocaleDateString()} with ${a.stylistName}</div>
                    </div>
                    <span class="badge" style="background-color:var(--primary-glow); color:var(--primary); font-size:0.65rem;">Scheduled</span>
                  </div>
                `).join('')}

                <h5 style="font-size:0.75rem; text-transform:uppercase; color:var(--text-muted); border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:8px; margin-top:14px;">Transactions History</h5>
                ${db.get("invoices").filter(i => i.customerID === customer.id).length === 0 ? `
                  <div style="font-size:0.8rem; color:var(--text-secondary);">No past sales found.</div>
                ` : db.get("invoices").filter(i => i.customerID === customer.id).map(i => `
                  <div style="background-color:var(--bg-input); border:1px solid var(--border-color); padding:8px 12px; border-radius:8px; font-size:0.8rem; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                      <div style="font-weight:600; color:var(--primary);">${i.id}</div>
                      <div style="font-size:0.7rem; color:var(--text-secondary);">${new Date(i.createdAt).toLocaleDateString()} | Total: ${formatINR(i.total)}</div>
                    </div>
                    <span class="invoice-badge ${i.status.toLowerCase()}" style="font-size:0.65rem;">${i.status}</span>
                  </div>
                `).join('')}

              </div>
              <div class="modal-footer">
                <button class="btn btn-secondary btn-sm" id="btn-close-history-modal-footer">Close</button>
              </div>
            </div>
          </div>
        ` : ""}

        <!-- Add Customer Sheet Popup modal -->
        ${this.renderAddModal()}
      `;

      this.bindPOSEvents();
      return;
    }

    // 2. Full CRM View Layout
    if (view === "customers") {
      let filtered = [...customers];
      if (this.crmSearchQuery.trim().length > 0) {
        const q = this.crmSearchQuery.toLowerCase();
        filtered = customers.filter(
          c => c.name.toLowerCase().includes(q) || 
               c.phone.includes(q) || 
               c.email.toLowerCase().includes(q)
        );
      }

      this.container.innerHTML = `
        <div class="card-header">
          <h2 class="card-title">Customers CRM</h2>
          <button class="btn btn-primary btn-sm" id="btn-crm-add-customer-main">+ New Client</button>
        </div>

        <div class="crm-search-bar-row">
          <div class="topbar-search" style="width:100%; max-width:400px; background-color:var(--bg-input);">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input type="text" id="crm-search-field" placeholder="Search profiles by name or contact details..." value="${this.crmSearchQueryLocal}" />
          </div>
        </div>

        <div style="flex-grow:1; overflow-y:auto; border:1px solid var(--border-color); border-radius:var(--radius-md);">
          <table class="crm-table">
            <thead>
              <tr>
                <th>Customer ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Membership</th>
                <th>Points Balance</th>
                <th>Gift Card Bal</th>
                <th>Total Visits</th>
                <th>Last Visit</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.length === 0 ? `
                <tr>
                  <td colspan="9" style="text-align:center; padding:24px; color:var(--text-muted);">No customer profiles match.</td>
                </tr>
              ` : filtered.map(c => `
                <tr class="crm-customer-row" data-id="${c.id}">
                  <td style="font-weight:700; color:var(--primary);">${c.id}</td>
                  <td style="font-weight:600;">${c.name}</td>
                  <td>${c.phone}</td>
                  <td>${c.email}</td>
                  <td><span class="badge ${c.membershipID.includes('Gold') ? 'badge-gold' : c.membershipID.includes('Platinum') ? 'badge-platinum' : 'badge-none'}">${c.membershipID.replace(' VIP Annual', '').replace(' Monthly Pass', '')}</span></td>
                  <td style="color:var(--warning); font-weight:600;">${c.pointsBalance} pts</td>
                  <td style="color:var(--success); font-weight:600;">${formatINR(c.giftCardBalance)}</td>
                  <td>${c.totalVisits} visits</td>
                  <td style="color:var(--text-secondary);">${c.lastVisitDate}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Re-use same Add Customer Sheet Popup modal -->
        ${this.renderAddModal()}
      `;

      this.bindCRMEvents();
    }
  }

  bindPOSEvents() {
    const searchInput = this.container.querySelector("#customer-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => this.handleSearch(e));
      searchInput.addEventListener("focus", () => {
        if (this.searchQuery.trim().length > 0) {
          this.showSuggestions = true;
          this.render();
        }
      });
    }

    const suggestionsBox = this.container.querySelector(".suggestions-dropdown");
    if (suggestionsBox) {
      suggestionsBox.addEventListener("click", (e) => {
        const item = e.target.closest(".suggestion-item");
        if (item) {
          const id = item.dataset.id;
          const cust = db.get("customers").find(c => c.id === id);
          if (cust) this.selectCustomer(cust);
        }
        
        const quickAdd = e.target.closest("#btn-quick-add-search");
        if (quickAdd) {
          this.showAddCustomerModal = true;
          this.render();
          // Pre-populate search query in Name input field
          setTimeout(() => {
            const nameField = this.container.querySelector('input[name="name"]');
            if (nameField) {
              nameField.value = this.searchQuery;
              nameField.focus();
            }
          }, 100);
        }
      });
    }

    // Close suggestions on outside click
    const outsideClickListener = (e) => {
      if (searchInput && !searchInput.contains(e.target) && suggestionsBox && !suggestionsBox.contains(e.target)) {
        this.showSuggestions = false;
        this.render();
        document.removeEventListener("click", outsideClickListener);
      }
    };
    if (this.showSuggestions) {
      document.addEventListener("click", outsideClickListener);
    }

    const switchBtn = this.container.querySelector("#btn-change-customer");
    if (switchBtn) {
      switchBtn.addEventListener("click", () => {
        this.state.clearCustomer();
        this.isEditing = false;
      });
    }

    const addCustomerBtn = this.container.querySelector("#btn-crm-add-customer-pos");
    if (addCustomerBtn) {
      addCustomerBtn.addEventListener("click", () => {
        this.showAddCustomerModal = true;
        this.render();
      });
    }

    const editBtn = this.container.querySelector("#btn-edit-profile");
    if (editBtn) editBtn.addEventListener("click", () => this.toggleEdit());

    const cancelEditBtn = this.container.querySelector("#btn-cancel-edit");
    if (cancelEditBtn) cancelEditBtn.addEventListener("click", () => this.toggleEdit());

    const editForm = this.container.querySelector("#edit-profile-form");
    if (editForm) editForm.addEventListener("submit", (e) => this.saveProfile(e));

    const historyBtn = this.container.querySelector("#btn-view-history");
    if (historyBtn) historyBtn.addEventListener("click", () => this.openHistory());

    const closeHistoryBtn = this.container.querySelector("#btn-close-history-modal");
    if (closeHistoryBtn) closeHistoryBtn.addEventListener("click", () => this.closeHistory());

    const closeHistoryBtnFooter = this.container.querySelector("#btn-close-history-modal-footer");
    if (closeHistoryBtnFooter) closeHistoryBtnFooter.addEventListener("click", () => this.closeHistory());

    // Add Customer modal events
    const closeAddBtn = this.container.querySelector("#btn-close-add-modal");
    if (closeAddBtn) closeAddBtn.addEventListener("click", () => { this.showAddCustomerModal = false; this.render(); });

    const cancelAddBtn = this.container.querySelector("#btn-cancel-add-modal");
    if (cancelAddBtn) cancelAddBtn.addEventListener("click", () => { this.showAddCustomerModal = false; this.render(); });

    const addForm = this.container.querySelector("#add-customer-form");
    if (addForm) addForm.addEventListener("submit", (e) => this.addNewCustomer(e));

    const closeCustomerDrawerBtn = this.container.querySelector("#btn-close-customer-drawer");
    if (closeCustomerDrawerBtn) {
      closeCustomerDrawerBtn.addEventListener("click", () => {
        const overlay = document.getElementById("drawer-customer-overlay");
        if (overlay) overlay.classList.remove("active");
      });
    }

    this.container.querySelectorAll(".recent-guest-item").forEach(item => {
      item.addEventListener("click", () => {
        const id = item.dataset.id;
        const cust = db.get("customers").find(c => c.id === id);
        if (cust) this.selectCustomer(cust);
      });
    });

    this.bindAddCustomerModalEvents();
  }

  bindCRMEvents() {
    const searchInput = this.container.querySelector("#crm-search-field");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => this.handleSearch(e, true));
    }

    const addCustomerBtn = this.container.querySelector("#btn-crm-add-customer-main");
    if (addCustomerBtn) {
      addCustomerBtn.addEventListener("click", () => {
        this.showAddCustomerModal = true;
        this.render();
      });
    }

    const rows = this.container.querySelectorAll(".crm-customer-row");
    rows.forEach(row => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        const cust = db.get("customers").find(c => c.id === id);
        if (cust) {
          // Switch to Billing view and select customer
          this.state.setView("invoice-creator");
          this.state.selectCustomer(cust);
          this.state.addNotification(`Selected guest: ${cust.name} for billing.`, "info");
        }
      });
    });

    const closeAddBtn = this.container.querySelector("#btn-close-add-modal");
    if (closeAddBtn) closeAddBtn.addEventListener("click", () => { this.showAddCustomerModal = false; this.render(); });

    const cancelAddBtn = this.container.querySelector("#btn-cancel-add-modal");
    if (cancelAddBtn) cancelAddBtn.addEventListener("click", () => { this.showAddCustomerModal = false; this.render(); });

    const addForm = this.container.querySelector("#add-customer-form");
    if (addForm) addForm.addEventListener("submit", (e) => this.addNewCustomer(e));

    this.bindAddCustomerModalEvents();
  }
}
