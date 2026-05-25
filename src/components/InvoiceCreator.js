// src/components/InvoiceCreator.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";

export class InvoiceCreator {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.activeCategory = "pmu"; // 'pmu', 'hair', 'skin', 'academy', 'products', 'memberships', 'giftcards'
    this.catalogSearch = "";
    
    // Track which cart item has its commission split panel expanded
    this.expandedSplitCartId = null;

    // Active draft context
    this.editingDraftId = null;

    // Control service addition modal
    this.showAddServiceModal = false;

    // Subscribe to state updates
    this.state.subscribe(() => this.render());
  }

  init() {
    this.render();
  }

  switchCategory(cat) {
    this.activeCategory = cat;
    this.render();
  }

  handleCatalogSearch(e) {
    this.catalogSearch = e.target.value;
    this.render();
  }

  addItemToCart(item) {
    if (item.type === "Product" && item.stock <= 0) {
      this.state.addNotification(`Product "${item.name}" is out of stock!`, "error");
      return;
    }
    this.state.addToCart(item);
    this.state.addNotification(`Added "${item.name}" to invoice.`, "info");
  }

  toggleSplitExpander(cartId) {
    if (this.expandedSplitCartId === cartId) {
      this.expandedSplitCartId = null;
    } else {
      this.expandedSplitCartId = cartId;
    }
    this.render();
  }

  saveSplitCommission(cartId, ratio, assistantId) {
    let splitStylistName = "";
    if (assistantId) {
      const stylists = db.get("stylists");
      const stylist = stylists.find(s => s.id === assistantId);
      splitStylistName = stylist ? stylist.name : "";
    }

    this.state.updateCartItem(cartId, {
      splitStylistID: ratio === 100 ? "" : assistantId,
      splitStylistName: ratio === 100 ? "" : splitStylistName,
      splitRatio: ratio
    });

    this.state.addNotification("Item commission split updated.", "success");
    this.expandedSplitCartId = null;
  }

  repeatLastService() {
    const customer = this.state.activeCustomer;
    if (!customer) {
      this.state.addNotification("Please select a customer first to repeat their last service.", "warning");
      return;
    }
    const invoices = db.get("invoices") || [];
    const lastInv = [...invoices].reverse().find(i => i.status === "Final" && i.customerName.toLowerCase() === customer.name.toLowerCase());
    if (!lastInv) {
      this.state.addNotification(`No previous finalized invoice found for ${customer.name}.`, "warning");
      return;
    }
    
    const services = db.get("services") || [];
    const products = db.get("products") || [];
    let addedCount = 0;
    
    lastInv.items.forEach(item => {
      let matched = null;
      if (item.type === "Service") {
        matched = services.find(s => s.name === item.name);
      } else if (item.type === "Product") {
        matched = products.find(p => p.name === item.name);
      }
      
      if (matched) {
        for (let q = 0; q < item.qty; q++) {
          this.state.addToCart(matched);
          addedCount++;
        }
      }
    });
    
    if (addedCount > 0) {
      this.state.addNotification(`Repeated last visit: added ${addedCount} item(s) for ${customer.name}.`, "success");
    } else {
      this.state.addNotification("No match found for previous services.", "error");
    }
  }

  render() {
    const cart = this.state.cart;
    const stylists = db.get("stylists");
    const isAllowedDiscount = this.state.activeStaff && (this.state.activeStaff.role === 'admin' || this.state.activeStaff.role === 'receptionist');
    const isAllowedAddService = isAllowedDiscount;
    const customer = this.state.activeCustomer;
    
    // Calculate Speed Billing shortcuts data
    const allInvoices = db.get("invoices") || [];
    const recentCustomers = [];
    const seenNames = new Set();
    const allCustomers = db.get("customers") || [];
    
    for (let i = allInvoices.length - 1; i >= 0; i--) {
      const inv = allInvoices[i];
      if (inv.customerName && inv.customerName !== "Walk-in Guest" && !seenNames.has(inv.customerName)) {
        seenNames.add(inv.customerName);
        const cust = allCustomers.find(c => c.name.toLowerCase() === inv.customerName.toLowerCase());
        if (cust) {
          recentCustomers.push(cust);
        }
        if (recentCustomers.length >= 4) break;
      }
    }

    const serviceCounts = {};
    allInvoices.forEach(inv => {
      inv.items.forEach(item => {
        if (item.type === "Service") {
          serviceCounts[item.name] = (serviceCounts[item.name] || 0) + item.qty;
        }
      });
    });
    
    const services = db.get("services") || [];
    const sortedServices = services
      .map(s => ({ ...s, count: serviceCounts[s.name] || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);

    // Load catalog items based on category
    let catalogItems = [];
    if (this.activeCategory === "pmu") {
      catalogItems = db.get("services").filter(s => s.category === "pmu");
    } else if (this.activeCategory === "hair") {
      catalogItems = db.get("services").filter(s => s.category === "hair");
    } else if (this.activeCategory === "skin") {
      catalogItems = db.get("services").filter(s => s.category === "skin");
    } else if (this.activeCategory === "academy") {
      catalogItems = db.get("services").filter(s => s.category === "academy");
    } else if (this.activeCategory === "products") {
      catalogItems = db.get("products");
    } else if (this.activeCategory === "memberships") {
      catalogItems = db.get("memberships");
    } else if (this.activeCategory === "giftcards") {
      catalogItems = db.get("giftcards");
    }

    // Apply search filter
    if (this.catalogSearch.trim().length > 0) {
      const q = this.catalogSearch.toLowerCase();
      catalogItems = catalogItems.filter(item => item.name.toLowerCase().includes(q));
    }

    this.container.innerHTML = `
      <div class="card" style="height: 100%; display: flex; flex-direction: column; overflow: hidden;">
        
        <!-- Compact Customer Selection Header -->
        <div class="guest-selection-header" style="display:flex; justify-content:space-between; align-items:center; background:rgba(99,102,241,0.04); border-bottom:1px solid var(--border-color); padding:10px 16px; flex-shrink:0;">
          ${customer ? `
            <div style="display:flex; align-items:center; gap:12px;">
              <div class="staff-avatar" style="width:34px; height:34px; font-size:0.9rem; font-weight:700;">
                ${customer.name.split(' ')[0][0]}${customer.name.split(' ')[1] ? customer.name.split(' ')[1][0] : ''}
              </div>
              <div style="display:flex; flex-direction:column; line-height:1.2;">
                <span style="font-weight:700; font-size:0.95rem; color:var(--text-primary);">${customer.name}</span>
                <span style="font-size:0.75rem; color:var(--text-secondary);">📞 ${customer.phone}</span>
              </div>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-secondary btn-sm" id="btn-change-guest-pos" style="min-height:28px; padding:2px 10px; font-size:0.75rem;">Change Guest</button>
              <button class="btn btn-secondary btn-sm" id="btn-remove-guest-pos" style="min-height:28px; padding:2px 10px; font-size:0.75rem; color:var(--danger); border-color:transparent;">Remove</button>
            </div>
          ` : `
            <div style="display:flex; align-items:center; gap:8px; color:var(--text-muted); font-size:0.82rem;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:18px; height:18px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <span>No client selected (Walk-in mode)</span>
            </div>
            <button class="btn btn-primary btn-sm" id="btn-select-guest-pos" style="min-height:30px; padding:4px 12px; font-size:0.78rem; background:var(--primary); border:none;">
              + Select Customer
            </button>
          `}
        </div>

        <!-- Part 1: Service Catalog Section -->
        <div class="catalog-section">
          <!-- Quick Actions Bar for Speed Billing -->
          <div class="quick-actions-bar" style="background-color: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; flex-shrink: 0;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <span style="font-size: 0.72rem; font-weight: 700; text-transform: uppercase; color: var(--text-secondary); letter-spacing: 0.4px;">Speed Billing Shortcuts</span>
              <button class="btn btn-secondary btn-sm" id="btn-repeat-last-service" style="min-height: 24px; height: 24px; padding: 2px 8px; font-size: 0.72rem; border-color: rgba(99,102,241,0.35); color: var(--primary); font-weight: 700; cursor: pointer;" ${customer ? '' : 'disabled'}>
                🔁 Repeat Last Visit
              </button>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr; gap: 6px;">
              <!-- Recent Guests -->
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600; min-width: 90px;">Recent Guests:</span>
                ${recentCustomers.length === 0 ? `
                  <span style="font-size: 0.7rem; color: var(--text-muted); font-style: italic;">No recent checkouts</span>
                ` : recentCustomers.map(c => `
                  <button class="btn btn-secondary btn-sm btn-quick-select-guest" data-id="${c.id}" style="min-height: 24px; height: 24px; padding: 2px 8px; font-size: 0.72rem; border-radius: var(--radius-sm); border: 1.5px solid var(--border-color);">
                    👤 ${c.name.split(' ')[0]}
                  </button>
                `).join('')}
              </div>

              <!-- Top Services -->
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.7rem; color: var(--text-muted); font-weight: 600; min-width: 90px;">Top Services:</span>
                ${sortedServices.map(s => `
                  <button class="btn btn-secondary btn-sm btn-quick-add-service" data-id="${s.id}" data-type="${s.type}" style="min-height: 24px; height: 24px; padding: 2px 8px; font-size: 0.72rem; border-radius: var(--radius-sm); border: 1.5px solid var(--border-color);">
                    ⚡ ${s.name.split(' ').slice(0, 2).join(' ')}
                  </button>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="card-header" style="margin-bottom: 10px;">
            <h3 class="card-title">Catalog Menu</h3>
            
            <div style="display:flex; gap:10px; align-items:center;">
              <!-- Mini search -->
              <input type="text" id="catalog-search-input" class="form-input" placeholder="Filter items..." value="${this.catalogSearch}" style="min-height:30px; height:30px; width:130px; font-size:0.78rem; padding:4px 8px; border-radius:var(--radius-sm);" />
              ${isAllowedAddService ? `
                <button class="btn btn-primary btn-sm" id="btn-add-custom-service" style="min-height:30px; height:30px; font-size:0.78rem; padding:4px 10px; border-radius:var(--radius-sm); white-space:nowrap; background:var(--primary); border:none;">
                  + Add Service
                </button>
              ` : ""}
            </div>
          </div>

          <!-- Horizontal Category Tabs -->
          <div class="settings-tabs-row" style="margin-bottom: 12px; gap:6px; overflow-x:auto; padding-bottom:4px; flex-shrink:0;">
            <div class="settings-tab-btn ${this.activeCategory === 'pmu' ? 'active' : ''}" data-cat="pmu" style="font-size:0.8rem; padding:6px 12px;">PMU Clinic</div>
            <div class="settings-tab-btn ${this.activeCategory === 'hair' ? 'active' : ''}" data-cat="hair" style="font-size:0.8rem; padding:6px 12px;">Hair Care</div>
            <div class="settings-tab-btn ${this.activeCategory === 'skin' ? 'active' : ''}" data-cat="skin" style="font-size:0.8rem; padding:6px 12px;">Skin & Makeup</div>
            <div class="settings-tab-btn ${this.activeCategory === 'academy' ? 'active' : ''}" data-cat="academy" style="font-size:0.8rem; padding:6px 12px;">Academy</div>
            <div class="settings-tab-btn ${this.activeCategory === 'products' ? 'active' : ''}" data-cat="products" style="font-size:0.8rem; padding:6px 12px;">Products</div>
            <div class="settings-tab-btn ${this.activeCategory === 'memberships' ? 'active' : ''}" data-cat="memberships" style="font-size:0.8rem; padding:6px 12px;">Memberships</div>
            <div class="settings-tab-btn ${this.activeCategory === 'giftcards' ? 'active' : ''}" data-cat="giftcards" style="font-size:0.8rem; padding:6px 12px;">Gift Cards</div>
          </div>

          <!-- Catalog Cards List Grid -->
          <div class="catalog-grid">
            ${catalogItems.map(item => {
              const isProduct = item.type === "Product";
              const isLowStock = isProduct && item.stock <= 3;
              const isOutOfStock = isProduct && item.stock <= 0;

              return `
                <div class="catalog-item-card" data-item-id="${item.id}" style="${isOutOfStock ? 'opacity:0.4; cursor:not-allowed; border-color:var(--border-color);' : ''}">
                  <div class="catalog-item-name">${item.name}</div>
                  <div class="catalog-item-meta">
                    <span class="catalog-item-price">${formatINR(item.price)}</span>
                    ${isProduct ? `
                      <span class="catalog-item-stock ${isOutOfStock ? 'low' : isLowStock ? 'low' : ''}">
                        ${isOutOfStock ? 'OUT' : `${item.stock} left`}
                      </span>
                    ` : ""}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Part 2: Active Cart Invoice Items Section -->
        <div class="cart-section">
          <div class="card-header" style="margin-bottom:6px;">
            <h3 class="card-title">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
              </svg>
              Invoice Items (${cart.reduce((sum, i) => sum + i.qty, 0)})
            </h3>
            ${this.editingDraftId ? `<span class="badge badge-gold" style="font-size:0.65rem;">Editing Draft ${this.editingDraftId}</span>` : ""}
          </div>

          <div class="cart-table-wrapper">
            ${cart.length === 0 ? `
              <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-muted); font-size:0.8rem; border:1px dashed var(--border-color); border-radius:var(--radius-md); background-color:rgba(0,0,0,0.05); margin-bottom:12px;">
                Checkout cart is empty.
              </div>
            ` : `
              <table class="cart-table">
                <thead>
                  <tr>
                    <th>Item Description</th>
                    <th style="width:70px; text-align:center;">Qty</th>
                    <th style="width:85px;">Price</th>
                    <th style="width:110px;">Stylist</th>
                    <th style="width:40px;"></th>
                  </tr>
                </thead>
                <tbody>
                  ${cart.map(item => {
                    const isSplit = item.splitRatio < 100;
                    const isExpanded = this.expandedSplitCartId === item.id;
                    return `
                      <tr data-cart-id="${item.id}">
                        <td colspan="5" style="padding:0; border-bottom:1px solid var(--border-color);">
                          <div style="padding:10px var(--sp-1); display:flex; justify-content:space-between; align-items:center;">
                            
                            <!-- Item name, type, and split triggers -->
                            <div style="flex-grow:1; display:flex; flex-direction:column; line-height:1.2;">
                              <span style="font-weight:600; font-size:0.88rem;">${item.name}</span>
                              <span style="font-size:0.7rem; color:var(--text-muted);">${item.type}</span>
                              
                              <!-- Progressive split badge accordion trigger -->
                              <div class="split-trigger-badge" data-action="toggle-split-accordion">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:10px; height:10px;">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                                </svg>
                                ${isSplit 
                                  ? `${item.stylistName.split(' ')[0]} (${item.splitRatio}%) & ${item.splitStylistName.split(' ')[0]} (${100 - item.splitRatio}%)`
                                  : `Split Commission`
                                }
                              </div>
                            </div>

                            <!-- Qty adjustments -->
                            <div class="qty-controls" style="margin-right: 14px;">
                              <button class="qty-btn" data-action="qty-dec" style="width:24px; height:24px; font-size:0.78rem;">-</button>
                              <span class="qty-val" style="font-size:0.85rem; width:16px;">${item.qty}</span>
                              <button class="qty-btn" data-action="qty-inc" style="width:24px; height:24px; font-size:0.78rem;">+</button>
                            </div>

                            <!-- Price modifications -->
                            <div style="display:flex; flex-direction:column; gap:2px; margin-right:14px;">
                              <input type="number" class="form-input" data-field="price" value="${item.price}" style="min-height:26px; height:26px; width:65px; padding:2px 6px; font-size:0.8rem; font-weight:600;" step="0.01" />
                              ${isAllowedDiscount ? `
                                <div style="display:flex; align-items:center; gap:2px; font-size:0.68rem; color:var(--text-secondary);">
                                  <span>Disc:</span>
                                  <input type="number" class="form-input" data-field="discount" value="${item.discount}" style="min-height:20px; height:20px; width:40px; padding:2px 4px; font-size:0.68rem;" />
                                </div>
                              ` : ""}
                            </div>

                            <!-- Stylist Select lists -->
                            <div style="margin-right:8px;">
                              <select class="cart-stylist-select" data-field="stylist" style="min-height:26px; height:26px; padding:2px 4px; font-size:0.78rem;">
                                ${stylists.map(s => `<option value="${s.id}" ${item.stylistID === s.id ? 'selected' : ''}>${s.name.split(' ')[0]}</option>`).join('')}
                              </select>
                            </div>

                            <!-- Delete line item btn -->
                            <div>
                              <button class="btn btn-secondary btn-icon btn-sm" data-action="remove-item" style="color:var(--danger); border-color:transparent; background:none; min-height:28px; width:28px;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>

                          </div>

                          <!-- Progressive split inline accordion panel -->
                          <div class="split-expander-panel ${isExpanded ? 'active' : ''}">
                            <div style="display:flex; justify-content:space-between; font-size:0.72rem; font-weight:600; color:var(--text-secondary);">
                              <span>Primary: ${item.stylistName} (${item.splitRatio}%)</span>
                              <span id="range-lbl-text-${item.id}">Split Ratio: ${item.splitRatio} / ${100 - item.splitRatio}</span>
                            </div>
                            
                            <div style="display:flex; align-items:center; gap:12px;">
                              <input type="range" class="split-range-slider" data-cart-id="${item.id}" min="0" max="100" step="5" value="${item.splitRatio}" style="flex-grow:1; height:6px; background:none;" />
                              
                              <select class="form-select" data-field="split-assistant" style="min-height:30px; height:30px; font-size:0.75rem; width:130px; padding:4px 8px;" ${item.splitRatio === 100 ? 'disabled' : ''}>
                                <option value="" disabled ${!item.splitStylistID ? 'selected' : ''}>-- Select Assistant --</option>
                                ${stylists
                                  .filter(s => s.id !== item.stylistID)
                                  .map(s => `<option value="${s.id}" ${item.splitStylistID === s.id ? 'selected' : ''}>${s.name}</option>`)
                                  .join('')
                                }
                              </select>
                            </div>

                            <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">
                              <button class="btn btn-secondary btn-sm" data-action="reset-splits" style="min-height:28px; padding:2px 10px; font-size:0.72rem;">Clear Split</button>
                              <button class="btn btn-primary btn-sm" data-action="save-splits" style="min-height:28px; padding:2px 10px; font-size:0.72rem;">Apply Split</button>
                            </div>
                          </div>

                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            `}
          </div>

          <!-- Bottom: Cart Notes and Actions -->
          ${cart.length > 0 ? `
            <div style="display:flex; gap:12px; align-items:center; border-top:1px solid var(--border-color); padding-top:10px; flex-shrink:0;">
              <input type="text" id="invoice-notes" class="form-input" placeholder="Add receptionist notes..." style="flex-grow:1; min-height:34px; height:34px; font-size:0.8rem; padding:4px 10px;" />
              <button class="btn btn-secondary btn-sm" id="btn-clear-cart" style="color:var(--danger); min-height:34px; font-size:0.8rem;">Clear All</button>
            </div>
          ` : ""}

        </div>

      </div>

      <!-- Add Custom Service Modal -->
      <div class="modal-overlay ${this.showAddServiceModal ? 'active' : ''}" id="add-service-modal-overlay" style="z-index: 1000;">
        <div class="modal-box" style="max-width: 400px; text-align: left; padding: 20px; border-radius: var(--radius-lg); background: var(--bg-card); border: 1.5px solid var(--border-color); box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);">
          <div class="modal-header" style="margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
            <h3 class="modal-title" style="margin: 0; font-size: 1.15rem; font-weight: 700; color: var(--text-primary);">+ Add Custom Service</h3>
            <button class="modal-close-btn" id="btn-close-service-modal" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-muted);">&times;</button>
          </div>
          
          <form id="add-service-form" style="display: flex; flex-direction: column; gap: 14px;">
            <div class="form-group">
              <label class="form-label" style="font-size: 0.78rem; font-weight: 600; margin-bottom: 6px; display: block; color: var(--text-secondary);">Service Name *</label>
              <input type="text" id="new-service-name" class="form-input" placeholder="e.g. Custom Hair Spa" required style="width: 100%; min-height: 38px; padding: 6px 12px; font-size: 0.85rem;" />
            </div>

            <div class="form-group">
              <label class="form-label" style="font-size: 0.78rem; font-weight: 600; margin-bottom: 6px; display: block; color: var(--text-secondary);">Price (₹) *</label>
              <input type="number" id="new-service-price" class="form-input" placeholder="e.g. 1800" min="0" required style="width: 100%; min-height: 38px; padding: 6px 12px; font-size: 0.85rem;" />
            </div>

            <div class="form-group">
              <label class="form-label" style="font-size: 0.78rem; font-weight: 600; margin-bottom: 6px; display: block; color: var(--text-secondary);">Category (optional)</label>
              <select id="new-service-category" class="form-select" style="width: 100%; min-height: 38px; padding: 6px 12px; font-size: 0.85rem;">
                <option value="pmu" ${this.activeCategory === 'pmu' ? 'selected' : ''}>PMU Clinic</option>
                <option value="hair" ${this.activeCategory === 'hair' ? 'selected' : ''}>Hair Care</option>
                <option value="skin" ${this.activeCategory === 'skin' ? 'selected' : ''}>Skin & Makeup</option>
                <option value="academy" ${this.activeCategory === 'academy' ? 'selected' : ''}>Academy</option>
              </select>
            </div>

            <div style="display: flex; gap: 10px; margin-top: 14px; justify-content: flex-end; border-top: 1px solid var(--border-color); padding-top: 12px;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-service" style="min-height: 36px; padding: 0 16px; font-size: 0.8rem;">Cancel</button>
              <button type="submit" class="btn btn-primary btn-sm" style="min-height: 36px; padding: 0 16px; font-size: 0.8rem; background: var(--primary); border: none;">Save Service</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Mini catalog filter search
    const catalogSearchInput = this.container.querySelector("#catalog-search-input");
    if (catalogSearchInput) {
      catalogSearchInput.addEventListener("input", (e) => this.handleCatalogSearch(e));
      // Only focus search input if modal is not currently open
      if (!this.showAddServiceModal) {
        catalogSearchInput.focus(); // maintain cursor focus
      }
    }

    // Service selection add custom service triggers
    const isAllowedAddService = this.state.activeStaff && (this.state.activeStaff.role === 'admin' || this.state.activeStaff.role === 'receptionist');
    if (isAllowedAddService) {
      const addServiceBtn = this.container.querySelector("#btn-add-custom-service");
      if (addServiceBtn) {
        addServiceBtn.addEventListener("click", () => {
          this.showAddServiceModal = true;
          this.render();
        });
      }

      const closeServiceModalBtn = this.container.querySelector("#btn-close-service-modal");
      if (closeServiceModalBtn) {
        closeServiceModalBtn.addEventListener("click", () => {
          this.showAddServiceModal = false;
          this.render();
        });
      }

      const cancelServiceBtn = this.container.querySelector("#btn-cancel-service");
      if (cancelServiceBtn) {
        cancelServiceBtn.addEventListener("click", () => {
          this.showAddServiceModal = false;
          this.render();
        });
      }

      const addServiceForm = this.container.querySelector("#add-service-form");
      if (addServiceForm) {
        addServiceForm.addEventListener("submit", (e) => {
          e.preventDefault();
          const name = this.container.querySelector("#new-service-name").value.trim();
          const priceVal = parseFloat(this.container.querySelector("#new-service-price").value);
          const category = this.container.querySelector("#new-service-category").value;

          if (!name || isNaN(priceVal) || priceVal < 0) {
            this.state.addNotification("Please enter a valid service name and positive price.", "error");
            return;
          }

          // Create new service object
          const newService = {
            id: "SV-CUST-" + Date.now(),
            name: name,
            price: priceVal,
            type: "Service",
            category: category,
            duration: 45, // default
            defaultTax: 18.0
          };

          // Save to local database
          const services = db.get("services") || [];
          services.push(newService);
          db.set("services", services);

          // Instantly add to billing checkout cart
          this.state.addToCart(newService);

          // Notify
          this.state.addNotification(`Saved "${name}" to database and added to billing.`, "success");
          this.state.logAudit("Service Created", null, { name, price: priceVal, category }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");

          // Reset and close modal
          this.showAddServiceModal = false;
          
          // Switch to category to make it immediately visible in Catalog list
          this.activeCategory = category;

          this.render();
        });
      }
    }

    // Category Tabs Switching
    const tabs = this.container.querySelectorAll(".settings-tab-btn[data-cat]");
    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        this.switchCategory(tab.dataset.cat);
      });
    });

    // Catalog items grid cards clicking
    const cards = this.container.querySelectorAll(".catalog-item-card");
    cards.forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.itemId;
        let item = null;
        if (this.activeCategory === "pmu" || this.activeCategory === "hair" || this.activeCategory === "skin" || this.activeCategory === "academy") {
          item = db.get("services").find(s => s.id === id);
        } else if (this.activeCategory === "products") {
          item = db.get("products").find(p => p.id === id);
        } else if (this.activeCategory === "memberships") {
          item = db.get("memberships").find(m => m.id === id);
        } else if (this.activeCategory === "giftcards") {
          item = db.get("giftcards").find(g => g.id === id);
        }
        if (item) this.addItemToCart(item);
      });
    });

    // Qty Increment
    this.container.querySelectorAll('[data-action="qty-inc"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        const item = this.state.cart.find(c => c.id === id);

        if (item.type === "Product") {
          const product = db.get("products").find(p => p.id === item.itemID);
          if (product && item.qty >= product.stock) {
            this.state.addNotification(`Stock allocation limit reached (${product.stock} items).`, "error");
            return;
          }
        }
        this.state.updateCartItem(id, { qty: item.qty + 1 });
      });
    });

    // Qty Decrement
    this.container.querySelectorAll('[data-action="qty-dec"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        const item = this.state.cart.find(c => c.id === id);
        if (item.qty > 1) {
          this.state.updateCartItem(id, { qty: item.qty - 1 });
        } else {
          this.state.removeFromCart(id);
          this.state.addNotification(`Removed "${item.name}".`, "info");
        }
      });
    });

    // Remove Item
    this.container.querySelectorAll('[data-action="remove-item"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        const item = this.state.cart.find(c => c.id === id);
        this.state.removeFromCart(id);
        this.state.addNotification(`Removed "${item.name}".`, "info");
      });
    });

    // Price override
    this.container.querySelectorAll('input[data-field="price"]').forEach(input => {
      input.addEventListener("change", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) {
          this.state.updateCartItem(id, { price: val });
        } else {
          this.render();
        }
      });
    });

    // Discount override
    const isAllowedDiscount = this.state.activeStaff && (this.state.activeStaff.role === 'admin' || this.state.activeStaff.role === 'receptionist');
    if (isAllowedDiscount) {
      this.container.querySelectorAll('input[data-field="discount"]').forEach(input => {
        input.addEventListener("change", (e) => {
          const tr = e.target.closest("tr");
          const id = tr.dataset.cartId;
          const val = parseFloat(e.target.value);
          if (!isNaN(val) && val >= 0) {
            const item = this.state.cart.find(c => c.id === id);
            if (val <= item.price) {
              this.state.updateCartItem(id, { discount: val });
            } else {
              this.state.addNotification("Discount exceeds price override.", "error");
              this.render();
            }
          } else {
            this.render();
          }
        });
      });
    }

    // Stylist assign select changes
    this.container.querySelectorAll('select[data-field="stylist"]').forEach(select => {
      select.addEventListener("change", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        const stylistId = e.target.value;
        const stylist = db.get("stylists").find(s => s.id === stylistId);
        
        this.state.updateCartItem(id, {
          stylistID: stylistId,
          stylistName: stylist ? stylist.name : "Unassigned"
        });
      });
    });

    // Toggle split accordion expansion
    this.container.querySelectorAll('[data-action="toggle-split-accordion"]').forEach(badge => {
      badge.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        this.toggleSplitExpander(id);
      });
    });

    // Range slider range updates dynamically inside accordion
    this.container.querySelectorAll(".split-range-slider").forEach(slider => {
      const id = slider.dataset.cartId;
      const lbl = this.container.querySelector(`#range-lbl-text-${id}`);
      const select = slider.nextElementSibling; // select field next to slider

      slider.addEventListener("input", (e) => {
        const pRatio = parseInt(e.target.value);
        const sRatio = 100 - pRatio;
        if (lbl) lbl.innerText = `Split Ratio: ${pRatio} / ${sRatio}`;

        if (pRatio === 100) {
          select.disabled = true;
          select.removeAttribute("required");
        } else {
          select.disabled = false;
          select.setAttribute("required", "required");
        }
      });
    });

    // Clear Splits triggers
    this.container.querySelectorAll('[data-action="reset-splits"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        this.state.updateCartItem(id, {
          splitRatio: 100,
          splitStylistID: "",
          splitStylistName: ""
        });
        this.state.addNotification("Splits cleared.", "info");
        this.expandedSplitCartId = null;
      });
    });

    // Save Splits triggers
    this.container.querySelectorAll('[data-action="save-splits"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        const tr = e.target.closest("tr");
        const id = tr.dataset.cartId;
        
        const slider = tr.querySelector(".split-range-slider");
        const select = tr.querySelector('select[data-field="split-assistant"]');
        
        const ratio = parseInt(slider.value);
        const assistantId = select.value;

        if (ratio < 100 && !assistantId) {
          alert("Please select a secondary assistant stylist.");
          return;
        }

        this.saveSplitCommission(id, ratio, assistantId);
      });
    });

    // Clear cart button
    const clearCartBtn = this.container.querySelector("#btn-clear-cart");
    if (clearCartBtn) {
      clearCartBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to empty the invoice cart?")) {
          this.state.clearCart();
          this.editingDraftId = null;
        }
      });
    }

    // Capture remarks note inside input and bind to state
    const notesInput = this.container.querySelector("#invoice-notes");
    if (notesInput) {
      notesInput.value = this.state.currentInvoiceNotes || "";
      notesInput.addEventListener("input", (e) => {
        this.state.currentInvoiceNotes = e.target.value;
      });
    }

    // Guest Selection triggers
    const selectGuestBtn = this.container.querySelector("#btn-select-guest-pos");
    if (selectGuestBtn) {
      selectGuestBtn.addEventListener("click", () => {
        const overlay = document.getElementById("drawer-customer-overlay");
        if (overlay) {
          overlay.classList.add("active");
          const searchInput = overlay.querySelector("#customer-search-input");
          if (searchInput) {
            setTimeout(() => {
              searchInput.focus();
              const valLength = searchInput.value.length;
              searchInput.setSelectionRange(valLength, valLength);
            }, 100);
          }
        }
      });
    }

    const changeGuestBtn = this.container.querySelector("#btn-change-guest-pos");
    if (changeGuestBtn) {
      changeGuestBtn.addEventListener("click", () => {
        const overlay = document.getElementById("drawer-customer-overlay");
        if (overlay) {
          overlay.classList.add("active");
          const searchInput = overlay.querySelector("#customer-search-input");
          if (searchInput) {
            setTimeout(() => {
              searchInput.focus();
              const valLength = searchInput.value.length;
              searchInput.setSelectionRange(valLength, valLength);
            }, 100);
          }
        }
      });
    }

    const removeGuestBtn = this.container.querySelector("#btn-remove-guest-pos");
    if (removeGuestBtn) {
      removeGuestBtn.addEventListener("click", () => {
        this.state.clearCustomer();
        this.state.addNotification("Customer removed from billing.", "info");
      });
    }

    // Speed Billing Shortcuts
    const repeatLastServiceBtn = this.container.querySelector("#btn-repeat-last-service");
    if (repeatLastServiceBtn) {
      repeatLastServiceBtn.addEventListener("click", () => {
        this.repeatLastService();
      });
    }

    this.container.querySelectorAll(".btn-quick-select-guest").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const allCustomers = db.get("customers") || [];
        const cust = allCustomers.find(c => c.id === id);
        if (cust) {
          this.state.selectCustomer(cust);
          this.state.addNotification(`Selected guest: ${cust.name}`, "info");
        }
      });
    });

    this.container.querySelectorAll(".btn-quick-add-service").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const itemType = btn.dataset.type;
        let item = null;
        if (itemType === "Service") {
          item = db.get("services").find(s => s.id === id);
        } else if (itemType === "Product") {
          item = db.get("products").find(p => p.id === id);
        }
        if (item) {
          this.addItemToCart(item);
        }
      });
    });
  }
}
