// src/components/AppointmentsView.js
import { db } from "../db.js";
import { formatINR } from "../utils/currency.js";

// Helper to format ISO String time to readable hh:mm AM/PM format
function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    let hours = d.getHours();
    let minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; 
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
  } catch (e) {
    return "N/A";
  }
}

function getTodayStr() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export class AppointmentsView {
  constructor(container, state) {
    this.container = container;
    this.state = state;
    
    this.showAddModal = false;
    this.showEditModal = false;
    this.selectedAppointment = null; // Detail drawer target
    this.editingAppointment = null; // Edit modal target

    // Form buffers
    this.selectedBookDate = getTodayStr(); // Dynamic current day
    this.selectedBookTime = "12:00";
    this.isConverting = false;

    // View layout mode: 'timeline' or 'grid' — grid only for admin
    this.calendarMode = "timeline";

    // Subscribe to state updates
    this.state.subscribe(() => {
      if (this.state.currentView === "appointments") {
        this.render();
        this.renderDetailsDrawer();
      }
    });
  }

  init() {
    this.render();
    
    // Auto update current time indicator line position every minute
    setInterval(() => {
      const currentRole = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
      if (this.state.currentView === "appointments" && this.calendarMode === "grid" && currentRole === "admin") {
        this.updateTimeLine();
      }
    }, 60000);
  }

  validateBookingDate(dateStr) {
    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    if (role === "receptionist") {
      const todayStr = getTodayStr();
      const systemDate = new Date(todayStr);
      const maxDate = new Date(todayStr);
      maxDate.setMonth(maxDate.getMonth() + 1);

      const targetDate = new Date(dateStr);
      if (targetDate > maxDate) {
        this.state.addNotification("Receptionists cannot book appointments more than 1 month in advance.", "error");
        return false;
      }
    }
    return true;
  }

  addNewBooking(e) {
    e.preventDefault();
    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    if (["stylist", "senior_staff", "junior_staff"].includes(role)) {
      this.state.addNotification("Stylists are not authorized to create bookings.", "error");
      return;
    }

    const form = e.target;
    const clientName = form.elements.clientName.value;
    const serviceName = form.elements.service.value;
    const stylistId = form.elements.stylist.value;
    const date = form.elements.date.value;
    const time = form.elements.time.value;

    if (!this.validateBookingDate(date)) {
      return;
    }

    const stylists = db.get("stylists") || [];
    const stylist = stylists.find(s => s.id === stylistId);

    const appointments = db.get("appointments") || [];
    appointments.push({
      id: "AP-" + Date.now(),
      customerID: "",
      customerName: clientName,
      stylistID: stylistId,
      stylistName: stylist ? stylist.name : "Unassigned",
      serviceName: serviceName,
      startTime: new Date(`${date}T${time}:00`).toISOString(),
      endTime: new Date(new Date(`${date}T${time}:00`).getTime() + 45 * 60 * 1000).toISOString(),
      status: "Scheduled",
      notes: ""
    });

    db.set("appointments", appointments);
    this.state.addNotification(`Appointment booked for ${clientName}!`, "success");
    this.state.logAudit("Appointment Booked", null, { client: clientName }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    
    this.showAddModal = false;
    this.render();
  }

  saveEditedBooking(e) {
    e.preventDefault();
    if (!this.editingAppointment) return;

    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    if (["stylist", "senior_staff", "junior_staff"].includes(role)) {
      this.state.addNotification("Stylists are not authorized to edit bookings.", "error");
      return;
    }

    const form = e.target;
    const clientName = form.elements.clientName.value;
    const serviceName = form.elements.service.value;
    const stylistId = form.elements.stylist.value;
    const date = form.elements.date.value;
    const time = form.elements.time.value;

    if (!this.validateBookingDate(date)) {
      return;
    }

    const stylists = db.get("stylists") || [];
    const stylist = stylists.find(s => s.id === stylistId);

    const appointments = db.get("appointments") || [];
    const idx = appointments.findIndex(a => a.id === this.editingAppointment.id);
    if (idx !== -1) {
      appointments[idx] = {
        ...appointments[idx],
        customerName: clientName,
        stylistID: stylistId,
        stylistName: stylist ? stylist.name : "Unassigned",
        serviceName: serviceName,
        startTime: new Date(`${date}T${time}:00`).toISOString(),
        endTime: new Date(new Date(`${date}T${time}:00`).getTime() + 45 * 60 * 1000).toISOString()
      };
      
      db.set("appointments", appointments);
      this.state.addNotification(`Appointment details updated.`, "success");
      this.state.logAudit("Appointment Rescheduled/Modified", this.editingAppointment.id, { client: clientName }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    }

    this.showEditModal = false;
    this.editingAppointment = null;
    this.selectedAppointment = null;
    
    const drawer = document.getElementById("drawer-appointment-overlay");
    if (drawer) drawer.classList.remove("active");

    this.render();
  }

  updateAppointmentStatus(status) {
    if (!this.selectedAppointment) return;

    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    if (role !== "admin" && role !== "receptionist") {
      this.state.addNotification("Access Denied: Stylists are not authorized to update booking status.", "error");
      return;
    }
    
    const appointments = db.get("appointments") || [];
    const idx = appointments.findIndex(a => a.id === this.selectedAppointment.id);
    if (idx === -1) return;

    appointments[idx].status = status;
    db.set("appointments", appointments);
    
    this.selectedAppointment = appointments[idx];
    this.state.addNotification(`Booking status updated to ${status}.`, "info");
    this.state.logAudit("Appointment Status Changed", null, { apptId: this.selectedAppointment.id, status }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    
    this.render();
    this.renderDetailsDrawer();
  }

  convertToInvoice() {
    if (!this.selectedAppointment) return;

    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    if (!["admin", "receptionist"].includes(role)) {
      this.state.addNotification("Only admin or receptionist can convert appointments to invoice.", "error");
      return;
    }
    
    this.isConverting = true;
    this.renderDetailsDrawer();

    setTimeout(() => {
      const appt = this.selectedAppointment;
      const customers = db.get("customers") || [];
      const client = customers.find(c => c.name.toLowerCase() === appt.customerName.toLowerCase());
      const services = db.get("services") || [];
      const service = services.find(s => s.name.toLowerCase() === appt.serviceName.toLowerCase()) || services[0];
      const stylists = db.get("stylists") || [];
      const stylist = stylists.find(s => s.id === appt.stylistID) || stylists[0];

      this.state.clearCart();
      if (client) {
        this.state.selectCustomer(client);
      } else {
        this.state.clearCustomer();
      }

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

      const appointments = db.get("appointments") || [];
      const idx = appointments.findIndex(a => a.id === appt.id);
      if (idx !== -1) {
        appointments[idx].status = "Completed";
        db.set("appointments", appointments);
      }

      this.isConverting = false;
      this.selectedAppointment = null;
      
      const drawer = document.getElementById("drawer-appointment-overlay");
      if (drawer) drawer.classList.remove("active");

      this.state.setView("invoice-creator");
      this.state.addNotification(`Converted appointment to billing terminal invoice!`, "success");
      this.state.logAudit("Appointment Checked Out", null, { apptId: appt.id }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");

    }, 850);
  }

  updateDragAppointment(apptId, stylistId, startHourOffset) {
    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    if (role !== "admin" && role !== "receptionist") {
      this.state.addNotification("Access Denied: Stylists are not authorized to reschedule bookings.", "error");
      return;
    }

    const appointments = db.get("appointments") || [];
    const idx = appointments.findIndex(a => a.id === apptId);
    if (idx === -1) return;

    const stylists = db.get("stylists") || [];
    const targetStylist = stylists.find(s => s.id === stylistId);
    if (!targetStylist) return;

    const appt = appointments[idx];
    const durationMs = new Date(appt.endTime) - new Date(appt.startTime);

    const startHour = 9 + Math.floor(startHourOffset);
    const startMin = Math.round((startHourOffset % 1) * 60);

    const pad = (n) => String(n).padStart(2, "0");
    const apptDateStr = appt.startTime.split('T')[0];
    const newStartISO = `${apptDateStr}T${pad(startHour)}:${pad(startMin)}:00.000Z`;
    const newEndISO = new Date(new Date(newStartISO).getTime() + durationMs).toISOString();

    appt.stylistID = stylistId;
    appt.stylistName = targetStylist.name;
    appt.startTime = newStartISO;
    appt.endTime = newEndISO;

    appointments[idx] = appt;
    db.set("appointments", appointments);

    this.state.addNotification(`Rescheduled ${appt.customerName} with ${targetStylist.name} to ${pad(startHour)}:${pad(startMin)}`, "success");
    this.state.logAudit("Appointment Drag-Rescheduled", null, { apptId, stylist: targetStylist.name }, this.state.activeStaff ? this.state.activeStaff.role : "Staff");
    
    this.render();
  }

  updateTimeLine() {
    const line = document.getElementById("current-time-line-indicator");
    if (!line) return;

    const now = new Date();
    const currentHour = now.getHours() + (now.getMinutes() / 60);
    const scaleStart = 9.0; // 9:00 AM

    if (currentHour >= 9.0 && currentHour <= 18.0) {
      const topOffset = (currentHour - scaleStart) * 80;
      line.style.top = `${topOffset}px`;
      line.style.display = "block";
    } else {
      line.style.display = "none";
    }
  }

  render() {
    if (this.state.currentView !== "appointments") return;

    const appts = db.get("appointments") || [];
    const services = db.get("services") || [];
    const stylists = db.get("stylists") || [];

    const todayStr = getTodayStr();
    let todayAppts = appts.filter(a => a.startTime.startsWith(todayStr));

    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    const isStylist = ["stylist", "senior_staff", "junior_staff"].includes(role);
    const isAdmin = role === "admin";
    const canBook = isAdmin || role === "receptionist"; // Only admin + receptionist can create/edit bookings

    // ALL roles see ALL appointments — unified salon workflow
    // Sort chronologically
    todayAppts.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    // Headers list for grid mode
    const hours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
    const hourLabels = {
      9: "9:00 AM", 10: "10:00 AM", 11: "11:00 AM", 12: "12:00 PM",
      13: "1:00 PM", 14: "2:00 PM", 15: "3:00 PM", 16: "4:00 PM", 17: "5:00 PM"
    };

    let visibleStylists = stylists;
    if (isStylist && this.state.activeStaff) {
      visibleStylists = stylists.filter(s => s.id === this.state.activeStaff.id);
    }

    // Toggle button html — admin-only power feature
    const showToggleBtn = isAdmin;
    const toggleBtnHTML = showToggleBtn ? `
      <button class="btn btn-secondary btn-sm" id="btn-toggle-calendar-mode" style="margin-left:auto;">
        Switch to ${this.calendarMode === 'grid' ? 'Timeline List' : 'Detailed Grid View'}
      </button>
    ` : "";

    let bodyHTML = "";

    if (this.calendarMode === "grid" && isAdmin) {
      // 2D STYLIST COLUMN GRID VIEW
      bodyHTML = `
        <div class="calendar-wrapper">
          <!-- Sticky Stylist Headers Row -->
          <div class="calendar-stylist-headers">
            <div class="calendar-header-spacer"></div>
            ${visibleStylists.map(s => `
              <div class="calendar-stylist-header-cell">
                <span class="calendar-stylist-hdr-name">${s.name}</span>
                <span class="calendar-stylist-hdr-role">${s.title || s.role}</span>
              </div>
            `).join('')}
          </div>

          <!-- Scrollable Grid Body -->
          <div class="calendar-scroll-area">
            <div class="calendar-grid-container">
              <!-- Real-time indicator line -->
              <div class="current-time-indicator-line" id="current-time-line-indicator" style="display:none;"></div>

              <!-- Left time label col -->
              <div class="time-scale-column">
                ${hours.map(h => `
                  <div class="time-slot-label-cell">
                    <span class="time-slot-label-text">${hourLabels[h]}</span>
                  </div>
                `).join('')}
                <div style="height: 80px; position:relative;">
                  <span class="time-slot-label-text">6:00 PM</span>
                </div>
              </div>

              <!-- Stylist Columns Grid -->
              <div class="calendar-columns-grid">
                ${visibleStylists.map(s => {
                  const columnAppts = todayAppts.filter(a => a.stylistID === s.id);
                  return `
                    <div class="stylist-grid-column" data-stylist-id="${s.id}">
                      ${columnAppts.map(appt => {
                        const start = new Date(appt.startTime);
                        const end = new Date(appt.endTime);
                        const startHourVal = start.getHours() + (start.getMinutes() / 60);
                        const durationHours = (end - start) / (60 * 60 * 1000);
                        
                        const topOffset = (startHourVal - 9.0) * 80;
                        const heightPx = durationHours * 80;

                        return `
                          <div class="appt-absolute-card status-${appt.status.toLowerCase()}" 
                               data-appt-id="${appt.id}" 
                               draggable="true" 
                               style="top:${topOffset}px; height:${heightPx}px;">
                            <span class="appt-card-title">${appt.customerName}</span>
                            <span class="appt-card-desc">${appt.serviceName}</span>
                          </div>
                        `;
                      }).join('')}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      `;
    } else {
      // CLEAN TIMELINE LIST VIEW (Grouped or chronologically sorted list)
      bodyHTML = `
        <div class="receptionist-feed-list" style="margin-top: 10px;">
          ${todayAppts.length === 0 ? `
            <div class="card" style="text-align:center; padding:48px; display:flex; flex-direction:column; align-items:center; gap:12px;">
              <div style="font-weight:600; color:var(--text-secondary);">No appointments scheduled today</div>
            </div>
          ` : todayAppts.map(appt => {
            const timeFormatted = formatTime(appt.startTime);
            const statusClass = appt.status.toLowerCase().replace(" ", "-");
            
            // Only admin + receptionist can modify — staff are view-only
            const canModify = role === "admin" || role === "receptionist";
            let quickActions = "";

            if (canModify) {
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
                quickActions = role === "admin" ? `
                  <button class="action-quick-pill invoice" data-id="${appt.id}">Checkout</button>
                ` : `<button class="action-quick-pill invoice" data-id="${appt.id}">Checkout</button>`;
              }
              // Completed / Canceled: no pill needed — status badge says it all
            }

            return `
              <div class="receptionist-appt-row">
                <!-- Time -->
                <div class="receptionist-appt-time">${timeFormatted}</div>

                <!-- Customer -->
                <div class="receptionist-appt-customer" style="font-size: 1.05rem; font-weight: 700;">
                  <span class="staff-avatar" style="width:28px; height:28px; font-size:0.75rem;">${appt.customerName.split(' ')[0][0]}${appt.customerName.split(' ')[1] ? appt.customerName.split(' ')[1][0] : ''}</span>
                  <span>${appt.customerName}</span>
                </div>

                <!-- Service -->
                <div class="receptionist-appt-service">
                  <span style="background-color: var(--bg-input); padding: 4px 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); font-weight: 600;">
                    ${appt.serviceName}
                  </span>
                </div>

                <!-- Status Badge -->
                <div>
                  <span class="status-badge ${statusClass}">${appt.status}</span>
                </div>

                <!-- Actions: only admin/receptionist get interactive pills + details drawer -->
                <div class="receptionist-appt-actions">
                  ${quickActions}
                  <button class="action-btn-icon btn-view-details" data-id="${appt.id}" title="View Details">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.063 1.06l-.041.02a.75.75 0 01-1.063-1.06zm-1.72 1.75c-.328.018-.621.144-.82.355a.75.75 0 001.077 1.043c.092-.095.22-.162.361-.17l.006-.001.026.012c.143.067.243.208.243.376 0 .204-.15.378-.354.394l-.009.001-.026-.012a.75.75 0 00-.707 1.321l.026.012.01.005a2.25 2.25 0 003.04-1.031l.012-.026a2.25 2.25 0 00-1.89-3.235l-.028-.001-.006-.001zM12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 6a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                    </svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    this.container.innerHTML = `
      <div style="display:flex; flex-direction:column; gap: 12px; height: 100%; overflow-y: auto;">
        
        <div style="display:flex; align-items:center; gap: 12px; width: 100%;">
          <div>
            <h2 class="receptionist-date-title" style="font-size: 1.4rem;">Today's Bookings</h2>
            <p style="font-size:0.75rem; color:var(--text-secondary); margin-top:2px;">Salon-wide Scheduling Timeline</p>
          </div>
          
          ${toggleBtnHTML}

          ${canBook ? `
            <button class="btn btn-primary btn-sm" id="btn-add-appt-schedule">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" style="width:14px;height:14px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              New Booking
            </button>
          ` : ''}
        </div>

        <!-- Render active view layout mode container -->
        ${bodyHTML}

      </div>

      <!-- Add Booking Modal -->
      ${this.showAddModal ? `
        <div class="modal-overlay active" id="add-appt-modal-overlay">
          <div class="modal-box" style="max-width: 440px;">
            <div class="modal-header" style="margin-bottom:12px;">
              <h3 class="modal-title">Book Appointment</h3>
              <button class="modal-close-btn" id="btn-close-appt-modal">&times;</button>
            </div>
            <form id="add-appt-form">
              <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
                <div class="form-group">
                  <label class="form-label">Client Name</label>
                  <input type="text" name="clientName" class="form-input" placeholder="e.g. Priyanth Sen" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Service</label>
                  <select name="service" class="form-select" required>
                    <option value="" disabled selected>-- Select Service --</option>
                    ${services.map(s => `<option value="${s.name}">${s.name} (${formatINR(s.price)})</option>`).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Stylist</label>
                  <select name="stylist" class="form-select" required>
                    <option value="" disabled selected>-- Select Stylist --</option>
                    ${stylists.map(s => `<option value="${s.id}">${s.name} - ${s.title}</option>`).join('')}
                  </select>
                </div>
                <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:12px;">
                  <div class="form-group">
                    <label class="form-label">Date</label>
                    <input type="date" name="date" class="form-input" value="${this.selectedBookDate}" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Time</label>
                    <input type="time" name="time" class="form-input" value="${this.selectedBookTime}" required />
                  </div>
                </div>
              </div>
              <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-appt-modal">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm">Confirm Booking</button>
              </div>
            </form>
          </div>
        </div>
      ` : ""}

      <!-- Edit/Reschedule Appointment Modal -->
      ${this.showEditModal && this.editingAppointment ? `
        <div class="modal-overlay active" id="edit-appt-modal-overlay">
          <div class="modal-box" style="max-width: 440px;">
            <div class="modal-header" style="margin-bottom:12px;">
              <h3 class="modal-title">Edit / Reschedule Booking</h3>
              <button class="modal-close-btn" id="btn-close-edit-modal">&times;</button>
            </div>
            <form id="edit-appt-form">
              <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
                <div class="form-group">
                  <label class="form-label">Client Name</label>
                  <input type="text" name="clientName" class="form-input" value="${this.editingAppointment.customerName}" required />
                </div>
                <div class="form-group">
                  <label class="form-label">Service</label>
                  <select name="service" class="form-select" required>
                    ${services.map(s => `
                      <option value="${s.name}" ${s.name.toLowerCase() === this.editingAppointment.serviceName.toLowerCase() ? 'selected' : ''}>
                        ${s.name} (${formatINR(s.price)})
                      </option>
                    `).join('')}
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label">Stylist</label>
                  <select name="stylist" class="form-select" required>
                    ${stylists.map(s => `
                      <option value="${s.id}" ${s.id === this.editingAppointment.stylistID ? 'selected' : ''}>
                        ${s.name} - ${s.title}
                      </option>
                    `).join('')}
                  </select>
                </div>
                <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:12px;">
                  <div class="form-group">
                    <label class="form-label">Date</label>
                    <input type="date" name="date" class="form-input" value="${this.editingAppointment.startTime.split('T')[0]}" required />
                  </div>
                  <div class="form-group">
                    <label class="form-label">Time</label>
                    <input type="time" name="time" class="form-input" value="${this.editingAppointment.startTime.split('T')[1].slice(0, 5)}" required />
                  </div>
                </div>
              </div>
              <div class="modal-footer" style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-edit-modal">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      ` : ""}
    `;

    this.bindEvents();
    if (this.calendarMode === "grid" && isAdmin) {
      this.updateTimeLine();
    }
  }

  renderDetailsDrawer() {
    const drawerBody = document.getElementById("appointment-drawer-body");
    if (!drawerBody || !this.selectedAppointment) return;

    const appt = this.selectedAppointment;
    const formattedStart = new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formattedEnd = new Date(appt.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    const canEdit = role === "admin" || role === "receptionist";

    const customers = db.get("customers") || [];
    const customer = customers.find(c => c.id === appt.customerID || (appt.customerName && c.name.toLowerCase() === appt.customerName.toLowerCase()));
    const phoneStr = customer ? customer.phone : "Walk-in Guest";
    const membershipStr = customer && customer.membershipID !== "None" ? `Linked ${customer.membershipID}` : "No Active Membership";

    drawerBody.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:20px; height:100%;">
        
        <!-- Group 1: Client Card -->
        <div style="background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; flex-direction:column; gap:6px;">
          <span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Guest Contact Details</span>
          <h4 style="font-family:var(--font-display); font-size:1.2rem; font-weight:700; color:var(--text-primary);">${appt.customerName}</h4>
          <span style="font-size:0.8rem; color:var(--text-secondary);">Phone: <strong>${phoneStr}</strong> (${membershipStr})</span>
        </div>

        <!-- Group 2: Appointment Specifics -->
        <div style="background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:16px; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:0.7rem; color:var(--text-muted); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Schedule & Service Details</span>
            ${canEdit ? `<button class="btn btn-secondary btn-sm" id="btn-edit-appt-details" style="min-height:28px; padding:2px 8px; font-size:0.75rem;">Edit Details</button>` : ""}
          </div>

          <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
            <span style="color:var(--text-secondary);">Service</span>
            <span style="font-weight:600; color:var(--primary);">${appt.serviceName}</span>
          </div>

          <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
            <span style="color:var(--text-secondary);">Time Slot</span>
            <span style="font-weight:600;">${formattedStart} - ${formattedEnd}</span>
          </div>

          ${canEdit ? `
          <div style="display:flex; justify-content:space-between; font-size:0.85rem;">
            <span style="color:var(--text-secondary);">Assigned Stylist</span>
            <span style="font-weight:600; opacity:0.7;">${appt.stylistName}</span>
          </div>` : ""}
        </div>

        <!-- Group 3: Status Updates — admin/receptionist only -->
        ${canEdit ? `
        <div>
          <span class="form-label" style="display:block; margin-bottom:8px;">Update Appointment Status</span>
          <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:6px;">
            <button class="btn btn-secondary btn-sm ${appt.status === 'Scheduled' ? 'active' : ''}" id="btn-appt-status-scheduled" style="font-size:0.75rem;">Scheduled</button>
            <button class="btn btn-secondary btn-sm ${appt.status === 'Checked In' || appt.status === 'Arrived' ? 'active' : ''}" id="btn-appt-status-checked" style="font-size:0.75rem;">Arrived</button>
            <button class="btn btn-secondary btn-sm ${appt.status === 'In Service' ? 'active' : ''}" id="btn-appt-status-in-service" style="font-size:0.75rem;">In Service</button>
            <button class="btn btn-secondary btn-sm ${appt.status === 'Completed' ? 'active' : ''}" id="btn-appt-status-completed" style="font-size:0.75rem;">Completed</button>
            <button class="btn btn-danger btn-sm ${appt.status === 'Canceled' ? 'active' : ''}" id="btn-appt-status-cancel" style="font-size:0.75rem; grid-column:span 2;">Cancel Appointment</button>
          </div>
        </div>` : `
        <div style="background-color:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-md); padding:14px; text-align:center;">
          <span style="font-size:0.8rem; color:var(--text-muted);">Current Status: </span>
          <span class="status-badge ${appt.status.toLowerCase().replace(' ', '-')}" style="display:inline-block; margin-top:6px;">${appt.status}</span>
        </div>`}

        <!-- Convert to Billing — admin + receptionist only -->
        ${canEdit && appt.status !== 'Completed' && appt.status !== 'Canceled' ? `
          <div style="margin-top:auto; border-top:1px solid var(--border-color); padding-top:16px;">
            <button class="btn btn-primary" id="btn-convert-to-pos-checkout" style="width:100%; min-height:48px; font-size:1rem; gap:10px; background:linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow:0 4px 12px rgba(16,185,129,0.25);">
              ${this.isConverting ? `
                <span class="spinner"></span>
                <span>Generating Billing...</span>
              ` : `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:20px;height:20px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                <span>Convert to Billing</span>
              `}
            </button>
          </div>
        ` : ""}

        <!-- Delete Appointment — admin + receptionist only -->
        ${canEdit ? `
          <div style="margin-top: ${appt.status === 'Completed' || appt.status === 'Canceled' ? 'auto' : '0'}; padding-top:12px;" id="delete-appt-zone">
            <div id="delete-confirm-prompt" style="display:none; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.25); border-radius:var(--radius-md); padding:12px; margin-bottom:8px;">
              <p style="font-size:0.82rem; color:var(--error, #ef4444); font-weight:600; margin-bottom:8px;">Delete this appointment?</p>
              <p style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:10px;">This action cannot be undone.</p>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-secondary btn-sm" id="btn-delete-cancel-confirm" style="flex:1;">Cancel</button>
                <button class="btn btn-danger btn-sm" id="btn-delete-confirm-final" style="flex:1; background:#ef4444; color:#fff; border:none;">Delete Appointment</button>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-delete-appt-trigger" style="width:100%; color:var(--error, #ef4444); border-color:rgba(239,68,68,0.3); gap:6px; font-size:0.8rem;">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" style="width:14px;height:14px;">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete Appointment
            </button>
          </div>
        ` : ""}

      </div>
    `;

    this.bindReceiptEvents();
  }

  deleteAppointment() {
    const role = this.state.activeStaff ? this.state.activeStaff.role : "stylist";
    if (role !== "admin" && role !== "receptionist") {
      this.state.addNotification("Access Denied: Only admin/receptionist can delete appointments.", "error");
      return;
    }
    if (!this.selectedAppointment) return;

    const appointments = db.get("appointments") || [];
    const updated = appointments.filter(a => a.id !== this.selectedAppointment.id);
    db.set("appointments", updated);

    // Close drawer
    const drawer = document.getElementById("drawer-appointment-overlay");
    if (drawer) drawer.classList.remove("active");

    this.selectedAppointment = null;
    this.state.addNotification("Appointment deleted successfully.", "success");
    this.state.notify();
  }

  bindEvents() {
    const addBtn = this.container.querySelector("#btn-add-appt-schedule");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        this.showAddModal = true;
        this.render();
      });
    }

    const closeBtn = this.container.querySelector("#btn-close-appt-modal");
    if (closeBtn) closeBtn.addEventListener("click", () => { this.showAddModal = false; this.render(); });

    const cancelBtn = this.container.querySelector("#btn-cancel-appt-modal");
    if (cancelBtn) cancelBtn.addEventListener("click", () => { this.showAddModal = false; this.render(); });

    const addForm = this.container.querySelector("#add-appt-form");
    if (addForm) {
      addForm.addEventListener("submit", (e) => this.addNewBooking(e));
    }

    // Edit Modal bindings
    const closeEditBtn = this.container.querySelector("#btn-close-edit-modal");
    if (closeEditBtn) closeEditBtn.addEventListener("click", () => { this.showEditModal = false; this.editingAppointment = null; this.render(); });

    const cancelEditBtn = this.container.querySelector("#btn-cancel-edit-modal");
    if (cancelEditBtn) cancelEditBtn.addEventListener("click", () => { this.showEditModal = false; this.editingAppointment = null; this.render(); });

    const editForm = this.container.querySelector("#edit-appt-form");
    if (editForm) {
      editForm.addEventListener("submit", (e) => this.saveEditedBooking(e));
    }

    // Appointment Card/Row clicks
    if (false) {
      const cards = this.container.querySelectorAll(".appt-absolute-card");
      cards.forEach(card => {
        card.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = card.dataset.apptId;
          const appointments = db.get("appointments") || [];
          this.selectedAppointment = appointments.find(a => a.id === id);

          const drawer = document.getElementById("drawer-appointment-overlay");
          if (drawer) drawer.classList.add("active");

          this.renderDetailsDrawer();
        });

        // Bind Drag Start
        card.addEventListener("dragstart", (e) => {
          if (this.state.activeStaff && ["stylist", "senior_staff", "junior_staff"].includes(this.state.activeStaff.role)) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData("text/plain", card.dataset.apptId);
          card.style.opacity = "0.5";
        });

        card.addEventListener("dragend", () => {
          card.style.opacity = "1";
        });
      });

      // Bind Drop zones column grid listeners
      const cols = this.container.querySelectorAll(".stylist-grid-column");
      cols.forEach(col => {
        col.addEventListener("dragover", (e) => {
          if (this.state.activeStaff && ["stylist", "senior_staff", "junior_staff"].includes(this.state.activeStaff.role)) {
            return;
          }
          e.preventDefault();
          col.classList.add("drag-over");
        });

        col.addEventListener("dragleave", () => {
          col.classList.remove("drag-over");
        });

        col.addEventListener("drop", (e) => {
          e.preventDefault();
          col.classList.remove("drag-over");
          if (this.state.activeStaff && ["stylist", "senior_staff", "junior_staff"].includes(this.state.activeStaff.role)) {
            return;
          }
          
          const apptId = e.dataTransfer.getData("text/plain");
          const stylistId = col.dataset.stylistId;

          const rect = col.getBoundingClientRect();
          const y = e.clientY - rect.top;
          const totalHours = y / 80;
          
          const hourOffsetClamped = Math.max(0, Math.min(8.25, totalHours));
          const roundedHourOffset = Math.round(hourOffsetClamped / 0.25) * 0.25;

          this.updateDragAppointment(apptId, stylistId, roundedHourOffset);
        });
      });
    } else {
      // Timeline mode bindings
      const rows = this.container.querySelectorAll(".btn-view-details");
      rows.forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const appointments = db.get("appointments") || [];
          this.selectedAppointment = appointments.find(a => a.id === id);

          const drawer = document.getElementById("drawer-appointment-overlay");
          if (drawer) drawer.classList.add("active");

          this.renderDetailsDrawer();
        });
      });

      // Timeline quick actions
      const arrivedBtns = this.container.querySelectorAll(".action-quick-pill.arrived");
      arrivedBtns.forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const appointments = db.get("appointments") || [];
          this.selectedAppointment = appointments.find(a => a.id === id);
          this.updateAppointmentStatus("Arrived");
        });
      });

      const checkInBtns = this.container.querySelectorAll(".action-quick-pill.check-in");
      checkInBtns.forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const appointments = db.get("appointments") || [];
          this.selectedAppointment = appointments.find(a => a.id === id);
          this.updateAppointmentStatus("In Service");
        });
      });

      const checkoutBtns = this.container.querySelectorAll(".action-quick-pill.invoice");
      checkoutBtns.forEach(btn => {
        btn.addEventListener("click", () => {
          const id = btn.dataset.id;
          const appointments = db.get("appointments") || [];
          this.selectedAppointment = appointments.find(a => a.id === id);
          this.convertToInvoice();
        });
      });
    }
  }

  bindReceiptEvents() {
    const drawerBody = document.getElementById("appointment-drawer-body");
    if (!drawerBody) return;

    const btnScheduled = drawerBody.querySelector("#btn-appt-status-scheduled");
    if (btnScheduled) btnScheduled.addEventListener("click", () => this.updateAppointmentStatus("Scheduled"));

    const btnChecked = drawerBody.querySelector("#btn-appt-status-checked");
    if (btnChecked) btnChecked.addEventListener("click", () => this.updateAppointmentStatus("Arrived"));

    const btnInService = drawerBody.querySelector("#btn-appt-status-in-service");
    if (btnInService) btnInService.addEventListener("click", () => this.updateAppointmentStatus("In Service"));

    const btnCompleted = drawerBody.querySelector("#btn-appt-status-completed");
    if (btnCompleted) btnCompleted.addEventListener("click", () => this.updateAppointmentStatus("Completed"));

    const btnCancel = drawerBody.querySelector("#btn-appt-status-cancel");
    if (btnCancel) btnCancel.addEventListener("click", () => this.updateAppointmentStatus("Canceled"));

    const convertBtn = drawerBody.querySelector("#btn-convert-to-pos-checkout");
    if (convertBtn) {
      convertBtn.addEventListener("click", () => {
        if (!this.isConverting) this.convertToInvoice();
      });
    }

    const editDetailsBtn = drawerBody.querySelector("#btn-edit-appt-details");
    if (editDetailsBtn) {
      editDetailsBtn.addEventListener("click", () => {
        this.editingAppointment = this.selectedAppointment;
        this.showEditModal = true;
        this.render();
      });
    }

    // Delete appointment flow
    const deleteTrigger = drawerBody.querySelector("#btn-delete-appt-trigger");
    const deleteConfirmPrompt = drawerBody.querySelector("#delete-confirm-prompt");
    const deleteCancelBtn = drawerBody.querySelector("#btn-delete-cancel-confirm");
    const deleteFinalBtn = drawerBody.querySelector("#btn-delete-confirm-final");

    if (deleteTrigger && deleteConfirmPrompt) {
      deleteTrigger.addEventListener("click", () => {
        deleteConfirmPrompt.style.display = "block";
        deleteTrigger.style.display = "none";
      });
      deleteCancelBtn.addEventListener("click", () => {
        deleteConfirmPrompt.style.display = "none";
        deleteTrigger.style.display = "flex";
      });
      deleteFinalBtn.addEventListener("click", () => this.deleteAppointment());
    }
  }
}
