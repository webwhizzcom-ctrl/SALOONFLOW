// src/main.js
import { db } from "./db.js";
import { state } from "./state.js";
import { DashboardView } from "./components/DashboardView.js";
import { CustomerDashboard } from "./components/CustomerDashboard.js";
import { InvoiceCreator } from "./components/InvoiceCreator.js";
import { PaymentCheckout } from "./components/PaymentCheckout.js";
import { AppointmentsView } from "./components/AppointmentsView.js";
import { InvoiceHistory } from "./components/InvoiceHistory.js";
import { StaffView } from "./components/StaffView.js";
import { AdminSettings } from "./components/AdminSettings.js";
import { LoginScreen } from "./components/LoginScreen.js";

// Initialize local databases
db.init();

// Apply initial font style configured in settings
const settings = db.get("settings");
if (settings && settings.templateConfig) {
  document.body.style.fontFamily = settings.templateConfig.fontFamily;
}

// Instantiate View Components
const dashboardView = new DashboardView(document.getElementById("dashboard-view-container"), state);
const customerDashboardPOS = new CustomerDashboard(document.getElementById("customer-dashboard-container"), state);
const customerDashboardCRM = new CustomerDashboard(document.getElementById("full-customers-container"), state);
const invoiceCreator = new InvoiceCreator(document.getElementById("invoice-creator-container"), state);
const paymentCheckout = new PaymentCheckout(document.getElementById("payment-checkout-container"), state);
const appointmentsView = new AppointmentsView(document.getElementById("appointments-view-container"), state);
const invoiceHistory = new InvoiceHistory(document.getElementById("invoice-history-container"), state);
const staffView = new StaffView(document.getElementById("staff-view-container"), state);
const adminSettings = new AdminSettings(document.getElementById("admin-settings-container"), state);
const receptionistDashboard = null; // Removed: merged into AppointmentsView unified flow
const loginScreen = new LoginScreen(document.getElementById("login-screen-overlay"), state);
window.appointmentsView = appointmentsView; // Attach globally for appointment details drawer

// Boot each component
dashboardView.init();
customerDashboardPOS.init();
customerDashboardCRM.init();
invoiceCreator.init();
paymentCheckout.init();
appointmentsView.init();
invoiceHistory.init();
staffView.init();
adminSettings.init();
loginScreen.init();

// Setup View Panels Mapping
const viewPanels = {
  "dashboard": {
    panel: document.getElementById("view-dashboard"),
    title: "Analytics Dashboard",
    nav: "dashboard"
  },
  "invoice-creator": {
    panel: document.getElementById("view-invoice-creator"),
    title: "Billing Terminal",
    nav: "invoice-creator"
  },
  "customers": {
    panel: document.getElementById("view-customers"),
    title: "Customers CRM",
    nav: "customers"
  },
  "appointments": {
    panel: document.getElementById("view-appointments"),
    title: "Calendar Schedule",
    nav: "appointments"
  },
  "invoice-history": {
    panel: document.getElementById("view-invoice-history"),
    title: "Invoice History Ledger",
    nav: "invoice-history"
  },
  "staff": {
    panel: document.getElementById("view-staff"),
    title: "Staff & Shifts Roster",
    nav: "staff"
  },
  "admin-settings": {
    panel: document.getElementById("view-admin-settings"),
    title: "Store Parameter Configurations",
    nav: "admin-settings"
  }
};

