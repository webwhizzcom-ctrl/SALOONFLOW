// src/state.js
import { db } from "./db.js";
import {
  loadCustomersFromCloud,
  loadAppointmentsFromCloud,
  loadInvoicesFromCloud,
  upsertCustomer,
  upsertAppointment,
  deleteAppointment,
  saveInvoice,
  subscribeToCustomers,
  subscribeToAppointments,
  subscribeToInvoices,
  seedFromLocalStorage
} from "./lib/supabaseDb.js";
import { isSupabaseReady } from "./lib/supabase.js";

db.init();

class State {
  constructor() {
    this.listeners = [];
    this.offlineMode = false;
    this.activeCustomer = null;
    this.cart = []; // Line items
    this.globalDiscount = { type: "flat", value: 0 };
    this.tip = { type: "flat", value: 0 };
    this.offlineQueue = [];
    this.notifications = [];
    
    // New Redesign States
    this.currentView = "invoice-creator"; 
    this.sidebarCollapsed = false;
    this.globalSearchQuery = "";
    
    // Auth & Gating
    this.activeStaff = null;
    this.isAuthenticated = false;
    this.isLocked = true;

    // Cloud sync state
    this.cloudSyncReady = false;
    this.cloudSyncError = null;

    this.cleanExpiredDrafts();
    this.startDraftExpiryCron();

    // Boot cloud sync in background (non-blocking)
    this.initCloudSync();
  }

  // ─── SUPABASE CLOUD SYNC ────────────────────────────────────────────────────

  async initCloudSync() {
    if (!isSupabaseReady()) {
      console.warn('[SalonFlow] Supabase not ready — running localStorage-only mode.');
      return;
    }

    try {
      // 1. One-time migration: push existing localStorage data to Supabase
      const localCustomers    = db.get('customers') || [];
      const localAppointments = db.get('appointments') || [];
      const localInvoices     = db.get('invoices') || [];

      // Only seed if there's local data that hasn't been synced yet
      const hasLocalData = localCustomers.length > 0 || localInvoices.length > 0;
      if (hasLocalData) {
        seedFromLocalStorage(localCustomers, localAppointments, localInvoices);
      }

      // 2. Pull fresh data from Supabase into localStorage
      const [cloudCustomers, cloudAppointments, cloudInvoices] = await Promise.all([
        loadCustomersFromCloud(),
        loadAppointmentsFromCloud(),
        loadInvoicesFromCloud()
      ]);

      if (cloudCustomers && cloudCustomers.length > 0) {
        db.set('customers', cloudCustomers, true);
      }
      if (cloudAppointments && cloudAppointments.length > 0) {
        db.set('appointments', cloudAppointments, true);
      }
      if (cloudInvoices && cloudInvoices.length > 0) {
        db.set('invoices', cloudInvoices, true);
      }

      this.cloudSyncReady = true;
      this.notify();

      // 3. Subscribe to realtime changes — any device change syncs all devices
      subscribeToCustomers((freshCustomers) => {
        db.set('customers', freshCustomers, true);
        this.notify();
        this.addNotification('Customer records synced from cloud.', 'info');
      });

      subscribeToAppointments((freshAppointments) => {
        db.set('appointments', freshAppointments, true);
        this.notify();
        this.addNotification('Appointments updated from another device.', 'info');
      });

      subscribeToInvoices((freshInvoices) => {
        db.set('invoices', freshInvoices, true);
        this.notify();
      });

      console.log('[SalonFlow] Cloud sync ready ✓');
    } catch (err) {
      this.cloudSyncError = err.message || 'Cloud sync failed';
      console.error('[SalonFlow] Cloud sync init error:', err);
      // App continues working on localStorage — no crash
    }
  }

  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notify() {
    this.listeners.forEach(callback => callback(this));
  }

  lockScreen() {
    this.isLocked = true;
    this.isAuthenticated = false;
    this.activeStaff = null;
    this.clearCart();
    this.clearCustomer();
    this.notify();
  }

  unlockScreen(staffId) {
    const stylists = db.get("stylists");
    const staff = stylists.find(s => s.id === staffId);
    if (staff) {
      this.activeStaff = staff;
      this.isLocked = false;
      this.isAuthenticated = true;
      this.notify();
    }
  }

  validateViewPermission(view, role) {
    if (role === "admin") return true;
    if (role === "receptionist") {
      return ["invoice-creator", "customers", "appointments", "invoice-history"].includes(view);
    }
    if (role === "senior_staff" || role === "junior_staff" || role === "stylist") {
      return ["appointments"].includes(view);
    }
    return false;
  }

