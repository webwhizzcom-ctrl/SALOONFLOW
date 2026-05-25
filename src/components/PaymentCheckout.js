// src/components/PaymentCheckout.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";

export class PaymentCheckout {
  constructor(container, state) {
    this.container = container;
    this.state = state;

    // Checkout partitions state
    this.payments = []; // { method, amount, transactionID }
    this.activePaymentMethod = "pos";
    this.finalizedInvoice = null;

    // Pre-booking calendar state
    this.selectedBookStylist = "";
    this.selectedBookService = "";
    this.selectedBookDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split("T")[0]; // +7 days
    this.selectedBookTime = "10:00";

    // Subscribe to state updates
    this.state.subscribe(() => {
      this.render();
      this.renderReceiptDrawer();
    });
  }

  init() {
    this.resetCheckoutState();
    this.render();
  }

  resetCheckoutState(keepReceipt = false) {
    this.payments = [];
    this.activePaymentMethod = "pos";
    if (!keepReceipt) {
      this.finalizedInvoice = null;
    }
    this.selectedBookStylist = "";
    this.selectedBookService = "";
    this.selectedBookDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().split("T")[0];
    this.selectedBookTime = "10:00";
  }

  startNewBilling() {
    this.resetCheckoutState(false);
    this.state.clearCart();
    this.state.clearCustomer();
    this.state.currentInvoiceNotes = "";
    
    // Close the receipt drawer
    const drawer = document.getElementById("drawer-receipt-overlay");
    if (drawer) drawer.classList.remove("active");
  }

  handleTipChange(type, value) {
    this.state.setTip(type, value);
  }

  recordImmediatePayment(methodKey) {
    const calcs = this.state.getCalculations();
    const paidSoFar = this.payments.reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, calcs.total - paidSoFar);

    if (remaining <= 0) {
      this.state.addNotification("Checkout balance is already paid in full.", "warning");
      return;
    }

    const methodNames = {
      pos: "POS Terminal",
      cash: "Cash / Manual Check",
      online: "Online Stored Card",
      points: "Points Redemption",
      giftcard: "Gift Card Balance"
    };

    const method = methodNames[methodKey];
    const customer = this.state.activeCustomer;

    // Customer balance validations
    if (methodKey === "points") {
      if (!customer) {
        this.state.addNotification("Loyalty points require a guest profile.", "error");
        return;
      }
      const pointsVal = customer.pointsBalance / 10;
      if (remaining > pointsVal) {
        this.state.addNotification(`Insufficient points. Points value is ${formatINR(pointsVal)}.`, "error");
        return;
      }
    }

    if (methodKey === "giftcard") {
      if (!customer) {
        this.state.addNotification("Gift cards require a guest profile.", "error");
        return;
      }
      if (remaining > customer.giftCardBalance) {
        this.state.addNotification(`Insufficient balance. Gift card balance is ${formatINR(customer.giftCardBalance)}.`, "error");
        return;
      }
    }

    const transId = "TXN-" + Math.floor(100000 + Math.random() * 900000);
    this.payments.push({
      method,
      amount: remaining,
      transactionID: transId
    });