// Global Routing & Layout updates from State subscription
state.subscribe((currentState) => {
  if (currentState.isLocked) {
    // Clear all DOM containers to prevent security leaks / inspection of admin data by staff
    const containers = [
      "dashboard-view-container",
      "customer-dashboard-container",
      "full-customers-container",
      "invoice-creator-container",
      "payment-checkout-container",
      "appointments-view-container",
      "invoice-history-container",
      "staff-view-container",
      "admin-settings-container"
    ];
    containers.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = "";
    });

    // Close all drawers and overlays on lock
    const overlays = [
      "drawer-appointment-overlay",
      "drawer-receipt-overlay",
      "drawer-audit-overlay",
      "drawer-customer-overlay",
      "drawer-filter-overlay",
      "auth-supervisor-modal"
    ];
    overlays.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });
  }

  const currentView = currentState.currentView;
  const config = viewPanels[currentView];

  if (!config) return;

  // 1. Toggle panel active visibilities
  Object.keys(viewPanels).forEach(key => {
    const item = viewPanels[key];
    if (key === currentView) {
      item.panel.classList.add("active");
    } else {
      item.panel.classList.remove("active");
    }
  });

  // 2. Set Top Bar Header Title
  const titleEl = document.getElementById("page-view-title");
  // Wait, in the new layout, we don't have a dynamic page-view-title element, or if we do, let's update it.
  // Actually, top bar has search, so title is not strictly in top bar, but we can set page titles if we want.
  
  // 3. Highlight sidebar active state & enforce view permissions
  const navItems = document.querySelectorAll(".sidebar .nav-item");
  const role = currentState.activeStaff ? currentState.activeStaff.role : "stylist";
  navItems.forEach(nav => {
    const target = nav.dataset.view;
    if (target === config.nav) {
      nav.classList.add("active");
    } else {
      nav.classList.remove("active");
    }
    
    // Hide tabs from sidebar if not allowed
    if (currentState.validateViewPermission(target, role)) {
      nav.style.display = "flex";
    } else {
      nav.style.display = "none";
    }
  });

  // Global search input visibility guard
  const searchInputContainer = document.querySelector(".topbar-search");
  if (searchInputContainer) {
    if (["stylist", "senior_staff", "junior_staff"].includes(role)) {
      searchInputContainer.style.display = "none";
    } else {
      searchInputContainer.style.display = "flex";
    }
  }

  // 4. Sidebar collapse support
  const sidebar = document.getElementById("app-sidebar");
  if (sidebar) {
    if (currentState.sidebarCollapsed) {
      sidebar.classList.add("collapsed");
    } else {
      sidebar.classList.remove("collapsed");
    }
  }

  // 5. Connect Statuses Badge
  const connectionBadge = document.getElementById("topbar-connection-badge");
  const offlineSwitch = document.getElementById("offline-simulator-switch"); // wait, in index.html it is offline-simulator-switch
  if (offlineSwitch) {
    offlineSwitch.checked = currentState.offlineMode;
  }
  if (connectionBadge) {
    if (currentState.offlineMode) {
      connectionBadge.className = "connectivity-status offline";
      connectionBadge.innerHTML = `<span class="pulse-dot"></span><span class="status-lbl">Offline</span>`;
    } else {
      connectionBadge.className = "connectivity-status online";
      connectionBadge.innerHTML = `<span class="pulse-dot"></span><span class="status-lbl">Synced</span>`;
    }
  }

  // 6. Active Operator Profile Topbar sync
  const staff = currentState.activeStaff;
  const avatarEl = document.getElementById("active-staff-avatar");
  const nameEl = document.getElementById("active-staff-name");
  const roleEl = document.getElementById("active-staff-role");

  if (staff && avatarEl && nameEl && roleEl) {
    nameEl.innerText = staff.name;
    roleEl.innerText = staff.title || staff.role;
    avatarEl.innerText = staff.name.split(' ')[0][0] + (staff.name.split(' ')[1] ? staff.name.split(' ')[1][0] : '');
  }

  // Set role class on body for CSS-level financial gating
  document.body.className = document.body.className.split(" ").filter(c => !c.startsWith("role-")).join(" ");
  if (staff) {
    document.body.classList.add(`role-${staff.role.replace("_", "-")}`);
  }

  // 7. Render dynamic notifications list to toast
  renderNotifications(currentState.notifications);
  renderTopbarNotifications(currentState.notifications);
});

// Bind Sidebar navigation view triggers
const sidebarLinks = document.querySelectorAll(".sidebar .nav-item[data-view]");
sidebarLinks.forEach(item => {
  item.addEventListener("click", () => {
    const view = item.dataset.view;
    state.setView(view);
  });
});