  canViewRevenue() {
    return this.activeStaff && this.activeStaff.role === "admin";
  }

  canExportReports() {
    return this.activeStaff && this.activeStaff.role === "admin";
  }

  canManageSettings() {
    return this.activeStaff && this.activeStaff.role === "admin";
  }

  setView(view) {
    const role = this.activeStaff ? this.activeStaff.role : "stylist";
    if (!this.validateViewPermission(view, role)) {
      alert("Access Denied: You do not have permission to view this section.");
      // Redirect to safe default for role
      if (role === "receptionist") {
        this.currentView = "appointments";
      } else {
        this.currentView = "appointments";
      }
    } else {
      this.currentView = view;
    }
    this.notify();
  }

  toggleSidebar() {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    this.notify();
  }

  setGlobalSearch(query) {
    this.globalSearchQuery = query;
    this.notify();
  }

  setActiveStaff(staffId) {
    const stylists = db.get("stylists");
    const staff = stylists.find(s => s.id === staffId);
    if (staff) {
      this.activeStaff = staff;
      this.addNotification(`Switched operator profile to ${staff.name}`, "info");
      
      const role = staff.role;
      if (!this.validateViewPermission(this.currentView, role)) {
        this.currentView = "appointments";
      }
      this.notify();
    }
  }

  // Toggle offline mode
  toggleOfflineMode() {
    this.offlineMode = !this.offlineMode;
    if (!this.offlineMode && this.offlineQueue.length > 0) {
      this.syncOfflineInvoices();
    } else {
      this.addNotification(
        this.offlineMode 
          ? "Terminal is now OFFLINE. Operations are saved to offline cache." 
          : "Terminal is ONLINE.",
        this.offlineMode ? "warning" : "success"
      );
    }
    this.notify();
  }

  addNotification(message, type = "info") {
    const id = Date.now() + Math.random().toString(36).substr(2, 5);
    this.notifications.push({ id, message, type, time: new Date() });
    this.notify();
    // Auto-remove notification after 5 seconds
    setTimeout(() => {
      this.notifications = this.notifications.filter(n => n.id !== id);
      this.notify();
    }, 5000);
  }

  selectCustomer(customer) {
    this.activeCustomer = customer;
    this.notify();
  }

  clearCustomer() {
    this.activeCustomer = null;
    this.notify();
  }

  // Cart operations
  addToCart(item) {
    const existing = this.cart.find(c => c.itemID === item.id);
    const stylists = db.get("stylists") || [];
    
    // Default stylist to current active staff if they are a Stylist/Staff, otherwise select first stylist
    let defaultStylist = this.activeStaff;
    if (!defaultStylist || defaultStylist.role === "receptionist" || defaultStylist.role === "admin") {
      defaultStylist = stylists.find(s => s.role !== "receptionist" && s.role !== "admin") || stylists[0] || { id: "Sarah-Miller", name: "Sarah Miller" };
    }

    if (existing) {
      existing.qty += 1;
    } else {
      this.cart.push({
        id: "cart-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
        itemID: item.id,
        name: item.name,
        type: item.type,
        price: item.price,
        qty: 1,
        discount: 0,
        defaultTax: item.defaultTax ?? 0,
        stylistID: defaultStylist.id,
        stylistName: defaultStylist.name,
        splitStylistID: "",
        splitStylistName: "",
        splitRatio: 100
      });
    }
    this.notify();
  }

  removeFromCart(cartItemId) {
    this.cart = this.cart.filter(item => item.id !== cartItemId);
    this.notify();
  }

  updateCartItem(cartItemId, fields) {
    this.cart = this.cart.map(item => {
      if (item.id === cartItemId) {
        const updated = { ...item, ...fields };
        if (updated.splitRatio === 100) {
          updated.splitStylistID = "";
          updated.splitStylistName = "";
        }
        return updated;
      }
      return item;
    });
    this.notify();
  }

  clearCart() {
    this.cart = [];
    this.globalDiscount = { type: "flat", value: 0 };
    this.tip = { type: "flat", value: 0 };
    this.notify();
  }

  setGlobalDiscount(type, value) {
    const val = parseFloat(value);
    if (isNaN(val) || val < 0) return;
    const finalType = type === "flat" ? "flat" : "percent";
    const finalVal = finalType === "percent" ? Math.min(100, val) : val;
    this.globalDiscount = { type: finalType, value: finalVal };
    this.notify();
  }

