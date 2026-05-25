// src/components/LoginScreen.js
import { db } from "../db.js";

export class LoginScreen {
  constructor(container, state) {
    this.container = container;
    this.state = state;

    this.selectedStaffId = null; // Target profile clicked (optional)
    
    // Subscribe to state updates
    this.state.subscribe(() => {
      this.toggleVisibility();
    });
  }

  init() {
    this.render();
    this.toggleVisibility();
  }

  appendPin(digit) {
    const input = this.container.querySelector(".login-pin-input");
    if (input) {
      input.value += digit;
    }
  }

  backspacePin() {
    const input = this.container.querySelector(".login-pin-input");
    if (input && input.value.length > 0) {
      input.value = input.value.slice(0, -1);
    }
  }

  updatePinDots() {
    // No-op: transitioned to standard password input
  }

  verifyLogin() {
    const input = this.container.querySelector(".login-pin-input");
    if (!input) return;
    const typed = input.value.trim();
    if (!typed) return;

    const stylists = db.get("stylists") || [];
    let matchedStaff = null;

    if (this.selectedStaffId) {
      // Check PIN against selected user
      const target = stylists.find(s => s.id === this.selectedStaffId);
      if (target && target.pin.toLowerCase() === typed.toLowerCase()) {
        matchedStaff = target;
      }
    } else {
      // Direct PIN entry: check PIN against all staff
      const target = stylists.find(s => s.pin.toLowerCase() === typed.toLowerCase());
      if (target) {
        matchedStaff = target;
      }
    }

    if (matchedStaff) {
      this.state.unlockScreen(matchedStaff.id);
      this.selectedStaffId = null;
      input.value = "";
      
      // Auto redirect to assigned view
      const role = matchedStaff.role;
      if (role === "admin") {
        this.state.setView("dashboard");
      } else if (role === "receptionist") {
        this.state.setView("invoice-creator");
      } else {
        this.state.setView("appointments");
      }
    } else {
      this.state.addNotification("Invalid Access PIN. Verification failed.", "error");
      const keypadBox = this.container.querySelector(".login-keypad-panel");
      if (keypadBox) {
        keypadBox.classList.add("shake-error");
        setTimeout(() => keypadBox.classList.remove("shake-error"), 400);
      }
    }
  }

  toggleVisibility() {
    if (this.state.isLocked) {
      this.container.classList.add("active");
      this.render(); // Ensure fresh listing of staff cards
      const input = this.container.querySelector(".login-pin-input");
      if (input) {
        input.focus();
      }
    } else {
      this.container.classList.remove("active");
    }
  }