// Collapsible sidebar chevron click trigger
const collapseBtn = document.getElementById("btn-toggle-sidebar");
if (collapseBtn) {
  collapseBtn.addEventListener("click", () => {
    state.toggleSidebar();
  });
}

// Bind Sidebar offline toggler switch changes
const sidebarOfflineToggle = document.getElementById("offline-simulator-switch");
if (sidebarOfflineToggle) {
  sidebarOfflineToggle.addEventListener("change", () => {
    state.toggleOfflineMode();
  });
}

// Global search inputs search listener mapping
const globalSearch = document.getElementById("global-pos-search");
if (globalSearch) {
  globalSearch.addEventListener("input", (e) => {
    const query = e.target.value;
    state.setGlobalSearch(query);
    
    // Redirect walk-in search automatically to Customers CRM if they type in dashboard, etc.
    if (state.currentView !== "customers" && state.currentView !== "invoice-creator") {
      state.setView("customers");
      setTimeout(() => {
        const crmSearch = document.getElementById("crm-search-field");
        if (crmSearch) {
          crmSearch.value = query;
          crmSearch.focus();
          // Dispatch input event
          crmSearch.dispatchEvent(new Event('input'));
        }
      }, 100);
    }
  });
}

// Staff operator info is read-only — displayed from login session, no dropdown switching allowed.

// Notifications trigger
const notifBtn = document.getElementById("btn-topbar-notifications");
const notifDropdown = document.getElementById("topbar-notifications-dropdown");

if (notifBtn && notifDropdown) {
  notifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle("active");
  });

  document.addEventListener("click", () => {
    notifDropdown.classList.remove("active");
  });
}

// Topbar theme toggler click
const themeBtn = document.getElementById("btn-topbar-theme");
const darkIcon = document.getElementById("theme-icon-dark");
const lightIcon = document.getElementById("theme-icon-light");

if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const isLight = document.body.classList.contains("light-theme");
    if (isLight) {
      document.body.classList.remove("light-theme");
      darkIcon.style.display = "block";
      lightIcon.style.display = "none";
      state.addNotification("Switched to modern dark mode theme.", "info");
    } else {
      document.body.classList.add("light-theme");
      darkIcon.style.display = "none";
      lightIcon.style.display = "block";
      state.addNotification("Switched to clean light mode theme.", "info");
    }
    // Sync settings components if active
    if (state.currentView === "admin-settings") {
      adminSettings.isLightTheme = !isLight;
      adminSettings.render();
    }
  });
}

// Collapsible overlays closing drawer button hooks
const closeReceiptBtn = document.getElementById("btn-close-receipt-drawer");
if (closeReceiptBtn) {
  closeReceiptBtn.addEventListener("click", () => {
    const overlay = document.getElementById("drawer-receipt-overlay");
    if (overlay) overlay.classList.remove("active");
  });
}

const closeAuditBtn = document.getElementById("btn-close-audit-drawer");
if (closeAuditBtn) {
  closeAuditBtn.addEventListener("click", () => {
    const overlay = document.getElementById("drawer-audit-overlay");
    if (overlay) overlay.classList.remove("active");
    // Clear selections in history view
    invoiceHistory.selectedInvoice = null;
    invoiceHistory.render();
  });
}

const closeApptBtn = document.getElementById("btn-close-appointment-drawer");
if (closeApptBtn) {
  closeApptBtn.addEventListener("click", () => {
    const overlay = document.getElementById("drawer-appointment-overlay");
    if (overlay) overlay.classList.remove("active");
    // Clear selection in view
    appointmentsView.selectedAppointment = null;
    appointmentsView.render();
  });
}

const closeFilterBtn = document.getElementById("btn-close-filter-drawer");
if (closeFilterBtn) {
  closeFilterBtn.addEventListener("click", () => {
    const overlay = document.getElementById("drawer-filter-overlay");
    if (overlay) overlay.classList.remove("active");
  });
}