  setTip(type, value) {
    const val = parseFloat(value);
    if (isNaN(val) || val < 0) {
      this.tip = { type: "percent", value: 18 }; // fallback default
    } else {
      this.tip = { type: type === "flat" ? "flat" : "percent", value: val };
    }
    this.notify();
  }

  // Get invoice calculations
  getCalculations() {
    let subtotal = 0;
    let itemDiscounts = 0;

    this.cart.forEach(item => {
      const price = parseFloat(item.price);
      const qty = parseInt(item.qty);
      const discount = parseFloat(item.discount);

      const itemPrice = isNaN(price) ? 0 : price;
      const itemQty = isNaN(qty) || qty < 0 ? 0 : qty;
      const itemDiscount = isNaN(discount) || discount < 0 ? 0 : discount;

      const lineOriginalTotal = itemPrice * itemQty;
      const lineDiscount = Math.min(itemDiscount * itemQty, lineOriginalTotal);

      subtotal += lineOriginalTotal;
      itemDiscounts += lineDiscount;
    });

    const totalBeforeGlobalDiscount = Math.max(0, subtotal - itemDiscounts);
    let globalDiscountVal = parseFloat(this.globalDiscount.value);
    if (isNaN(globalDiscountVal) || globalDiscountVal < 0) {
      globalDiscountVal = 0;
    }

    let globalDiscountAmount = 0;
    if (this.globalDiscount.type === "percent") {
      const discountPercent = Math.min(100, globalDiscountVal);
      globalDiscountAmount = totalBeforeGlobalDiscount * (discountPercent / 100);
    } else {
      globalDiscountAmount = Math.min(globalDiscountVal, totalBeforeGlobalDiscount);
    }

    const finalSubtotal = Math.max(0, totalBeforeGlobalDiscount - globalDiscountAmount);

    return {
      rawSubtotal: subtotal,
      itemDiscounts,
      globalDiscountAmount,
      totalDiscount: itemDiscounts + globalDiscountAmount,
      subtotalAfterDiscount: finalSubtotal,
      serviceTax: 0,
      productTax: 0,
      totalTax: 0,
      tipAmount: 0,
      total: finalSubtotal
    };
  }

  // Enforce 24-hour expiry check
  cleanExpiredDrafts() {
    const invoices = db.get("invoices");
    let changed = false;
    
    const now = new Date();
    const updatedInvoices = invoices.map(inv => {
      if (inv.status === "Draft" && inv.expiresAt) {
        const expiry = new Date(inv.expiresAt);
        if (now > expiry) {
          changed = true;
          return { ...inv, status: "Canceled", notes: (inv.notes || "") + "\n[System: Auto-canceled draft due to 24-hour expiration rule]" };
        }
      }
      return inv;
    });

    if (changed) {
      db.set("invoices", updatedInvoices);
      this.logAudit("Draft Auto-Cleanup", null, { count: updatedInvoices.filter(i => i.status === "Canceled" && i.notes.includes("Auto-canceled draft")).length }, "System");
    }
  }

  startDraftExpiryCron() {
    setInterval(() => {
      const invoices = db.get("invoices");
      const now = new Date();
      let changed = false;

      invoices.forEach(inv => {
        if (inv.status === "Draft" && inv.expiresAt) {
          const expiry = new Date(inv.expiresAt);
          const diffMs = expiry - now;
          const diffMins = Math.floor(diffMs / (60 * 1000));

          if (diffMins === 59 && !inv.notifiedExpiry) {
            this.addNotification(`Draft Invoice ${inv.id} for ${inv.customerName || "Walk-in"} will expire in 1 hour!`, "warning");
            inv.notifiedExpiry = true;
            changed = true;
          }

          if (diffMs <= 0) {
            this.addNotification(`Draft Invoice ${inv.id} has expired and has been canceled automatically.`, "error");
            inv.status = "Canceled";
            inv.notes = (inv.notes || "") + "\n[System: Auto-canceled draft due to 24-hour expiration rule]";
            this.logAudit("Draft Expired", inv.id, { customer: inv.customerName }, "System");
            changed = true;
          }
        }
      });

      if (changed) {
        db.set("invoices", invoices);
        this.notify();
      }
    }, 15000);
  }

