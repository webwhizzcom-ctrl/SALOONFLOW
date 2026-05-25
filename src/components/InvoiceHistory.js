// src/components/InvoiceHistory.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";

export class InvoiceHistory {
  constructor(container, state) {
    this.container = container;
    this.state = state;

    // Filters & Search
    this.searchQuery = "";
    this.filterDateStart = "";
    this.filterDateEnd = "";
    this.filterPayment = "all";
    this.filterStylist = "all";

    // Selected detail view
    this.selectedInvoice = null;

    // Local adjustment buffers (before pin auth)
    this.cancelReason = "";
    this.activeEditCartId = null;
    this.editItemPrice = 0;
    this.editItemDiscount = 0;
    this.editItemSplitRatio = 100;
    this.editItemSplitStylist = "";

    // Subscribe to state updates
    this.state.subscribe(() => {
      this.render();
      this.renderAuditDrawer();
    });
  }

  init() {
    this.render();
  }

  setFilter(field, value) {
    this[field] = value;
    this.render();
  }

  triggerCancelInvoice(reason) {
    if (!reason.trim()) {
      alert("Please provide a cancellation reason.");
      return;
    }
    this.cancelReason = reason;

    // Call global PIN auth helper from window
    if (window.askSupervisorPIN) {
      window.askSupervisorPIN((pin) => {
        this.executeCancellation(pin);
      });
    }
  }

  executeCancellation(pin) {
    if (!this.selectedInvoice) return;

    const id = this.selectedInvoice.id;
    const success = this.state.cancelInvoice(id, pin, this.cancelReason);
    if (success) {
      // Refund products stock
      const products = db.get("products");
      let changed = false;
      this.selectedInvoice.items.forEach(item => {
        if (item.type === "Product") {
          const prod = products.find(p => p.id === item.itemID);
          if (prod) {
            prod.stock += item.qty;
            changed = true;
          }
        }
      });
      if (changed) db.set("products", products);

      this.selectedInvoice = null;
      
      // Close drawer
      const drawer = document.getElementById("drawer-audit-overlay");
      if (drawer) drawer.classList.remove("active");
    }
  }

  triggerEditCartItem(cartItemId, price, discount, splitStylistID, splitRatio) {
    this.activeEditCartId = cartItemId;
    this.editItemPrice = price;
    this.editItemDiscount = discount;
    this.editItemSplitStylist = splitStylistID;
    this.editItemSplitRatio = splitRatio;
    this.renderAuditDrawer(); // open the adjust popup form in drawer
  }

  submitItemEdits(e) {
    e.preventDefault();
    if (!this.selectedInvoice || !this.activeEditCartId) return;

    if (this.editItemDiscount > this.editItemPrice) {
      alert("Discount exceeds price override!");
      return;
    }

    if (window.askSupervisorPIN) {
      window.askSupervisorPIN((pin) => {
        this.executeItemEdits(pin);
      });
    }
  }

  executeItemEdits(pin) {
    const invoice = this.selectedInvoice;
    const items = [...invoice.items];
    const itemIndex = items.findIndex(item => item.id === this.activeEditCartId);
    if (itemIndex === -1) return;

    const item = items[itemIndex];
    const oldPrice = item.price;
    const oldDiscount = item.discount;
    const oldSplit = item.splitRatio;

    item.price = this.editItemPrice;
    item.discount = this.editItemDiscount;
    item.splitRatio = this.editItemSplitRatio;
    item.splitStylistID = this.editItemSplitStylist;

    if (this.editItemSplitRatio < 100 && this.editItemSplitStylist) {
      const stylists = db.get("stylists");
      item.splitStylistName = stylists.find(s => s.id === this.editItemSplitStylist)?.name || "";
    } else {
      item.splitStylistID = "";
      item.splitStylistName = "";
      item.splitRatio = 100;
    }

    const settings = db.get("settings");
    const taxConfig = settings.taxConfig;

    let subtotal = 0;
    let totalDiscount = 0;
    let serviceTax = 0;
    let productTax = 0;

    items.forEach(it => {
      const lineOriginalTotal = it.price * it.qty;
      const lineDiscount = it.discount * it.qty;
      const lineSubtotal = Math.max(0, lineOriginalTotal - lineDiscount);

      subtotal += lineOriginalTotal;
      totalDiscount += lineDiscount;

      let taxRate = 0;
      if (it.type === "Service") {
        taxRate = taxConfig.serviceTaxRate;
      } else if (it.type === "Product") {
        taxRate = taxConfig.productTaxRate;
      } else if (it.type === "Membership") {
        taxRate = taxConfig.membershipTaxRate;
      } else if (it.type === "GiftCard") {
        taxRate = taxConfig.giftCardTaxRate;
      }

      const taxAmount = lineSubtotal * (taxRate / 100);
      if (it.type === "Product") productTax += taxAmount;
      else serviceTax += taxAmount;
    });

    const finalSubtotal = Math.max(0, subtotal - totalDiscount);
    const totalTax = serviceTax + productTax;
    const totalBill = finalSubtotal + totalTax + invoice.tip;

    const payments = [...invoice.payments];
    if (payments.length > 0) {
      payments[0].amount = totalBill;
    }

    const updatedFields = {
      items,
      tax: totalTax,
      discount: totalDiscount,
      subtotal: finalSubtotal,
      total: totalBill,
      payments
    };

    const success = this.state.modifyInvoiceAfterCheckout(
      invoice.id,
      pin,
      updatedFields,
      `Adjusted ${item.name}: price ${formatINR(oldPrice)}->${formatINR(item.price)}, disc ${formatINR(oldDiscount)}->${formatINR(item.discount)}, split ratio ${oldSplit}%->${item.splitRatio}%`
    );

    if (success) {
      this.selectedInvoice = { ...this.selectedInvoice, ...updatedFields };
    }
    this.activeEditCartId = null;
    this.renderAuditDrawer();
  }