// Global PIN supervisor credentials modal overlays
let activeSupervisorCallback = null;

window.askSupervisorPIN = function(callback) {
  activeSupervisorCallback = callback;

  // Clear input
  const input = document.getElementById("supervisor-pin-input");
  if (input) {
    input.value = "";
    input.setAttribute("type", "password");
  }

  // Slide open modal
  const modal = document.getElementById("auth-supervisor-modal");
  if (modal) {
    modal.classList.add("active");
    if (input) {
      setTimeout(() => input.focus(), 150);
    }
  }
};

// Bind PIN keypad digit clicks and inputs
const globalAuthModal = document.getElementById("auth-supervisor-modal");
if (globalAuthModal) {
  const closeGlobalAuthBtn = document.getElementById("btn-close-global-auth-modal");
  if (closeGlobalAuthBtn) {
    closeGlobalAuthBtn.addEventListener("click", () => {
      globalAuthModal.classList.remove("active");
      activeSupervisorCallback = null;
    });
  }

  const input = document.getElementById("supervisor-pin-input");

  const numpadKeys = globalAuthModal.querySelectorAll(".numpad-btn");
  numpadKeys.forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.val;
      if (!input) return;

      if (val === "back") {
        if (input.value.length > 0) {
          input.value = input.value.slice(0, -1);
        }
      } else {
        input.value += val;
      }
      input.focus();
    });
  });

  // Toggle supervisor eye button
  const eyeBtn = document.getElementById("supervisor-toggle-eye");
  if (eyeBtn && input) {
    eyeBtn.addEventListener("click", () => {
      const type = input.getAttribute("type") === "password" ? "text" : "password";
      input.setAttribute("type", type);
      input.focus();
    });
  }

  // Verify function
  const triggerVerify = () => {
    if (!input) return;
    const pin = input.value.trim();
    if (!pin) return;

    const isVerified = state.verifyPIN(pin);
    if (isVerified) {
      state.addNotification("Supervisor overrides authorized.", "success");
      globalAuthModal.classList.remove("active");
      const cb = activeSupervisorCallback;
      activeSupervisorCallback = null;
      if (cb) {
        cb(pin);
      }
    } else {
      alert("Invalid override PIN. Access Denied.");
      input.value = "";
      input.focus();
    }
  };

  // Submit button
  const submitBtn = document.getElementById("btn-submit-supervisor-auth");
  if (submitBtn) {
    submitBtn.addEventListener("click", triggerVerify);
  }

  // Enter key press in input
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        triggerVerify();
      }
    });
  }
}


// Render dynamic notifications toasts lists
function renderNotifications(notifications) {
  // Disabled the floating top-right notification stack entirely.
  // Critical errors/alerts are handled via native popups/modals.
  return;
}

// Sync bell badge and lists inside topbar notifications list
function renderTopbarNotifications(notifications) {
  const badge = document.getElementById("bell-badge");
  const list = document.getElementById("topbar-notif-list");

  if (badge) {
    if (notifications.length > 0) {
      badge.style.display = "block";
    } else {
      badge.style.display = "none";
    }
  }

  if (list) {
    if (notifications.length === 0) {
      list.innerHTML = `<div class="notif-empty">All caught up!</div>`;
    } else {
      list.innerHTML = notifications.map(n => `
        <div class="notif-item ${n.type}">
          <div style="font-weight:600; font-size:0.8rem;">${n.type.toUpperCase()}: Notification</div>
          <div style="color:var(--text-secondary); font-size:0.75rem; margin-top:2px;">${n.message}</div>
        </div>
      `).join('');
    }
  }
}

// Bind topbar logout / lock trigger
const logoutBtn = document.getElementById("btn-topbar-logout");
if (logoutBtn) {
  logoutBtn.addEventListener("click", () => {
    state.lockScreen();
  });
}

// Initial routing route sync bootstrap - Start Locked!
state.lockScreen();