  // Save as Pending Draft
  saveDraft(internalNotes = "") {
    if (this.cart.length === 0) {
      alert("Cannot save draft. Cart is empty.");
      return;
    }

    const settings = db.get("settings");
    const prefix = settings.invoicePrefix || "SAL-2026-";
    const nextNum = settings.nextInvoiceNum || 101;
    const invoiceId = `${prefix}${nextNum}`;

    settings.nextInvoiceNum = nextNum + 1;
    db.set("settings", settings);

    const calculations = this.getCalculations();
    const now = new Date();
    const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const newDraft = {
      id: invoiceId,
      customerID: this.activeCustomer ? this.activeCustomer.id : "",
      customerName: this.activeCustomer ? this.activeCustomer.name : "Walk-in Customer",
      status: "Draft",
      items: [...this.cart],
      tax: calculations.totalTax,
      discount: calculations.totalDiscount,
      tip: 0,
      subtotal: calculations.subtotalAfterDiscount,
      total: calculations.subtotalAfterDiscount + calculations.totalTax,
      payments: [],
      createdAt: now.toISOString(),
      expiresAt: expiry.toISOString(),
      notes: internalNotes,
      notifiedExpiry: false
    };

    if (this.offlineMode) {
      this.offlineQueue.push(newDraft);
      this.addNotification(`Draft saved offline as ${invoiceId}. It will sync when online.`, "warning");
    } else {
      const invoices = db.get("invoices");
      invoices.push(newDraft);
      db.set("invoices", invoices);
      this.addNotification(`Draft Invoice ${invoiceId} successfully saved (Expires in 24 hours).`, "success");
      this.logAudit("Draft Created", invoiceId, { total: newDraft.total, customer: newDraft.customerName }, this.activeStaff ? this.activeStaff.role : "Staff");
    }

    this.clearCart();
    this.clearCustomer();
    this.notify();
  }

  saveDraftEdits(invoiceId, internalNotes = "") {
    const invoices = db.get("invoices");
    const index = invoices.findIndex(i => i.id === invoiceId);
    if (index === -1) return;

    const calculations = this.getCalculations();
    invoices[index] = {
      ...invoices[index],
      customerID: this.activeCustomer ? this.activeCustomer.id : "",
      customerName: this.activeCustomer ? this.activeCustomer.name : "Walk-in Customer",
      items: [...this.cart],
      tax: calculations.totalTax,
      discount: calculations.totalDiscount,
      subtotal: calculations.subtotalAfterDiscount,
      total: calculations.subtotalAfterDiscount + calculations.totalTax,
      notes: internalNotes
    };

    db.set("invoices", invoices);
    this.addNotification(`Draft Invoice ${invoiceId} updated.`, "success");
    this.logAudit("Draft Updated", invoiceId, { total: invoices[index].total }, this.activeStaff ? this.activeStaff.role : "Staff");

    this.clearCart();
    this.clearCustomer();
    this.notify();
  }

  loadDraft(draftInvoice) {
    this.cart = [...draftInvoice.items];
    const customers = db.get("customers");
    const customer = customers.find(c => c.id === draftInvoice.customerID);
    this.activeCustomer = customer || null;
    this.notify();
  }

  processCheckout(payments, preBookAppointment = null) {
    if (this.cart.length === 0) {
      alert("Cart is empty.");
      return null;
    }

    const calculations = this.getCalculations();
    const settings = db.get("settings");
    const prefix = settings.invoicePrefix || "SAL-2026-";
    const nextNum = settings.nextInvoiceNum || 101;
    const invoiceId = `${prefix}${nextNum}`;

    settings.nextInvoiceNum = nextNum + 1;
    db.set("settings", settings);

    const now = new Date();
    const newInvoice = {
      id: invoiceId,
      customerID: this.activeCustomer ? this.activeCustomer.id : "",
      customerName: this.activeCustomer ? this.activeCustomer.name : "Walk-in Customer",
      status: "Final",
      items: [...this.cart],
      tax: calculations.totalTax,
      discount: calculations.totalDiscount,
      tip: calculations.tipAmount,
      subtotal: calculations.subtotalAfterDiscount,
      total: calculations.total,
      payments: payments,
      createdAt: now.toISOString(),
      expiresAt: null
    };

    if (this.offlineMode) {
      this.offlineQueue.push(newInvoice);
      this.addNotification(`Invoice ${invoiceId} cached offline. Synced automatically when online.`, "warning");
      this.logAudit("Offline Checkout Queue", invoiceId, { total: newInvoice.total }, "Offline-User");
    } else {
      const invoices = db.get("invoices");
      invoices.push(newInvoice);
      db.set("invoices", invoices);

      this.deductProductInventory(this.cart);
      this.updateCustomerBalances(payments, calculations.total);

      if (preBookAppointment) {
        this.addAppointment(preBookAppointment);
      }

      // Cloud sync invoice — fire and forget, never blocks billing
      saveInvoice(newInvoice).catch(err =>
        console.error('[SalonFlow] saveInvoice to cloud failed:', err)
      );

      this.addNotification(`Invoice ${invoiceId} finalized successfully!`, "success");
      this.logAudit("Checkout Completed", invoiceId, { total: newInvoice.total, payments }, this.activeStaff ? this.activeStaff.role : "Staff");
    }

    const invoiceCopy = JSON.parse(JSON.stringify(newInvoice));
    this.clearCart();
    this.clearCustomer();
    this.notify();

    return invoiceCopy;
  }