    this.state.addNotification(`Recorded ${formatINR(remaining)} payment via ${method}.`, "success");
    this.render();
  }

  clearPayments() {
    this.payments = [];
    this.state.addNotification("Payments partitions cleared.", "info");
    this.render();
  }

  removePayment(index) {
    this.payments.splice(index, 1);
    this.state.addNotification("Payment partition removed.", "info");
    this.render();
  }

  submitCheckout() {
    const calcs = this.state.getCalculations();
    const paidSoFar = this.payments.reduce((sum, p) => sum + p.amount, 0);
    const difference = Math.abs(calcs.total - paidSoFar);

    if (difference > 0.02) {
      this.state.addNotification("Balance remaining must be ₹0 to finalize.", "error");
      return;
    }

    // Capture remarks note
    const notes = this.state.currentInvoiceNotes || "";

    const receipt = this.state.processCheckout(this.payments, null);
    if (receipt) {
      receipt.notes = notes;
      
      const invoices = db.get("invoices");
      const idx = invoices.findIndex(i => i.id === receipt.id);
      if (idx !== -1) {
        invoices[idx].notes = notes;
        db.set("invoices", invoices);
      }

      this.finalizedInvoice = receipt;
      this.resetCheckoutState(true);
      
      // Auto trigger the right-hand receipt drawer open
      const drawer = document.getElementById("drawer-receipt-overlay");
      if (drawer) drawer.classList.add("active");
      
      this.renderReceiptDrawer();
    }
  }

  sendReceiptAction(type) {
    this.state.addNotification(`Sharing receipt via ${type.toUpperCase()}...`, "info");
    setTimeout(() => {
      this.state.addNotification(`Receipt successfully shared!`, "success");
    }, 1000);
  }

  generateWhatsAppMessage(inv) {
    const date = new Date(inv.createdAt);
    const dateStr = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const services = inv.items.filter(i => i.type === 'Service').map(i => i.name).join(', ');
    const total = inv.total;
    const name = inv.customerName || 'Valued Guest';
    const salonName = "Asmita's Beauty Salon & Academy | PMU Clinic";

    return `Hello ${name} ✨

Thank you for visiting ${salonName} today!

Your appointment details:
${services ? `• Service: ${services}` : ''}
• Date: ${dateStr}
• Amount Paid: ₹${total.toFixed(2)}

We hope you had a wonderful experience with us.
Looking forward to seeing you again 💇

— Team ${salonName}`;
  }

  sendFeedbackLink() {
    this.state.addNotification("Generating Guest Feedback link...", "info");
    setTimeout(() => {
      this.state.addNotification("Feedback questionnaire sent successfully.", "success");
    }, 1000);
  }

  printReceipt() {
    if (!this.finalizedInvoice) return;
    const inv = this.finalizedInvoice;
    const formattedDate = new Date(inv.createdAt).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    
    const settings = db.get("settings") || {};
    const template = settings.templateConfig || {
      headerTitle: "ASMITA'S BEAUTY SALON & ACADEMY",
      headerSubtitle: "PMU Clinic & Hair Care",
      headerPhone: "9876543210",
      footerText: "Thank you for visiting! We look forward to seeing you again."
    };
    
    const taxGroupName = settings.taxConfig?.taxGroupName || "GST";
    const taxNumber = settings.taxConfig?.taxNumber || "";

    const itemsHtml = inv.items.map(item => {
      const isSplit = item.splitRatio < 100;
      const staffInfo = item.stylistName.split(' ')[0] + (isSplit ? ` & ${item.splitStylistName.split(' ')[0]}` : '');
      return `
        <div class="receipt-item">
          <div class="receipt-row receipt-row-bold">
            <span>${item.name} (${item.qty}x)</span>
            <span>₹${(item.price * item.qty).toFixed(2)}</span>
          </div>
          <div class="receipt-item-details">
            Stylist: ${staffInfo}
            ${item.discount > 0 ? ` | Disc: -₹${(item.discount * item.qty).toFixed(2)}` : ''}
          </div>
        </div>
      `;
    }).join('');

    const paymentsHtml = inv.payments.map(p => `
      <div class="receipt-row">
        <span>* ${p.method}</span>
        <span>₹${p.amount.toFixed(2)}</span>
      </div>
    `).join('');

    const printWindow = window.open("", "_blank");
    printWindow.document.write(`
      <html>
        <head>
          <title>Receipt - ${template.headerTitle}</title>
          <style>
            @media print {
              @page {
                size: 80mm auto;
                margin: 0mm;
              }
              body {
                margin: 0;
                padding: 4mm 4mm 10mm 4mm;
              }
            }
            body {
              font-family: 'Courier New', monospace;
              width: 72mm;
              margin: 0 auto;
              color: #000;
              font-size: 11px;
              line-height: 1.4;
            }
            .receipt-header {
              text-align: center;
              margin-bottom: 12px;
            }
            .receipt-title {
              font-weight: bold;
              font-size: 13px;
              text-transform: uppercase;
              margin: 0 0 2px 0;
            }
            .receipt-subtitle {
              font-size: 10px;
              margin: 0 0 2px 0;
            }
            .receipt-phone, .receipt-tax {
              font-size: 9.5px;
              margin: 0;
            }
            .receipt-divider {
              border-top: 1px dashed #000;
              margin: 8px 0;
            }
            .receipt-row {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 3px;
            }
            .receipt-row-bold {
              font-weight: bold;
            }
            .receipt-item {
              margin-bottom: 6px;
            }
            .receipt-item-details {
              font-size: 9.5px;
              color: #333;
              padding-left: 4px;
            }
            .footer-msg {
              font-size: 10px;
              text-align: center;
              margin-top: 12px;
              font-style: italic;
            }
          </style>
        </head>
        <body onload="window.print(); window.close();">
          <div class="receipt-header">
            <div class="receipt-title">${template.headerTitle}</div>
            <div class="receipt-subtitle">${template.headerSubtitle}</div>
            <div class="receipt-phone">Phone: ${template.headerPhone}</div>
            ${taxNumber ? `<div class="receipt-tax">Tax Reg: ${taxNumber}</div>` : ''}
          </div>
          
          <div class="receipt-divider"></div>
          
          <div class="receipt-row">
            <span>Invoice No:</span>
            <span>${inv.id}</span>
          </div>
          <div class="receipt-row">
            <span>Date & Time:</span>
            <span>${formattedDate}</span>
          </div>
          <div class="receipt-row">
            <span>Customer:</span>
            <span>${inv.customerName}</span>
          </div>
          
          <div class="receipt-divider"></div>
          
          <div class="receipt-items">
            ${itemsHtml}
          </div>
          
          <div class="receipt-divider"></div>
          
          <div class="receipt-row">
            <span>Subtotal</span>
            <span>₹${inv.subtotal.toFixed(2)}</span>
          </div>
          ${inv.discount > 0 ? `
            <div class="receipt-row">
              <span>Discount</span>
              <span>-₹${inv.discount.toFixed(2)}</span>
            </div>
          ` : ""}
          <div class="receipt-row">
            <span>${taxGroupName}</span>
            <span>₹${inv.tax.toFixed(2)}</span>
          </div>
          ${inv.tip > 0 ? `
            <div class="receipt-row">
              <span>Tips</span>
              <span>₹${inv.tip.toFixed(2)}</span>
            </div>
          ` : ""}
          <div class="receipt-row receipt-row-bold" style="font-size: 12px; margin-top: 4px;">
            <span>GRAND TOTAL</span>
            <span>₹${inv.total.toFixed(2)}</span>
          </div>
          
          <div class="receipt-divider"></div>
          
          <div style="margin-bottom: 8px;">
            <div style="font-weight: bold; margin-bottom: 2px;">PAYMENT METHOD:</div>
            ${paymentsHtml}
          </div>
          
          ${inv.notes ? `
            <div style="font-size: 9.5px; border-top: 1px dotted #000; padding-top: 4px; font-style: italic;">
              Remarks: ${inv.notes}
            </div>
            <div class="receipt-divider"></div>
          ` : ''}
          
          <div class="footer-msg">
            ${template.footerText}
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
  }

  handlePreBookSubmit(e) {
    e.preventDefault();
    if (!this.selectedBookService || !this.selectedBookStylist) {
      alert("Please select both service and stylist.");
      return;
    }

    const stylists = db.get("stylists");
    const stylistName = stylists.find(s => s.id === this.selectedBookStylist)?.name || "";

    const appt = {
      customerID: this.state.activeCustomer ? this.state.activeCustomer.id : "Walk-in",
      customerName: this.state.activeCustomer ? this.state.activeCustomer.name : "Walk-in Customer",
      stylistID: this.selectedBookStylist,
      stylistName: stylistName,
      serviceName: this.selectedBookService,
      startTime: new Date(`${this.selectedBookDate}T${this.selectedBookTime}:00`).toISOString(),
      endTime: new Date(new Date(`${this.selectedBookDate}T${this.selectedBookTime}:00`).getTime() + 45 * 60 * 1000).toISOString()
    };

    this.state.addAppointment(appt);
    
    this.selectedBookService = "";
    this.selectedBookStylist = "";
    
    // Close the receipt drawer
    const drawer = document.getElementById("drawer-receipt-overlay");
    if (drawer) drawer.classList.remove("active");
  }

  render() {
    if (this.state.currentView !== "invoice-creator") return;

    const calcs = this.state.getCalculations();
    const isAllowedDiscount = this.state.activeStaff && (this.state.activeStaff.role === 'admin' || this.state.activeStaff.role === 'receptionist');
    const customer = this.state.activeCustomer;
    const settings = db.get("settings");

    const paidSoFar = this.payments.reduce((sum, p) => sum + p.amount, 0);
    const remainingToPay = Math.max(0, calcs.total - paidSoFar);

    this.container.innerHTML = `
      <div class="checkout-summary-panel">
        <div class="card-header" style="margin-bottom:12px;">
          <h3 class="card-title">Checkout Overview</h3>
        </div>

        <!-- Part 1: Discount & Tip adjustments -->
        <div class="checkout-adjustments-card">
          <!-- Global Discount inputs -->
          ${isAllowedDiscount ? `
            <div class="form-group" style="margin-bottom:10px; display:flex; flex-direction:column; gap:6px; border-bottom:1px solid var(--border-color); padding-bottom:10px;">
              <label class="form-label" style="font-size:0.75rem; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:var(--text-secondary);">Discount Type</label>
              <div style="display: flex; gap: 16px; margin-bottom: 4px;">
                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; cursor: pointer; color: var(--text-primary); font-weight: 500;">
                  <input type="radio" name="discount-type" value="percent" ${this.state.globalDiscount.type === 'percent' ? 'checked' : ''} style="accent-color:var(--primary);" /> Percentage (%)
                </label>
                <label style="display: flex; align-items: center; gap: 6px; font-size: 0.8rem; cursor: pointer; color: var(--text-primary); font-weight: 500;">
                  <input type="radio" name="discount-type" value="flat" ${this.state.globalDiscount.type === 'flat' ? 'checked' : ''} style="accent-color:var(--primary);" /> Fixed Amount (₹)
                </label>
              </div>

              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:0.7rem; color:var(--text-muted); font-weight:600;">
                  ${this.state.globalDiscount.type === 'percent' ? 'Discount Percentage (%)' : 'Discount Amount (₹)'}
                </label>
                <input type="number" id="global-discount-val" class="form-input" value="${this.state.globalDiscount.value}" min="0" ${this.state.globalDiscount.type === 'percent' ? 'max="100"' : ''} style="width: 100%; min-height:36px; height:36px; padding:6px 10px; font-size:0.85rem; font-weight:600;" placeholder="0" />
              </div>
            </div>
          ` : ""}

          <!-- Tipping selectors -->
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" style="font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:var(--text-secondary); margin-bottom:6px; display:block;">Add Tips</label>
            <div class="tip-preset-row" style="margin-bottom:6px; gap:4px;">
              <button class="tip-preset-btn ${this.state.tip.type === 'percent' && this.state.tip.value === 15 ? 'active' : ''}" data-tip="15" style="padding:4px; font-size:0.75rem;">15%</button>
              <button class="tip-preset-btn ${this.state.tip.type === 'percent' && this.state.tip.value === 18 ? 'active' : ''}" data-tip="18" style="padding:4px; font-size:0.75rem;">18%</button>
              <button class="tip-preset-btn ${this.state.tip.type === 'percent' && this.state.tip.value === 20 ? 'active' : ''}" data-tip="20" style="padding:4px; font-size:0.75rem;">20%</button>
              <button class="tip-preset-btn ${this.state.tip.type === 'percent' && this.state.tip.value === 25 ? 'active' : ''}" data-tip="25" style="padding:4px; font-size:0.75rem;">25%</button>
              <button class="tip-preset-btn ${this.state.tip.type === 'flat' ? 'active' : ''}" id="btn-custom-tip" style="padding:4px; font-size:0.75rem;">Custom</button>
            </div>
            
            ${this.state.tip.type === 'flat' ? `
              <div style="display:flex; align-items:center; gap:6px;">
                <span style="font-size:0.72rem; color:var(--text-secondary);">Tip Amount (₹):</span>
                <input type="number" class="form-input" id="custom-tip-val" value="${this.state.tip.value}" style="width: 80px; min-height: 28px; height:28px; padding: 2px 6px; font-size:0.78rem;" />
              </div>
            ` : ""}
          </div>
        </div>

        <!-- Part 2: Totals Calculation Card -->
        <div class="checkout-totals-card">
          <div class="checkout-total-row">
            <span>Subtotal</span>
            <span>${formatINR(calcs.rawSubtotal)}</span>
          </div>
          ${calcs.totalDiscount > 0 ? `
            <div class="checkout-total-row discount">
              <span>Discount (Saved)</span>
              <span>-${formatINR(calcs.totalDiscount)}</span>
            </div>
          ` : ""}
          <div class="checkout-total-row">
            <span>Taxes (${settings.taxConfig.taxGroupName})</span>
            <span>${formatINR(calcs.totalTax)}</span>
          </div>
          <div class="checkout-total-row">
            <span>Tips Added</span>
            <span>${formatINR(calcs.tipAmount)}</span>
          </div>
          <div class="checkout-total-row grand-total">
            <span>GRAND TOTAL</span>
            <span class="checkout-grand-total-val">${formatINR(calcs.total)}</span>
          </div>
        </div>

        <!-- Part 3: Split Payments builder ledger & Quick Pay grid -->
        <div class="checkout-payments-card">
          <label class="form-label" style="font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:var(--text-secondary); margin-bottom:4px; display:block;">Split Payment Partitions</label>
          ${this.payments.length === 0 ? `
            <div style="padding:10px; border:1px dashed var(--border-color); border-radius:var(--radius-md); text-align:center; color:var(--text-muted); font-size:0.78rem; background-color:rgba(0,0,0,0.05); margin-bottom:4px;">
              No payment partitions recorded.
            </div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:4px; background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:8px; margin-bottom:4px;">
              ${this.payments.map((p, idx) => `
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.78rem; border-bottom:1px solid rgba(255,255,255,0.03); padding-bottom:4px; margin-bottom:2px;">
                  <div>
                    <span style="font-weight:600; color:var(--text-primary);">${p.method}</span>
                    <span style="font-size:0.65rem; color:var(--text-muted);">(${p.transactionID.split('-')[1]})</span>
                  </div>
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-weight:700; color:var(--text-primary);">${formatINR(p.amount)}</span>
                    <button data-action="remove-split" data-idx="${idx}" style="background:none; border:none; color:var(--danger); cursor:pointer; font-weight:700; font-size:1.1rem; padding:2px 6px;">&times;</button>
                  </div>
                </div>
              `).join('')}
              <button class="btn btn-secondary btn-sm" id="btn-clear-splits-payment" style="width:100%; min-height:28px; height:28px; padding:2px; font-size:0.72rem; margin-top:4px; font-weight:600;">Clear partitions</button>
            </div>
          `}

          <label class="form-label" style="font-size:0.7rem; font-weight:700; text-transform:uppercase; letter-spacing:0.3px; color:var(--text-secondary); margin-top:4px; margin-bottom:4px; display:block;">Quick Pay (Remaining: ${formatINR(remainingToPay)})</label>
          <div class="checkout-quick-pay-grid">
            <button class="quick-pay-btn" data-action="quick-pay" data-method="pos">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" style="width:14px;height:14px;color:var(--primary);margin-bottom:2px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
              </svg>
              Card
            </button>
            <button class="quick-pay-btn" data-action="quick-pay" data-method="cash">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" style="width:14px;height:14px;color:var(--success);margin-bottom:2px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5h16.5M4.5 19.5h15M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Cash
            </button>
            <button class="quick-pay-btn" data-action="quick-pay" data-method="online" ${!customer ? 'disabled':''}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" style="width:14px;height:14px;color:var(--info);margin-bottom:2px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9s2.015-9 4.5-9yM3 9h18M3 15h18" />
              </svg>
              Stored
            </button>
            <button class="quick-pay-btn" data-action="quick-pay" data-method="points" ${!customer ? 'disabled':''}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" style="width:14px;height:14px;color:var(--warning);margin-bottom:2px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M11.48 3.499c-.19-.384-.782-.384-.97 0l-2.07 4.148-4.62.667c-.43.06-.602.579-.29.879l3.39 3.3-1.01 4.542c-.09.43.37.76.75.54l4.13-2.12 4.13 2.12c.38.22.84-.11.75-.54l-1.01-4.542 3.39-3.3c.31-.3.14-.81-.29-.879l-4.62-.667-2.07-4.148z" />
              </svg>
              Points
            </button>
            <button class="quick-pay-btn" data-action="quick-pay" data-method="giftcard" ${!customer ? 'disabled':''}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor" style="width:14px;height:14px;color:#a855f7;margin-bottom:2px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 11.25v8.25a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5v-8.25M12 4.875A2.625 2.625 0 109.375 7.5H12m0-2.625A2.625 2.625 0 1114.625 7.5H12m0 0V21m-8.625-9.75h17.25c.621 0 1.125-.504 1.125-1.125V8.625c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              GiftCard
            </button>
          </div>
        </div>

        <!-- Part 4: Bottom Finalize Actions (Sticky/Locked at bottom of card) -->
        <div class="checkout-footer">
          ${remainingToPay > 0.02 ? `
            <div class="checkout-balance-due-row">
              <span>Balance Due</span>
              <span class="checkout-balance-val">${formatINR(remainingToPay)}</span>
            </div>
          ` : `
            <div class="checkout-balance-due-row paid-full">
              <span style="display:flex; align-items:center; gap:6px;">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3.2" stroke="currentColor" style="width:14px;height:14px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                PAID IN FULL
              </span>
              <span class="checkout-balance-val">₹0</span>
            </div>
          `}

          <div style="display:flex; gap:12px;">
            <button class="checkout-btn-secondary" id="btn-save-draft-checkout" style="flex:1;">Save Draft</button>
            <button class="checkout-btn-primary" id="btn-finalize-checkout" style="flex:1.8;" ${remainingToPay > 0.02 || this.state.cart.length === 0 ? 'disabled':''}>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:16px;height:16px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0110 21a3.745 3.745 0 01-3.296-1.043A3.745 3.745 0 015.661 16.66 3.746 3.746 0 013 13c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.745 3.745 0 013.296-1.043A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" />
              </svg>
              Finalize Receipt
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  renderReceiptDrawer() {
    const drawerBody = document.getElementById("receipt-drawer-body");
    if (!drawerBody || !this.finalizedInvoice) return;

    const inv = this.finalizedInvoice;
    const formattedDate = new Date(inv.createdAt).toLocaleString();
    const isWalkin = !inv.customerID;
    
    const settings = db.get("settings");
    const template = settings.templateConfig;
    const services = db.get("services");
    const stylists = db.get("stylists");

    drawerBody.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:20px; height: 100%; overflow-y: auto; padding-right: 4px;">
        
        <!-- Success Confirmation Banner -->
        <div class="success-banner" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.05)); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-md); padding: 14px; display: flex; align-items: center; gap: 12px; flex-shrink: 0;">
          <div style="width: 36px; height: 36px; border-radius: 50%; background-color: var(--success); display: flex; align-items: center; justify-content: center; color: white; flex-shrink: 0; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.3);">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" style="width: 20px; height: 20px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div style="display: flex; flex-direction: column; line-height: 1.3;">
            <span style="font-weight: 700; font-size: 0.95rem; color: var(--success);">Billing Finalized!</span>
            <span style="font-size: 0.75rem; color: var(--text-secondary);">Invoice #${inv.id} generated successfully.</span>
          </div>
        </div>

        <!-- Thermal Ticket Visualizer -->
        <div class="receipt-paper" id="receipt-thermal-paper" style="font-family: 'Courier New', Courier, monospace; width:100%; border:1px solid #ccc; padding:16px;">
          <div class="receipt-header" style="text-align: center; margin-bottom: 8px;">
            <img src="/logo.png" alt="Asmita's Logo" style="height: 60px; width: 60px; border-radius: 50%; object-fit: cover; margin-bottom: 6px; border: 1px solid #ccc; display: block; margin-left: auto; margin-right: auto;" />
            <h3 class="receipt-title" style="font-size: 1.05rem; font-weight: bold; margin: 0;">${template.headerTitle}</h3>
            <p style="font-size:0.75rem; margin-top:2px; margin-bottom: 0;">${template.headerSubtitle}</p>
            <p style="font-size:0.75rem; margin: 0;">Phone: ${template.headerPhone}</p>
            <p style="font-size:0.75rem; margin: 0;">Tax Reg: ${settings.taxConfig.taxNumber}</p>
          </div>

          <div class="receipt-divider"></div>
          <div class="receipt-row" style="font-size:0.78rem;">
            <span>Bill Ref: ${inv.id}</span>
            <span>Date: ${formattedDate.split(',')[0]}</span>
          </div>
          <div class="receipt-row" style="font-size:0.78rem; margin-bottom:4px;">
            <span>Client: ${inv.customerName}</span>
            <span>Time: ${formattedDate.split(',')[1]}</span>
          </div>
          <div class="receipt-divider"></div>

          <!-- Items list -->
          <div style="margin:8px 0; font-size:0.78rem;">
            ${inv.items.map(item => `
              <div class="receipt-item-row" style="margin-bottom:4px;">
                <div class="receipt-row">
                  <span>${item.name} (${item.qty}x)</span>
                  <span>${formatINR(item.price * item.qty)}</span>
                </div>
                <div class="receipt-row" style="font-size:0.7rem; color:#555; padding-left:8px;">
                  <span>Stylist: ${item.stylistName.split(' ')[0]} ${item.splitRatio < 100 ? `& ${item.splitStylistName.split(' ')[0]}` : ''}</span>
                  ${item.discount > 0 ? `<span>Disc: -${formatINR(item.discount * item.qty)}</span>` : ""}
                </div>
              </div>
            `).join('')}
          </div>

          <div class="receipt-divider"></div>
          
          <div class="receipt-row" style="font-size:0.78rem;">
            <span>Subtotal</span>
            <span>${formatINR(inv.subtotal)}</span>
          </div>
          ${inv.discount > 0 ? `
            <div class="receipt-row" style="font-size:0.78rem;">
              <span>Discount</span>
              <span>-${formatINR(inv.discount)}</span>
            </div>
          ` : ""}
          <div class="receipt-row" style="font-size:0.78rem;">
            <span>${settings.taxConfig.taxGroupName}</span>
            <span>${formatINR(inv.tax)}</span>
          </div>
          ${inv.tip > 0 ? `
            <div class="receipt-row" style="font-size:0.78rem;">
              <span>Tip Amount</span>
              <span>${formatINR(inv.tip)}</span>
            </div>
          ` : ""}
          <div class="receipt-row" style="font-weight:700; font-size:0.95rem; margin-top:4px;">
            <span>GRAND TOTAL</span>
            <span>${formatINR(inv.total)}</span>
          </div>

          <div class="receipt-divider"></div>

          <!-- Payment splits -->
          <div style="font-size:0.75rem;">
            <p style="font-weight:bold; margin-bottom:2px;">PAYMENT PARTITIONS:</p>
            ${inv.payments.map(p => `
              <div class="receipt-row">
                <span>* ${p.method}</span>
                <span>${formatINR(p.amount)}</span>
              </div>
            `).join('')}
          </div>

          ${inv.notes ? `
            <div style="font-size:0.7rem; border-top:1px dotted #ccc; padding-top:4px; margin-top:6px; font-style:italic;">
              Remarks: ${inv.notes}
            </div>
          ` : ""}

          <div class="receipt-divider"></div>
          <div style="text-align:center; font-size:0.75rem; margin-top:8px; font-style:italic;">
            ${template.footerText}
          </div>
        </div>

        <!-- Receipt Actions -->
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:8px;">
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <button class="btn btn-secondary btn-sm" id="btn-print-receipt" style="min-height:40px; font-weight:600; display:flex; justify-content:center; align-items:center; gap:8px;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.82l-.24-2.48A2 2 0 018.47 9h7.06a2 2 0 011.99 2.34l-.24 2.48M16.5 9V5.25A2.25 2.25 0 0014.25 3h-4.5A2.25 2.25 0 007.5 5.25V9m9 0H18a2 2 0 012 2v6a2 2 0 01-2 2h-1.5m-7.5 0H4a2 2 0 01-2-2v-6a2 2 0 012-2h1.5m3.75 3h6.75a.75.75 0 01.75.75v3.75a.75.75 0 01-.75.75H8.25a.75.75 0 01-.75-.75V13.5a.75.75 0 01.75-.75z" />
              </svg>
              Print Receipt
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-download-pdf" style="min-height:40px; font-weight:600; display:flex; justify-content:center; align-items:center; gap:8px;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:16px;height:16px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              Download PDF
            </button>
          </div>

          <button class="btn btn-secondary btn-sm" id="btn-copy-whatsapp-msg" style="width:100%; min-height:40px; font-weight:600; display:flex; justify-content:center; align-items:center; gap:8px; background:linear-gradient(135deg, rgba(37,211,102,0.12), rgba(18,140,126,0.08)); border-color:rgba(37,211,102,0.3); color:var(--text-primary);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
            Copy WhatsApp Message
          </button>

          <button class="btn btn-primary btn-sm" id="btn-new-billing" style="width:100%; min-height:44px; font-size:0.92rem; font-weight:700; display:flex; justify-content:center; align-items:center; gap:8px; background:var(--primary); border:none; margin-top:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:16px;height:16px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Billing
          </button>
        </div>

        <!-- Part 4: Retention Booking Form -->
        <div style="border-top:1px solid var(--border-color); padding-top:14px; margin-bottom: 20px;">
          <h4 style="font-family:var(--font-display); font-size:0.95rem; font-weight:600; margin-bottom:4px;">Pre-Book Client's Next Visit</h4>
          <p style="font-size:0.72rem; color:var(--text-secondary); margin-bottom:8px;">Schedule their next appointment now to secure repeat business.</p>
          
          <form id="pre-book-checkout-form" style="display:flex; flex-direction:column; gap:8px; background-color:var(--bg-input); border:1px solid var(--border-color); padding:10px; border-radius:var(--radius-md);">
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:0.65rem;">Service</label>
              <select class="form-select" id="pre-book-service" style="min-height:32px; height:32px; font-size:0.78rem; padding:4px 8px;" required>
                <option value="" disabled selected>-- Select Service --</option>
                ${services.map(s => `<option value="${s.name}">${s.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label" style="font-size:0.65rem;">Stylist</label>
              <select class="form-select" id="pre-book-stylist" style="min-height:32px; height:32px; font-size:0.78rem; padding:4px 8px;" required>
                <option value="" disabled selected>-- Select Stylist --</option>
                ${stylists.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}
              </select>
            </div>
            <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:6px;">
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:0.65rem;">Date</label>
                <input type="date" class="form-input" id="pre-book-date" value="${this.selectedBookDate}" style="min-height:32px; height:32px; font-size:0.78rem; padding:4px 8px;" required />
              </div>
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:0.65rem;">Time</label>
                <input type="time" class="form-input" id="pre-book-time" value="${this.selectedBookTime}" style="min-height:32px; height:32px; font-size:0.78rem; padding:4px 8px;" required />
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-sm" style="margin-top:4px; width:100%; min-height:34px;">Schedule Pre-Booking</button>
          </form>
        </div>

      </div>
    `;

    this.bindReceiptEvents();
  }

  bindEvents() {
    // Global Discount Val changes
    const isAllowedDiscount = this.state.activeStaff && (this.state.activeStaff.role === 'admin' || this.state.activeStaff.role === 'receptionist');
    if (isAllowedDiscount) {
      const gVal = this.container.querySelector("#global-discount-val");
      const gTypes = this.container.querySelectorAll('input[name="discount-type"]');
      
      const updateDiscount = () => {
        if (!gVal) return;
        const val = parseFloat(gVal.value);
        const typeActive = this.container.querySelector('input[name="discount-type"]:checked');
        const type = typeActive ? typeActive.value : "percent";
        const calcs = this.state.getCalculations();
        const totalBeforeGlobalDiscount = Math.max(0, calcs.rawSubtotal - calcs.itemDiscounts);

        if (isNaN(val) || val < 0) {
          this.state.addNotification("Please enter a valid positive discount.", "error");
          this.render();
          return;
        }

        if (type === "percent") {
          if (val > 100) {
            this.state.addNotification("Percentage discount cannot exceed 100%.", "error");
            this.render();
            return;
          }
          this.state.setGlobalDiscount(type, val);
        } else {
          if (val > totalBeforeGlobalDiscount) {
            this.state.addNotification(`Fixed discount (₹${val}) cannot exceed subtotal (₹${totalBeforeGlobalDiscount.toFixed(2)}).`, "error");
            this.render();
            return;
          }
          this.state.setGlobalDiscount(type, val);
        }
      };

      if (gVal) {
        gVal.addEventListener("change", updateDiscount);
      }
      gTypes.forEach(radio => {
        radio.addEventListener("change", (e) => {
          const type = e.target.value;
          const currentVal = parseFloat(gVal ? gVal.value : 0) || 0;
          const calcs = this.state.getCalculations();
          const totalBeforeGlobalDiscount = Math.max(0, calcs.rawSubtotal - calcs.itemDiscounts);
          
          if (type === "percent") {
            const val = Math.min(100, currentVal);
            this.state.setGlobalDiscount(type, val);
          } else {
            const val = Math.min(totalBeforeGlobalDiscount, currentVal);
            this.state.setGlobalDiscount(type, val);
          }
        });
      });
    }

    // Tips preset changes
    const tipBtns = this.container.querySelectorAll(".tip-preset-btn");
    tipBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const val = parseInt(btn.dataset.tip);
        this.handleTipChange("percent", val);
      });
    });

    const customTipBtn = this.container.querySelector("#btn-custom-tip");
    if (customTipBtn) {
      customTipBtn.addEventListener("click", () => {
        this.handleTipChange("flat", 10.00);
      });
    }

    const customTipValInput = this.container.querySelector("#custom-tip-val");
    if (customTipValInput) {
      customTipValInput.addEventListener("change", (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val) && val >= 0) this.handleTipChange("flat", val);
      });
    }

    // Quick pay click triggers
    const payBtns = this.container.querySelectorAll('[data-action="quick-pay"]');
    payBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const methodKey = btn.dataset.method;
        this.recordImmediatePayment(methodKey);
      });
    });

    // Remove partition split pay
    this.container.querySelectorAll('[data-action="remove-split"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        const idx = parseInt(btn.dataset.idx);
        this.removePayment(idx);
      });
    });

    const clearSplitsBtn = this.container.querySelector("#btn-clear-splits-payment");
    if (clearSplitsBtn) {
      clearSplitsBtn.addEventListener("click", () => this.clearPayments());
    }

    // Save Draft click
    const saveDraftBtn = this.container.querySelector("#btn-save-draft-checkout");
    if (saveDraftBtn) {
      saveDraftBtn.addEventListener("click", () => {
        // Enforce notes
        const notes = this.state.currentInvoiceNotes || "";
        this.state.saveDraft(notes);
      });
    }

    // Finalize checkout click
    const finalizeBtn = this.container.querySelector("#btn-finalize-checkout");
    if (finalizeBtn) {
      finalizeBtn.addEventListener("click", () => this.submitCheckout());
    }
  }

  bindReceiptEvents() {
    const drawerBody = document.getElementById("receipt-drawer-body");
    if (!drawerBody) return;

    const printBtn = drawerBody.querySelector("#btn-print-receipt");
    if (printBtn) printBtn.addEventListener("click", () => this.printReceipt());

    const downloadBtn = drawerBody.querySelector("#btn-download-pdf");
    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => {
        this.state.addNotification("Opening print browser dialog. Select 'Save as PDF' to download.", "info");
        this.printReceipt();
      });
    }

    const newBillingBtn = drawerBody.querySelector("#btn-new-billing");
    if (newBillingBtn) {
      newBillingBtn.addEventListener("click", () => {
        this.startNewBilling();
      });
    }

    // WhatsApp copy button
    const waBtn = drawerBody.querySelector("#btn-copy-whatsapp-msg");
    if (waBtn && this.finalizedInvoice) {
      waBtn.addEventListener("click", () => {
        const msg = this.generateWhatsAppMessage(this.finalizedInvoice);
        navigator.clipboard.writeText(msg).then(() => {
          waBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg> Copied WhatsApp Text!`;
          waBtn.style.background = "linear-gradient(135deg, rgba(16,185,129,0.2), rgba(5,150,105,0.15))";
          setTimeout(() => {
            waBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copy WhatsApp Message`;
            waBtn.style.background = "";
          }, 2500);
        }).catch(() => {
          this.state.addNotification("Could not copy to clipboard.", "error");
        });
      });
    }

    const prebookForm = drawerBody.querySelector("#pre-book-checkout-form");
    if (prebookForm) {
      const svcSelect = prebookForm.querySelector("#pre-book-service");
      const stySelect = prebookForm.querySelector("#pre-book-stylist");
      const dateInput = prebookForm.querySelector("#pre-book-date");
      const timeInput = prebookForm.querySelector("#pre-book-time");

      svcSelect.value = this.selectedBookService;
      stySelect.value = this.selectedBookStylist;

      svcSelect.addEventListener("change", (e) => { this.selectedBookService = e.target.value; });
      stySelect.addEventListener("change", (e) => { this.selectedBookStylist = e.target.value; });
      dateInput.addEventListener("change", (e) => { this.selectedBookDate = e.target.value; });
      timeInput.addEventListener("change", (e) => { this.selectedBookTime = e.target.value; });

      prebookForm.addEventListener("submit", (e) => this.handlePreBookSubmit(e));
    }
  }
}