  render() {
    if (this.state.currentView !== "invoice-history") return;

    const invoices = db.get("invoices");
    const stylists = db.get("stylists");

    // Filter list
    const filtered = invoices.filter(inv => {
      const q = this.searchQuery.toLowerCase().trim();
      let matchSearch = true;
      if (q.length > 0) {
        matchSearch = 
          inv.id.toLowerCase().includes(q) || 
          inv.customerName.toLowerCase().includes(q);
      }

      let matchDate = true;
      const invDateStr = inv.createdAt.split("T")[0];
      if (this.filterDateStart) matchDate = matchDate && (invDateStr >= this.filterDateStart);
      if (this.filterDateEnd) matchDate = matchDate && (invDateStr <= this.filterDateEnd);

      let matchPayment = true;
      if (this.filterPayment !== "all") {
        matchPayment = inv.payments.some(p => p.method === this.filterPayment);
      }

      let matchStylist = true;
      if (this.filterStylist !== "all") {
        matchStylist = inv.items.some(
          item => item.stylistID === this.filterStylist || item.splitStylistID === this.filterStylist
        );
      }

      return matchSearch && matchDate && matchPayment && matchStylist;
    }).reverse();

    this.container.innerHTML = `
      <div class="card-header">
        <h2 class="card-title">Billing Ledger</h2>
      </div>

      <!-- Filters Row -->
      <div class="crm-search-bar-row" style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr; gap:10px; width:100%; margin-bottom:16px;">
        <div class="topbar-search" style="width:100%; background-color:var(--bg-input);">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input type="text" id="hist-search-field" placeholder="Search by invoice number or client name..." value="${this.searchQuery}" />
        </div>

        <select id="hist-filter-payment" class="form-select">
          <option value="all" ${this.filterPayment === 'all' ? 'selected':''}>All Payments</option>
          <option value="POS Terminal" ${this.filterPayment === 'POS Terminal' ? 'selected':''}>POS Card</option>
          <option value="Cash / Manual Check" ${this.filterPayment === 'Cash / Manual Check' ? 'selected':''}>Cash / Check</option>
          <option value="Online Stored Card" ${this.filterPayment === 'Online Stored Card' ? 'selected':''}>Stored Card</option>
          <option value="Points Redemption" ${this.filterPayment === 'Points Redemption' ? 'selected':''}>Points</option>
          <option value="Gift Card Balance" ${this.filterPayment === 'Gift Card Balance' ? 'selected':''}>Gift Card</option>
        </select>

        <select id="hist-filter-stylist" class="form-select">
          <option value="all" ${this.filterStylist === 'all' ? 'selected':''}>All Stylists</option>
          ${stylists.map(s => `<option value="${s.id}" ${this.filterStylist === s.id ? 'selected':''}>${s.name}</option>`).join('')}
        </select>

        <div style="display:flex; gap:6px;">
          <input type="date" id="hist-filter-start" class="form-input" value="${this.filterDateStart}" style="padding:8px 4px; font-size:0.75rem; min-height:36px; height:36px;" />
          <input type="date" id="hist-filter-end" class="form-input" value="${this.filterDateEnd}" style="padding:8px 4px; font-size:0.75rem; min-height:36px; height:36px;" />
        </div>
      </div>

      <!-- Ledger Table -->
      <div style="flex-grow:1; overflow-y:auto; border:1px solid var(--border-color); border-radius:var(--radius-md);">
        <table class="crm-table">
          <thead>
            <tr>
              <th>Invoice ID</th>
              <th>Customer</th>
              <th>Total Amount</th>
              <th>Taxes</th>
              <th>Tips</th>
              <th>Payment Split</th>
              <th>Date & Time</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${invoices.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted); font-weight:600; font-size:0.9rem;">No sales invoices logged in the ledger.</td>
              </tr>
            ` : filtered.length === 0 ? `
              <tr>
                <td colspan="8" style="text-align:center; padding:24px; color:var(--text-muted);">No sales invoices match filters.</td>
              </tr>
            ` : filtered.map(inv => `
              <tr class="ledger-invoice-row" data-id="${inv.id}">
                <td style="font-weight:700; color:var(--primary);">${inv.id}</td>
                <td style="font-weight:600;">${inv.customerName}</td>
                <td style="font-weight:700;">${formatINR(inv.total)}</td>
                <td>${formatINR(inv.tax)}</td>
                <td>${formatINR(inv.tip)}</td>
                <td><span style="font-size:0.78rem; color:var(--text-secondary);">${inv.payments.map(p => p.method.split(' ')[0]).join(' + ') || 'Unpaid Draft'}</span></td>
                <td style="font-size:0.8rem; color:var(--text-muted);">${new Date(inv.createdAt).toLocaleString()}</td>
                <td><span class="invoice-badge ${inv.status.toLowerCase()}" style="font-size:0.68rem; padding:2px 6px;">${inv.status}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    this.bindEvents();
  }

  renderAuditDrawer() {
    const drawerBody = document.getElementById("audit-drawer-body");
    if (!drawerBody || !this.selectedInvoice) return;

    const inv = this.selectedInvoice;
    const stylists = db.get("stylists");
    const allAuditLogs = db.get("audit_logs").filter(log => log.invoiceId === inv.id);

    drawerBody.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px; height:100%; overflow-y: auto; padding-right: 4px;">
        
        <!-- Invoice Metadata -->
        <div style="background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:12px; display:flex; justify-content:space-between; align-items:start;">
          <div>
            <h4 style="font-weight:700; font-size:1.15rem;">${inv.id}</h4>
            <p style="font-size:0.75rem; color:var(--text-muted);">${new Date(inv.createdAt).toLocaleString()}</p>
            <p style="font-size:0.8rem; font-weight:600; margin-top:4px;">Guest: ${inv.customerName}</p>
          </div>
          <span class="invoice-badge ${inv.status.toLowerCase()}" style="font-size:0.7rem;">${inv.status}</span>
        </div>

        <!-- Cart pricing overrides adjust -->
        <div>
          <label class="form-label" style="font-size:0.7rem; margin-bottom:6px; display:block;">Line overrides & Split commission ratios</label>
          <div style="display:flex; flex-direction:column; gap:8px;">
            ${inv.items.map(item => {
              const isSplit = item.splitRatio < 100;
              const isAdjusting = this.activeEditCartId === item.id;
              
              if (isAdjusting) {
                return `
                  <form id="item-line-adjust-form" style="background-color:var(--bg-input); border:1px dashed var(--primary); padding:10px; border-radius:var(--radius-md); display:flex; flex-direction:column; gap:8px;">
                    <div style="font-weight:600; font-size:0.8rem;">Adjust: ${item.name}</div>
                    
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:0.65rem;">Price Override</label>
                        <input type="number" id="adjust-price-val" class="form-input" value="${this.editItemPrice}" step="0.01" style="min-height:30px; height:30px; font-size:0.8rem; padding:2px 8px;" required />
                      </div>
                      <div class="form-group" style="margin-bottom:0;">
                        <label class="form-label" style="font-size:0.65rem;">Item Discount</label>
                        <input type="number" id="adjust-discount-val" class="form-input" value="${this.editItemDiscount}" step="0.01" style="min-height:30px; height:30px; font-size:0.8rem; padding:2px 8px;" required />
                      </div>
                    </div>

                    <div style="font-size:0.7rem; font-weight:600; color:var(--text-secondary); margin-top:2px;">
                      Commission Splits: <span id="adjust-split-lbl-text">${this.editItemSplitRatio} / ${100 - this.editItemSplitRatio}</span>
                    </div>

                    <div style="display:flex; align-items:center; gap:8px;">
                      <input type="range" id="adjust-split-slider" min="0" max="100" step="5" value="${this.editItemSplitRatio}" style="flex-grow:1; height:4px; background:none;" />
                      <select id="adjust-split-assistant" class="form-select" style="min-height:28px; height:28px; font-size:0.75rem; padding:2px; width:110px;" ${this.editItemSplitRatio === 100 ? 'disabled' : ''}>
                        <option value="" disabled>-- Assistant --</option>
                        ${stylists
                          .filter(s => s.id !== item.stylistID)
                          .map(s => `<option value="${s.id}" ${this.editItemSplitStylist === s.id ? 'selected' : ''}>${s.name.split(' ')[0]}</option>`)
                          .join('')
                        }
                      </select>
                    </div>

                    <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:4px;">
                      <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-adjust-form" style="min-height:26px; font-size:0.7rem;">Cancel</button>
                      <button type="submit" class="btn btn-primary btn-sm" style="min-height:26px; font-size:0.7rem;">Authorize overrides</button>
                    </div>
                  </form>
                `;
              }

              return `
                <div style="display:flex; justify-content:space-between; align-items:center; background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px 12px; font-size:0.82rem;">
                  <div>
                    <div style="font-weight:600;">${item.name} (${item.qty}x)</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">
                      Stylist: ${item.stylistName.split(' ')[0]} ${isSplit ? `| Assistant: ${item.splitStylistName.split(' ')[0]} (${100-item.splitRatio}%)` : ''}
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-weight:700; color:var(--primary);">${formatINR(item.price * item.qty)}</span>
                    ${inv.status === 'Final' ? `
                      <button class="btn btn-secondary btn-sm" data-action="adjust-line" data-cart-id="${item.id}" style="min-height:26px; height:26px; padding:2px 8px; font-size:0.7rem;">Adjust</button>
                    ` : ""}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Ledger pricing overview -->
        <div style="background-color:rgba(255,255,255,0.01); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:10px; font-size:0.8rem; color:var(--text-secondary);">
          <div class="summary-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Subtotal</span>
            <span>${formatINR(inv.subtotal)}</span>
          </div>
          <div class="summary-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Taxes</span>
            <span>${formatINR(inv.tax)}</span>
          </div>
          <div class="summary-row" style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Tips</span>
            <span>${formatINR(inv.tip)}</span>
          </div>
          <div class="summary-row" style="display: flex; justify-content: space-between; font-weight:700; color:var(--text-primary); font-size:1rem; border-top:1px solid var(--border-color); padding-top:6px; margin-top:4px;">
            <span>Grand Total</span>
            <span>${formatINR(inv.total)}</span>
          </div>
        </div>

        <!-- Danger Refund Cancellations controls -->
        ${inv.status === 'Final' ? `
          <div style="border-top:1px solid var(--border-color); padding-top:14px; display:flex; flex-direction:column; gap:8px;">
            <label class="form-label" style="color:var(--danger); font-size:0.7rem;">Process cancellations/Refund</label>
            <input type="text" id="cancel-reason-input" class="form-input" placeholder="Cancellation reason..." style="min-height:34px; height:34px; font-size:0.8rem; padding:4px 10px;" />
            <button class="btn btn-danger btn-sm" id="btn-cancel-invoice-history" style="width:100%; min-height:34px;">Cancel Invoice & Refund Inventory</button>
          </div>
        ` : ""}

        <!-- Override Trail Log List -->
        <div style="border-top:1px solid var(--border-color); padding-top:14px; flex-grow:1.5; display:flex; flex-direction:column; overflow:hidden; margin-bottom: 20px;">
          <label class="form-label" style="font-size:0.7rem; margin-bottom:8px; display:block;">Invoice Override Logs</label>
          <div style="overflow-y:auto; display:flex; flex-direction:column; gap:6px;">
            ${allAuditLogs.length === 0 ? `
              <div style="text-align:center; padding:16px; color:var(--text-muted); font-size:0.75rem;">No overrides logged for this receipt.</div>
            ` : allAuditLogs.map(log => `
              <div style="background-color:rgba(255,255,255,0.01); border:1px solid var(--border-color); padding:8px 10px; border-radius:8px; font-size:0.75rem;">
                <div style="display:flex; justify-content:space-between; font-weight:600; color:var(--text-secondary); margin-bottom:2px;">
                  <span>${log.action}</span>
                  <span>${new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
                <div>Auth by: <strong>${log.user}</strong></div>
                ${log.details && log.details.reason ? `<div style="color:var(--text-muted); font-size:0.7rem; margin-top:2px;">Reason: ${log.details.reason}</div>` : ""}
              </div>
            `).join('')}
          </div>
        </div>

      </div>
    `;

    this.bindReceiptEvents();
  }

  bindEvents() {
    // Search input
    const searchInput = this.container.querySelector("#hist-search-field");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => this.setFilter("searchQuery", e.target.value));
    }

    // Payment Filter
    const payFilter = this.container.querySelector("#hist-filter-payment");
    if (payFilter) {
      payFilter.addEventListener("change", (e) => this.setFilter("filterPayment", e.target.value));
    }

    // Stylist Filter
    const styFilter = this.container.querySelector("#hist-filter-stylist");
    if (styFilter) {
      styFilter.addEventListener("change", (e) => this.setFilter("filterStylist", e.target.value));
    }

    // Start Date Filter
    const startFilter = this.container.querySelector("#hist-filter-start");
    if (startFilter) {
      startFilter.addEventListener("change", (e) => this.setFilter("filterDateStart", e.target.value));
    }

    // End Date Filter
    const endFilter = this.container.querySelector("#hist-filter-end");
    if (endFilter) {
      endFilter.addEventListener("change", (e) => this.setFilter("filterDateEnd", e.target.value));
    }

    // Row selection table clicks
    const rows = this.container.querySelectorAll(".ledger-invoice-row");
    rows.forEach(row => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        const invoices = db.get("invoices");
        this.selectedInvoice = invoices.find(i => i.id === id) || null;
        
        // Open Right slide over drawer
        const drawer = document.getElementById("drawer-audit-overlay");
        if (drawer) drawer.classList.add("active");
        
        this.render();
        this.renderAuditDrawer();
      });
    });
  }

  bindReceiptEvents() {
    const drawerBody = document.getElementById("audit-drawer-body");
    if (!drawerBody) return;

    // Line overrides button click
    const adjustBtns = drawerBody.querySelectorAll('[data-action="adjust-line"]');
    adjustBtns.forEach(btn => {
      btn.addEventListener("click", (e) => {
        const cartId = btn.dataset.cartId;
        const item = this.selectedInvoice.items.find(i => i.id === cartId);
        if (item) {
          this.triggerEditCartItem(
            cartId,
            item.price,
            item.discount || 0,
            item.splitStylistID || "",
            item.splitRatio || 100
          );
        }
      });
    });

    // Form submission adjust pricing
    const adjustForm = drawerBody.querySelector("#item-line-adjust-form");
    if (adjustForm) {
      // Dynamic slider
      const slider = adjustForm.querySelector("#adjust-split-slider");
      const lbl = adjustForm.querySelector("#adjust-split-lbl-text");
      const select = adjustForm.querySelector("#adjust-split-assistant");

      slider.addEventListener("input", (e) => {
        const pRatio = parseInt(e.target.value);
        const sRatio = 100 - pRatio;
        if (lbl) lbl.innerText = `${pRatio} / ${sRatio}`;

        if (pRatio === 100) {
          select.disabled = true;
          select.removeAttribute("required");
        } else {
          select.disabled = false;
          select.setAttribute("required", "required");
        }
      });

      adjustForm.addEventListener("submit", (e) => {
        e.preventDefault();
        this.editItemPrice = parseFloat(adjustForm.querySelector("#adjust-price-val").value);
        this.editItemDiscount = parseFloat(adjustForm.querySelector("#adjust-discount-val").value);
        this.editItemSplitRatio = parseInt(slider.value);
        this.editItemSplitStylist = select.value;

        this.submitItemEdits(e);
      });

      const cancelBtn = adjustForm.querySelector("#btn-cancel-adjust-form");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          this.activeEditCartId = null;
          this.renderAuditDrawer();
        });
      }
    }

    // Cancellation submit click
    const cancelInvoiceBtn = drawerBody.querySelector("#btn-cancel-invoice-history");
    if (cancelInvoiceBtn) {
      cancelInvoiceBtn.addEventListener("click", () => {
        const reasonInput = drawerBody.querySelector("#cancel-reason-input");
        const reason = reasonInput ? reasonInput.value : "";
        this.triggerCancelInvoice(reason);
      });
    }
  }
}