  deductProductInventory(cartItems) {
    const products = db.get("products");
    let changed = false;
    cartItems.forEach(item => {
      if (item.type === "Product") {
        const prod = products.find(p => p.id === item.itemID);
        if (prod) {
          prod.stock = Math.max(0, prod.stock - item.qty);
          changed = true;
        }
      }
    });
    if (changed) {
      db.set("products", products);
    }
  }

  updateCustomerBalances(payments, totalBill) {
    if (!this.activeCustomer) return;

    const customers = db.get("customers");
    const custIndex = customers.findIndex(c => c.id === this.activeCustomer.id);
    if (custIndex === -1) return;

    const customer = customers[custIndex];
    customer.totalVisits += 1;
    customer.lastVisitDate = new Date().toISOString().split("T")[0];

    let servicesTotal = 0;
    this.cart.forEach(item => {
      if (item.type === "Service") {
        servicesTotal += (item.price - item.discount) * item.qty;
      }
    });
    const pointsEarned = Math.floor(servicesTotal);
    customer.pointsBalance += pointsEarned;

    payments.forEach(pay => {
      if (pay.method === "Points Redemption") {
        const pointsDeducted = Math.floor(pay.amount * 10);
        customer.pointsBalance = Math.max(0, customer.pointsBalance - pointsDeducted);
      } else if (pay.method === "Gift Card Balance") {
        customer.giftCardBalance = Math.max(0, customer.giftCardBalance - pay.amount);
      }
    });

    customers[custIndex] = customer;
    db.set("customers", customers);

    // Sync updated customer to cloud
    upsertCustomer(customer).catch(err =>
      console.error('[SalonFlow] upsertCustomer (balance) failed:', err)
    );
  }

  addAppointment(appt) {
    const appointments = db.get("appointments");
    const newAppt = {
      id: "AP-" + Date.now(),
      customerID: appt.customerID,
      customerName: appt.customerName,
      stylistID: appt.stylistID,
      stylistName: appt.stylistName,
      serviceName: appt.serviceName,
      startTime: appt.startTime,
      endTime: appt.endTime,
      status: "Scheduled"
    };
    appointments.push(newAppt);
    db.set("appointments", appointments);
    this.addNotification("Re-booking appointment scheduled!", "success");

    // Cloud sync — fire and forget, does not block UI
    upsertAppointment(newAppt).catch(err =>
      console.error('[SalonFlow] upsertAppointment failed:', err)
    );
  }

  syncOfflineInvoices() {
    const invoices = db.get("invoices");
    const currentQueue = [...this.offlineQueue];
    this.offlineQueue = [];

    let syncCount = 0;
    currentQueue.forEach(offlineInv => {
      if (!invoices.find(i => i.id === offlineInv.id)) {
        invoices.push(offlineInv);
        syncCount++;
        this.deductProductInventory(offlineInv.items);
        this.logAudit("Offline Sync Completed", offlineInv.id, { total: offlineInv.total }, "System-Sync");
      }
    });

    db.set("invoices", invoices);
    this.addNotification(`Successfully synced ${syncCount} offline invoices to the cloud database!`, "success");
    this.notify();
  }

  verifyPIN(pin, role = "Manager") {
    const settings = db.get("settings");
    const security = settings.securityCodes;
    const cleanPin = pin.trim().toLowerCase();
    
    if (role === "Manager" && cleanPin === security.managerPIN.toLowerCase()) {
      return true;
    }
    if (role === "Admin" && cleanPin === security.adminPIN.toLowerCase()) {
      return true;
    }
    if (cleanPin === security.managerPIN.toLowerCase() || cleanPin === security.adminPIN.toLowerCase()) {
      return true;
    }
    return false;
  }