  render() {
    const stylists = db.get("stylists") || [];
    
    this.container.innerHTML = `
      <div class="login-wrapper">
        <div class="login-left-brand">
          <img src="/logo.png" alt="Asmita's Salon" style="width: 70px; height: 70px; border-radius: var(--radius-lg); margin-bottom: 20px; border: 2.5px solid var(--primary); box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);" />
          <h1 style="font-family: var(--font-display); font-size: 2.2rem; font-weight: 800; color: #fff; letter-spacing: -1px; line-height: 1.1;">Asmita's Salon &amp; Academy</h1>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 6px;">Premium Enterprise Point of Sale</p>
          <div style="margin-top: auto; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 20px; font-size:0.75rem; color:var(--text-muted);">
            System Date: Sunday, May 24, 2026
          </div>
        </div>

        <div class="login-right-auth">
          
          <div class="login-auth-header">
            <h2 style="font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; color: #fff;">Select Account or Enter PIN</h2>
            <p style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">Click your profile or key in PIN directly to unlock terminal</p>
          </div>

          <!-- Staff Deck -->
          <div class="login-cards-grid">
            ${stylists.map(s => {
              const activeClass = this.selectedStaffId === s.id ? 'selected' : '';
              const initials = s.name.split(' ')[0][0] + (s.name.split(' ')[1] ? s.name.split(' ')[1][0] : '');
              return `
                <div class="login-staff-card ${activeClass}" data-id="${s.id}">
                  <span class="staff-avatar" style="width:42px; height:42px; font-size:0.95rem; background: var(--bg-input); border: 1.5px solid var(--border-color);">${initials}</span>
                  <div style="display:flex; flex-direction:column; line-height:1.2;">
                    <span style="font-weight:600; font-size:0.88rem; color:#fff;">${s.name}</span>
                    <span style="font-size:0.72rem; color:var(--text-secondary); text-transform:uppercase; font-weight:700; margin-top:2px;">${s.title || s.role}</span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <!-- PIN Pad Panel -->
          <div class="login-keypad-panel">
            <div class="login-pin-input-container">
              <input type="password" class="login-pin-input" placeholder="Enter Password or PIN" />
              <button class="login-toggle-eye" type="button" title="Toggle Password Visibility">
                <svg class="eye-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              </button>
            </div>
            
            <button class="btn btn-primary login-submit-btn" style="width: 240px; min-height: 40px; font-weight: 700; margin-top: -4px;">Unlock Terminal</button>

            <div class="login-numpad-grid">
              <button class="login-numpad-btn" data-val="1">1</button>
              <button class="login-numpad-btn" data-val="2">2</button>
              <button class="login-numpad-btn" data-val="3">3</button>
              <button class="login-numpad-btn" data-val="4">4</button>
              <button class="login-numpad-btn" data-val="5">5</button>
              <button class="login-numpad-btn" data-val="6">6</button>
              <button class="login-numpad-btn" data-val="7">7</button>
              <button class="login-numpad-btn" data-val="8">8</button>
              <button class="login-numpad-btn" data-val="9">9</button>
              <button class="login-numpad-btn clear" data-val="clear" style="font-size:0.8rem; font-weight:700; color:var(--text-muted);">Clear</button>
              <button class="login-numpad-btn" data-val="0">0</button>
              <button class="login-numpad-btn back" data-val="back" style="font-size:0.8rem; font-weight:700; color:var(--text-muted);">Del</button>
            </div>
          </div>

        </div>
      </div>
    `;

    this.bindEvents();
  }

  bindEvents() {
    // Select Profile Card triggers
    const cards = this.container.querySelectorAll(".login-staff-card");
    cards.forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        if (this.selectedStaffId === id) {
          this.selectedStaffId = null; // Toggle off
        } else {
          this.selectedStaffId = id;
        }
        const input = this.container.querySelector(".login-pin-input");
        if (input) input.value = ""; // Reset
        this.render(); // Redraw selection outline
        
        // Auto-focus input after selecting card
        const newInput = this.container.querySelector(".login-pin-input");
        if (newInput) newInput.focus();
      });
    });

    // Touch Button Keypad clicks
    const btnKeys = this.container.querySelectorAll(".login-numpad-btn");
    btnKeys.forEach(btn => {
      btn.addEventListener("click", () => {
        const val = btn.dataset.val;
        const input = this.container.querySelector(".login-pin-input");
        if (!input) return;
        if (val === "clear") {
          input.value = "";
        } else if (val === "back") {
          this.backspacePin();
        } else {
          this.appendPin(val);
        }
        input.focus();
      });
    });

    // Submit and Eye toggles
    const input = this.container.querySelector(".login-pin-input");
    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          this.verifyLogin();
        }
      });
    }

    const eyeBtn = this.container.querySelector(".login-toggle-eye");
    if (eyeBtn && input) {
      eyeBtn.addEventListener("click", () => {
        const type = input.getAttribute("type") === "password" ? "text" : "password";
        input.setAttribute("type", type);
        input.focus();
      });
    }

    const submitBtn = this.container.querySelector(".login-submit-btn");
    if (submitBtn) {
      submitBtn.addEventListener("click", () => {
        this.verifyLogin();
      });
    }
  }
}
