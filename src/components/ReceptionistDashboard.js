// src/components/ReceptionistDashboard.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";

export class ReceptionistDashboard {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    
    this.searchQuery = "";
    this.activeFilter = "All"; // 'All', 'Confirmed', 'Arrived', 'In Service', 'Completed'
    this.showAddModal = false;

    // Default System Date
    this.systemDate = "2026-05-24";

    // Form states
    this.newApptClient = "";
    this.newApptService = "";
    this.newApptStylist = "";
    this.newApptTime = "12:00";

    // Subscribe to state changes
    this.state.subscribe(() => {
      if (this.state.currentView === "receptionist-dashboard") {
        this.render();
      }
    });
  }

  init() {
    this.render();
  }

  updateStatus(apptId, newStatus) {
    const appointments = db.get("appointments") || [];
    const idx = appointments.findIndex(a => a.id === apptId);
    if (idx === -1) return;

    appointments[idx].status = newStatus;
    db.set("appointments", appointments);

    this.state.addNotification(`Appointment status updated to ${newStatus}.`, "success");
    this.state.logAudit("Appointment Status Changed", apptId, { status: newStatus }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    
    this.render();
  }

  convertToInvoice(apptId) {
    const appointments = db.get("appointments") || [];
    const appt = appointments.find(a => a.id === apptId);
    if (!appt) return;

    const customers = db.get("customers") || [];
    const client = customers.find(c => c.name.toLowerCase() === appt.customerName.toLowerCase());
    
    const services = db.get("services") || [];
    const service = services.find(s => s.name.toLowerCase() === appt.serviceName.toLowerCase()) || services[0];
    
    const stylists = db.get("stylists") || [];
    const stylist = stylists.find(s => s.id === appt.stylistID) || stylists[0];

    // Clear cart & set customer
    this.state.clearCart();
    if (client) {
      this.state.selectCustomer(client);
    } else {
      this.state.clearCustomer();
    }

    // Add service to cart
    if (service) {
      this.state.addToCart(service);
      const cartItem = this.state.cart[0];
      if (cartItem && stylist) {
        this.state.updateCartItem(cartItem.id, {
          stylistID: stylist.id,
          stylistName: stylist.name
        });
      }
    }

    // Mark appointment as Completed
    const idx = appointments.findIndex(a => a.id === apptId);
    if (idx !== -1) {
      appointments[idx].status = "Completed";
      db.set("appointments", appointments);
    }

    // Redirect to POS Terminal
    this.state.setView("invoice-creator");
    this.state.addNotification(`Converted appointment for ${appt.customerName} to checkout!`, "success");
    this.state.logAudit("Appointment Checked Out", apptId, {}, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
  }

  openDetailsDrawer(apptId) {
    const appointments = db.get("appointments") || [];
    const appt = appointments.find(a => a.id === apptId);
    if (!appt) return;

    if (window.appointmentsView) {
      window.appointmentsView.selectedAppointment = appt;
      window.appointmentsView.renderDetailsDrawer();
      const overlay = document.getElementById("drawer-appointment-overlay");
      if (overlay) overlay.classList.add("active");
    } else {
      alert("Could not open details drawer.");
    }
  }

  addNewBooking(e) {
    e.preventDefault();
    if (!this.newApptClient.trim()) {
      alert("Please enter customer name.");
      return;
    }

    const services = db.get("services") || [];
    const stylists = db.get("stylists") || [];

    const selectedService = services.find(s => s.id === this.newApptService) || services[0];
    const selectedStylist = stylists.find(s => s.id === this.newApptStylist) || stylists[0];

    const appointments = db.get("appointments") || [];
    const newId = "AP-" + Date.now();
    appointments.push({
      id: newId,
      customerID: "",
      customerName: this.newApptClient,
      stylistID: selectedStylist.id,
      stylistName: selectedStylist.name,
      serviceName: selectedService.name,
      startTime: new Date(`${this.systemDate}T${this.newApptTime}:00`).toISOString(),
      endTime: new Date(new Date(`${this.systemDate}T${this.newApptTime}:00`).getTime() + 45 * 60 * 1000).toISOString(),
      status: "Scheduled",
      notes: ""
    });

    db.set("appointments", appointments);
    this.state.addNotification(`Appointment booked for ${this.newApptClient}!`, "success");
    this.state.logAudit("Appointment Booked", newId, { client: this.newApptClient }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");

    // Reset form & close modal
    this.newApptClient = "";
    this.showAddModal = false;
    this.render();
  }

  render() {
    if (this.state.currentView !== "receptionist-dashboard") return;

    const appointments = db.get("appointments") || [];
    const stylists = db.get("stylists") || [];
    const services = db.get("services") || [];

    // Filter by system date (2026-05-24)
    let todayAppts = appointments.filter(a => a.startTime.startsWith(this.systemDate));

    // Calculate ongoing count (Arrived or In Service)
    const ongoingCount = todayAppts.filter(a => a.status === "Arrived" || a.status === "In Service").length;

    // Apply active filter
    if (this.activeFilter !== "All") {
      todayAppts = todayAppts.filter(a => {
        if (this.activeFilter === "Confirmed") {
          return a.status === "Scheduled" || a.status === "Confirmed";
        }
        return a.status.toLowerCase() === this.activeFilter.toLowerCase();
      });
    }

    // Apply Search Query filter (match customer name or service name)
    if (this.searchQuery.trim()) {
      const q = this.searchQuery.toLowerCase();
      todayAppts = todayAppts.filter(a => 
        (a.customerName && a.customerName.toLowerCase().includes(q)) ||
        (a.serviceName && a.serviceName.toLowerCase().includes(q))
      );
    }

    // Sort by startTime chronologically
    todayAppts.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    this.container.innerHTML = `
      <div class="receptionist-dashboard-layout">
        
        <!-- Header Card: Title, Date, Add Button, Search and Filters -->
        <div class="receptionist-header-card">
          <div class="receptionist-title-row">
            <div>
              <div class="receptionist-date-title">Sunday, May 24, 2026</div>
              <p style="font-size:0.85rem; color:var(--text-secondary); margin-top:2px;">Front-Desk Schedule Management</p>
            </div>
            
            <div class="receptionist-controls">
              <!-- Add Appointment Button -->
              <button class="btn btn-primary" id="btn-receptionist-add-appt">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:16px;height:16px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Add Appointment
              </button>
            </div>
          </div>

          <div class="receptionist-filters-row">
            <!-- Filter Pills -->
            <div class="receptionist-filter-btns">
              <button class="receptionist-filter-btn ${this.activeFilter === 'All' ? 'active' : ''}" data-filter="All">All Today (${appointments.filter(a => a.startTime.startsWith(this.systemDate)).length})</button>
              <button class="receptionist-filter-btn ${this.activeFilter === 'Confirmed' ? 'active' : ''}" data-filter="Confirmed">Confirmed</button>
              <button class="receptionist-filter-btn ${this.activeFilter === 'Arrived' ? 'active' : ''}" data-filter="Arrived">Arrived</button>
              <button class="receptionist-filter-btn ${this.activeFilter === 'In Service' ? 'active' : ''}" data-filter="In Service">In Service</button>
              <button class="receptionist-filter-btn ${this.activeFilter === 'Completed' ? 'active' : ''}" data-filter="Completed">Completed</button>
            </div>

            <div style="display:flex; align-items:center; gap:16px;">
              <!-- Ongoing Count Indicator -->
              <div class="receptionist-ongoing-badge">
                <span class="pulse-dot"></span>
                <span>${ongoingCount} Ongoing Guest${ongoingCount !== 1 ? 's' : ''}</span>
              </div>

              <!-- Search Box -->
              <div class="receptionist-search-box">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                <input type="text" id="receptionist-feed-search" class="form-input form-input-sm" placeholder="Search guests, services..." value="${this.searchQuery}" />
              </div>
            </div>
          </div>
        </div>

        <!-- Appointment Feed Feed Container -->
        <div class="receptionist-feed-list">
          ${todayAppts.length === 0 ? `
            <div class="card" style="text-align:center; padding:48px var(--sp-3); display:flex; flex-direction:column; align-items:center; gap:12px;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" style="width:48px;height:48px;color:var(--text-muted);">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <div style="font-weight:600; color:var(--text-secondary);">No appointments found</div>
              <p style="font-size:0.8rem; color:var(--text-muted); max-width:280px; margin:0 auto;">There are no scheduled checkouts matching your criteria.</p>
            </div>
          ` : todayAppts.map(appt => {
            const timeFormatted = formatTime(appt.startTime);
            const statusClass = appt.status.toLowerCase().replace(" ", "-");
            
            // Build Contextual Quick Action Buttons depending on status
            let quickActions = "";
            
            if (appt.status === "Scheduled" || appt.status === "Confirmed") {
              quickActions = `
                <button class="action-quick-pill arrived" data-id="${appt.id}">Mark Arrived</button>
                <button class="action-quick-pill check-in" data-id="${appt.id}">Check In</button>
              `;
            } else if (appt.status === "Arrived") {
              quickActions = `
                <button class="action-quick-pill check-in" data-id="${appt.id}">Check In</button>
              `;
            } else if (appt.status === "In Service") {
              quickActions = `
                <button class="action-quick-pill invoice" data-id="${appt.id}">Checkout & Invoice</button>
              `;
            } else if (appt.status === "Completed") {
              quickActions = `<span style="font-size:0.75rem; color:var(--success); font-weight:600; padding-right:8px;">Billed</span>`;
            } else {
              quickActions = `<span style="font-size:0.75rem; color:var(--text-muted); font-weight:600; padding-right:8px;">Canceled</span>`;
            }

            return `
              <div class="receptionist-appt-row">
                <!-- Time Column -->
                <div class="receptionist-appt-time">${timeFormatted}</div>

                <!-- Guest Column -->
                <div class="receptionist-appt-customer">
                  <span class="staff-avatar" style="width:24px; height:24px; font-size:0.7rem;">${appt.customerName.split(' ')[0][0]}${appt.customerName.split(' ')[1] ? appt.customerName.split(' ')[1][0] : ''}</span>
                  <span>${appt.customerName}</span>
                </div>

                <!-- Service Column -->
                <div class="receptionist-appt-service">${appt.serviceName}</div>

                <!-- Stylist Column (Subtle) -->
                <div class="receptionist-appt-stylist" style="font-size: 0.8rem; opacity: 0.7;">
                  <span>with ${appt.stylistName.split(' ')[0]}</span>
                </div>

                <!-- Status Badge -->
                <div>
                  <span class="status-badge ${statusClass}">${appt.status}</span>
                </div>

                <!-- Operations actions column -->
                <div class="receptionist-appt-actions">
                  ${quickActions}
                  
                  <button class="action-btn-icon btn-view-details" data-id="${appt.id}" title="Open Details Drawer">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.063 1.06l-.041.02a.75.75 0 01-1.063-1.06zm-1.72 1.75c-.328.018-.621.144-.82.355a.75.75 0 001.077 1.043c.092-.095.22-.162.361-.17l.006-.001.026.012c.143.067.243.208.243.376 0 .204-.15.378-.354.394l-.009.001-.026-.012a.75.75 0 00-.707 1.321l.026.012.01.005a2.25 2.25 0 003.04-1.031l.012-.026a2.25 2.25 0 00-1.89-3.235l-.028-.001-.006-.001zM12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                    </svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Inline Add Booking Modal -->
        ${this.showAddModal ? `
          <div class="modal-overlay active" id="receptionist-add-modal">
            <div class="modal-box" style="max-width: 440px;">
              <div class="modal-header" style="margin-bottom: 16px;">
                <h3 class="modal-title">Book New Appointment</h3>
                <button class="modal-close-btn" id="btn-close-receptionist-add">&times;</button>
              </div>

              <form id="receptionist-new-appt-form">
                <div class="form-group">
                  <label class="form-label">Guest Name</label>
                  <input type="text" id="new-appt-client-input" class="form-input" placeholder="e.g. Priyanth Sen" value="${this.newApptClient}" required />
                </div>

                <div class="form-group">
                  <label class="form-label">Service</label>
                  <select id="new-appt-service-select" class="form-select">
                    ${services.map(s => `<option value="${s.id}">${s.name} (${formatINR(s.price)})</option>`).join('')}
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label">Stylist</label>
                  <select id="new-appt-stylist-select" class="form-select">
                    ${stylists.map(st => `<option value="${st.id}">${st.name} - ${st.title}</option>`).join('')}
                  </select>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                  <div class="form-group">
                    <label class="form-label">Date</label>
                    <input type="date" class="form-input" value="${this.systemDate}" disabled />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Time</label>
                    <input type="time" id="new-appt-time-input" class="form-input" value="${this.newApptTime}" required />
                  </div>
                </div>

                <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:20px;">
                  <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-receptionist-add">Cancel</button>
                  <button type="submit" class="btn btn-primary btn-sm">Confirm Booking</button>
                </div>
              </form>
            </div>
          </div>
        ` : ''}

      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Add Booking Modal Toggle
    const addBtn = this.container.querySelector("#btn-receptionist-add-appt");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        const services = db.get("services") || [];
        const stylists = db.get("stylists") || [];
        this.newApptService = services[0] ? services[0].id : "";
        this.newApptStylist = stylists[0] ? stylists[0].id : "";
        this.showAddModal = true;
        this.render();
      });
    }

    const closeModalBtn = this.container.querySelector("#btn-close-receptionist-add");
    if (closeModalBtn) {
      closeModalBtn.addEventListener("click", () => {
        this.showAddModal = false;
        this.render();
      });
    }

    const cancelModalBtn = this.container.querySelector("#btn-cancel-receptionist-add");
    if (cancelModalBtn) {
      cancelModalBtn.addEventListener("click", () => {
        this.showAddModal = false;
        this.render();
      });
    }

    const addForm = this.container.querySelector("#receptionist-new-appt-form");
    if (addForm) {
      addForm.addEventListener("submit", (e) => {
        this.newApptClient = this.container.querySelector("#new-appt-client-input").value;
        this.newApptService = this.container.querySelector("#new-appt-service-select").value;
        this.newApptStylist = this.container.querySelector("#new-appt-stylist-select").value;
        this.newApptTime = this.container.querySelector("#new-appt-time-input").value;
        this.addNewBooking(e);
      });
    }

    // Search input handler
    const searchField = this.container.querySelector("#receptionist-feed-search");
    if (searchField) {
      searchField.addEventListener("input", (e) => {
        this.searchQuery = e.target.value;
        // Re-render only feed rows to prevent cursor blur, or debounced/re-rendered list container
        // Since we are standard vanilla framework, re-rendering is fast.
        // To avoid focus loss, we can position cursor at end:
        this.debounce(() => {
          this.render();
          const sf = this.container.querySelector("#receptionist-feed-search");
          if (sf) {
            sf.focus();
            sf.setSelectionRange(sf.value.length, sf.value.length);
          }
        }, 150)();
      });
    }

    // Filter pills click
    const filterBtns = this.container.querySelectorAll(".receptionist-filter-btn");
    filterBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.activeFilter = btn.dataset.filter;
        this.render();
      });
    });

    // Quick Actions
    const arrivedBtns = this.container.querySelectorAll(".action-quick-pill.arrived");
    arrivedBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.updateStatus(btn.dataset.id, "Arrived");
      });
    });

    const checkInBtns = this.container.querySelectorAll(".action-quick-pill.check-in");
    checkInBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.updateStatus(btn.dataset.id, "In Service");
      });
    });

    const invoiceBtns = this.container.querySelectorAll(".action-quick-pill.invoice");
    invoiceBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.convertToInvoice(btn.dataset.id);
      });
    });

    const detailsBtns = this.container.querySelectorAll(".btn-view-details");
    detailsBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        this.openDetailsDrawer(btn.dataset.id);
      });
    });
  }

  debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
  }
}

// Helper to format ISO String time to readable hh:mm AM/PM format
function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    let hours = d.getHours();
    let minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  } catch (e) {
    return "N/A";
  }
}