  cancelInvoice(invoiceId, pin, reason) {
    if (!this.verifyPIN(pin)) {
      alert("Invalid Override Code. Verification failed.");
      return false;
    }

    const invoices = db.get("invoices");
    const index = invoices.findIndex(i => i.id === invoiceId);
    if (index === -1) return false;

    invoices[index].status = "Canceled";
    invoices[index].notes = (invoices[index].notes || "") + `\n[Canceled by Supervisor: ${reason}]`;
    db.set("invoices", invoices);

    alert(`Invoice ${invoiceId} has been canceled and refunded.`);
    this.logAudit("Invoice Cancelled", invoiceId, { reason, originalTotal: invoices[index].total }, "Manager");
    this.notify();
    return true;
  }

  modifyInvoiceAfterCheckout(invoiceId, pin, updatedFields, reason) {
    if (!this.verifyPIN(pin)) {
      alert("Invalid Override Code. Verification failed.");
      return false;
    }

    const invoices = db.get("invoices");
    const index = invoices.findIndex(i => i.id === invoiceId);
    if (index === -1) return false;

    invoices[index] = { ...invoices[index], ...updatedFields };
    db.set("invoices", invoices);

    alert(`Invoice ${invoiceId} adjusted and re-audited.`);
    this.logAudit("Post-Checkout Modification", invoiceId, { reason, changes: updatedFields }, "Manager");
    this.notify();
    return true;
  }

  logAudit(action, invoiceId, details, userRole) {
    const logs = db.get("audit_logs");
    logs.unshift({
      id: "LOG-" + Date.now() + "-" + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      action,
      invoiceId: invoiceId || "N/A",
      details,
      user: userRole
    });
    db.set("audit_logs", logs);
  }

  // Get Analytics indicators for Dashboard
  getAnalyticsData() {
    const invoices = db.get("invoices").filter(i => i.status === "Final");
    const appts = db.get("appointments");
    
    // Sum revenue
    const revenue = invoices.reduce((sum, i) => sum + i.total, 0);
    const bookings = appts.length;
    
    // Average tickets
    const avgTicket = invoices.length > 0 ? (revenue / invoices.length) : 0;
    
    // Product vs Service splits
    let serviceSales = 0;
    let productSales = 0;
    
    invoices.forEach(inv => {
      inv.items.forEach(item => {
        if (item.type === "Service") {
          serviceSales += (item.price - (item.discount || 0)) * item.qty;
        } else if (item.type === "Product") {
          productSales += (item.price - (item.discount || 0)) * item.qty;
        }
      });
    });

    // Stylist Commission Rankings
    const stylistCommissions = {};
    const stylists = db.get("stylists");
    invoices.forEach(inv => {
      inv.items.forEach(item => {
        const itemRevenue = (item.price - (item.discount || 0)) * item.qty;
        
        // Primary Stylist commission
        const primaryStylist = stylists.find(s => s.id === item.stylistID);
        const primaryRate = primaryStylist ? primaryStylist.commissionRate : 0.5;
        const primaryCommission = itemRevenue * (item.splitRatio / 100) * primaryRate;
        stylistCommissions[item.stylistID] = (stylistCommissions[item.stylistID] || 0) + primaryCommission;
        
        // Secondary split stylist
        if (item.splitStylistID) {
          const secondaryStylist = stylists.find(s => s.id === item.splitStylistID);
          const secondaryRate = secondaryStylist ? secondaryStylist.commissionRate : 0.5;
          const secondaryCommission = itemRevenue * ((100 - item.splitRatio) / 100) * secondaryRate;
          stylistCommissions[item.splitStylistID] = (stylistCommissions[item.splitStylistID] || 0) + secondaryCommission;
        }
      });
    });

    const rankings = Object.keys(stylistCommissions).map(id => {
      const stylist = stylists.find(s => s.id === id);
      return {
        id,
        name: stylist ? stylist.name : "Unknown",
        role: stylist ? stylist.role : "Stylist",
        title: stylist ? (stylist.title || stylist.role) : "Stylist",
        commissionEarned: stylistCommissions[id]
      };
    }).sort((a, b) => b.commissionEarned - a.commissionEarned);

    return {
      revenue,
      bookings,
      avgTicket,
      serviceSales,
      productSales,
      rankings,
      invoicesCount: invoices.length
    };
  }
}

export const state = new State();
window.__state = state;
