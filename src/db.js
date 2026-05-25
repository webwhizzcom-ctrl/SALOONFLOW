// src/db.js

const DEFAULT_STYLISTS = [
  { id: "ST-001", name: "Prashant Bhate", role: "admin", title: "Salon Director", commissionRate: 0.5, shifts: "Flexible Hours", status: "Active", pin: "0001" },
  { id: "ST-002", name: "Pallavi Desai", role: "receptionist", title: "Front Desk Manager", commissionRate: 0.0, shifts: "9:00 AM - 6:00 PM", status: "Active", pin: "6846" },
  { id: "ST-003", name: "Pallavi Mane", role: "senior_staff", title: "Senior Hair Stylist", commissionRate: 0.4, shifts: "9:00 AM - 5:00 PM", status: "Active", pin: "Shubhangi" },
  { id: "ST-004", name: "Shubhangi Bajantri", role: "junior_staff", title: "Junior Assistant", commissionRate: 0.3, shifts: "10:00 AM - 6:00 PM", status: "Active", pin: "1111" }
];

const DEFAULT_SERVICES = [
  // PMU Clinic
  { id: "SV-PMU-001", name: "Microblading Eyebrows", price: 15000.00, type: "Service", category: "pmu", duration: 120, defaultTax: 18.0 },
  { id: "SV-PMU-002", name: "Lip Blush Micropigmentation", price: 12000.00, type: "Service", category: "pmu", duration: 90, defaultTax: 18.0 },
  { id: "SV-PMU-003", name: "Permanent Eyeliner", price: 8000.00, type: "Service", category: "pmu", duration: 60, defaultTax: 18.0 },
  { id: "SV-PMU-004", name: "PMU Touch-Up Session", price: 5000.00, type: "Service", category: "pmu", duration: 45, defaultTax: 18.0 },
  { id: "SV-PMU-005", name: "Scalp Micropigmentation (SMP)", price: 25000.00, type: "Service", category: "pmu", duration: 180, defaultTax: 18.0 },

  // Hair Care & Treatment
  { id: "SV-HR-001", name: "Advanced Keratin Treatment", price: 6500.00, type: "Service", category: "hair", duration: 150, defaultTax: 18.0 },
  { id: "SV-HR-002", name: "Cysteine Smoothening", price: 7500.00, type: "Service", category: "hair", duration: 150, defaultTax: 18.0 },
  { id: "SV-HR-003", name: "Global Hair Coloring", price: 4500.00, type: "Service", category: "hair", duration: 120, defaultTax: 18.0 },
  { id: "SV-HR-004", name: "Signature Haircut by Director", price: 1200.00, type: "Service", category: "hair", duration: 45, defaultTax: 18.0 },
  { id: "SV-HR-005", name: "Hair Spa & Conditioning", price: 1800.00, type: "Service", category: "hair", duration: 60, defaultTax: 18.0 },
  { id: "SV-HR-006", name: "Root Touch-Up", price: 1500.00, type: "Service", category: "hair", duration: 45, defaultTax: 18.0 },
  { id: "SV-HR-007", name: "Volumizing Blowout", price: 800.00, type: "Service", category: "hair", duration: 30, defaultTax: 18.0 },

  // Skin & Makeup
  { id: "SV-SK-001", name: "Premium HydraFacial MD", price: 5500.00, type: "Service", category: "skin", duration: 75, defaultTax: 18.0 },
  { id: "SV-SK-002", name: "Skin Brightening Clean-up", price: 1200.00, type: "Service", category: "skin", duration: 45, defaultTax: 18.0 },
  { id: "SV-SK-003", name: "Charcoal Peel-off Facial", price: 2500.00, type: "Service", category: "skin", duration: 60, defaultTax: 18.0 },
  { id: "SV-SK-004", name: "De-Tan & Bleach", price: 1000.00, type: "Service", category: "skin", duration: 30, defaultTax: 18.0 },
  { id: "SV-SK-005", name: "Bridal Glow Facial", price: 4000.00, type: "Service", category: "skin", duration: 90, defaultTax: 18.0 },
  { id: "SV-SK-006", name: "Bridal HD Makeup", price: 15000.00, type: "Service", category: "skin", duration: 120, defaultTax: 18.0 },
  { id: "SV-SK-007", name: "Party/Engagement Makeup", price: 6000.00, type: "Service", category: "skin", duration: 90, defaultTax: 18.0 },

  // Academy Courses
  { id: "SV-AC-001", name: "Professional Makeup Course (3M)", price: 65000.00, type: "Service", category: "academy", duration: 180, defaultTax: 18.0 },
  { id: "SV-AC-002", name: "Advanced Beautician Course (6M)", price: 85000.00, type: "Service", category: "academy", duration: 180, defaultTax: 18.0 },
  { id: "SV-AC-003", name: "PMU Specialization Course (1M)", price: 120000.00, type: "Service", category: "academy", duration: 240, defaultTax: 18.0 },
  { id: "SV-AC-004", name: "Self Makeup Workshop (3 Days)", price: 5000.00, type: "Service", category: "academy", duration: 120, defaultTax: 18.0 }
];

const DEFAULT_PRODUCTS = [
  { id: "PR-001", name: "Professional Keratin Shampoo", price: 1450.00, type: "Product", category: "products", stock: 15, defaultTax: 18.0 },
  { id: "PR-002", name: "Hydrating Hair Conditioner", price: 1600.00, type: "Product", category: "products", stock: 12, defaultTax: 18.0 },
  { id: "PR-003", name: "Skin Glow Vitamin C Serum", price: 950.00, type: "Product", category: "products", stock: 2, defaultTax: 18.0 },
  { id: "PR-004", name: "Scalp Revitalizing Oil", price: 750.00, type: "Product", category: "products", stock: 0, defaultTax: 18.0 }
];

const DEFAULT_MEMBERSHIPS = [
  { id: "MB-001", name: "Salon Premium Annual Membership", price: 4999.00, type: "Membership", category: "memberships", duration: 365, defaultTax: 18.0 },
  { id: "MB-002", name: "PMU Touch-up Privilege Pass", price: 9999.00, type: "Membership", category: "memberships", duration: 365, defaultTax: 18.0 }
];

const DEFAULT_GIFT_CARDS = [
  { id: "GC-1000", name: "₹1,000 Store Gift Card", price: 1000.00, type: "GiftCard", category: "giftcards", value: 1000.00, defaultTax: 0 },
  { id: "GC-5000", name: "₹5,000 Store Gift Card", price: 5000.00, type: "GiftCard", category: "giftcards", value: 5000.00, defaultTax: 0 },
  { id: "GC-10000", name: "₹10,000 Store Gift Card", price: 10000.00, type: "GiftCard", category: "giftcards", value: 10000.00, defaultTax: 0 }
];

const DEFAULT_CUSTOMERS = [];

const DEFAULT_SETTINGS = {
  taxConfig: {
    serviceTaxRate: 18.0,
    productTaxRate: 18.0,
    membershipTaxRate: 18.0,
    giftCardTaxRate: 0.0,
    taxNumber: "27AAAFS4452G1ZA",
    taxGroupName: "CGST + SGST (GST)"
  },
  paymentGateways: [
    { id: "pos", name: "Card Terminal", enabled: true },
    { id: "cash", name: "Cash Payment", enabled: true },
    { id: "online", name: "UPI / QR Code", enabled: true },
    { id: "points", name: "Points Redemption", enabled: true },
    { id: "giftcard", name: "Gift Card Balance", enabled: true }
  ],
  invoicePrefix: "ASMITA-2026-",
  nextInvoiceNum: 1001,
  securityCodes: {
    managerPIN: "Shubhangi",
    adminPIN: "0001"
  },
  templateConfig: {
    fontFamily: "'Plus Jakarta Sans', sans-serif",
    headerTitle: "Asmita's Beauty Salon & Academy",
    headerSubtitle: "T1 & T2, 3rd Floor, Urmila Empire, Amrai Road, Sangli",
    headerPhone: "+91 96371 31115",
    logoUrl: "",
    footerText: "Thank you for visiting Asmita's Salon! Re-book within 30 days for 10% off your next service."
  }
};

const DEFAULT_INVOICES = [];

const DEFAULT_APPOINTMENTS = [];

export const db = {
  get(key, defaultValue) {
    const data = localStorage.getItem(`salonflow_${key}`);
    if (data) {
      try {
        return JSON.parse(data);
      } catch (e) {
        console.error("Failed parsing storage key:", key, e);
      }
    }
    this.set(key, defaultValue);
    return defaultValue;
  },

  set(key, value) {
    localStorage.setItem(`salonflow_${key}`, JSON.stringify(value));
  },

  init() {
    // Migrate local storage credentials if old values are present
    let storedStylists = localStorage.getItem("salonflow_stylists");
    if (storedStylists) {
      try {
        let parsed = JSON.parse(storedStylists);
        let updated = false;
        parsed.forEach(s => {
          if (s.id === "ST-003" && s.pin !== "Shubhangi") {
            s.pin = "Shubhangi";
            updated = true;
          }
        });
        if (updated) {
          localStorage.setItem("salonflow_stylists", JSON.stringify(parsed));
        }
      } catch(e) {
        console.error("Migration failed for stylists:", e);
      }
    }
    let storedSettings = localStorage.getItem("salonflow_settings");
    if (storedSettings) {
      try {
        let parsed = JSON.parse(storedSettings);
        if (parsed && parsed.securityCodes && parsed.securityCodes.managerPIN !== "Shubhangi") {
          parsed.securityCodes.managerPIN = "Shubhangi";
          localStorage.setItem("salonflow_settings", JSON.stringify(parsed));
        }
      } catch(e) {
        console.error("Migration failed for settings:", e);
      }
    }

    let stylists = localStorage.getItem("salonflow_stylists") ? JSON.parse(localStorage.getItem("salonflow_stylists")) : null;
    if (!stylists || !stylists.find(s => s.name === "Prashant Bhate")) {
      localStorage.setItem("salonflow_stylists", JSON.stringify(DEFAULT_STYLISTS));
      localStorage.setItem("salonflow_giftcards", JSON.stringify(DEFAULT_GIFT_CARDS));
      localStorage.setItem("salonflow_appointments", JSON.stringify(DEFAULT_APPOINTMENTS));
      localStorage.setItem("salonflow_invoices", JSON.stringify(DEFAULT_INVOICES));
      localStorage.setItem("salonflow_customers", JSON.stringify(DEFAULT_CUSTOMERS));
      localStorage.setItem("salonflow_settings", JSON.stringify(DEFAULT_SETTINGS));
    }
    
    this.get("stylists", DEFAULT_STYLISTS);
    this.get("services", DEFAULT_SERVICES);
    this.get("products", DEFAULT_PRODUCTS);
    this.get("memberships", DEFAULT_MEMBERSHIPS);
    this.get("giftcards", DEFAULT_GIFT_CARDS);
    this.get("customers", DEFAULT_CUSTOMERS);
    this.get("settings", DEFAULT_SETTINGS);
    this.get("invoices", DEFAULT_INVOICES);
    this.get("appointments", DEFAULT_APPOINTMENTS);
    this.get("audit_logs", []);
  },

  reset() {
    localStorage.removeItem("salonflow_stylists");
    localStorage.removeItem("salonflow_services");
    localStorage.removeItem("salonflow_products");
    localStorage.removeItem("salonflow_memberships");
    localStorage.removeItem("salonflow_giftcards");
    localStorage.removeItem("salonflow_customers");
    localStorage.removeItem("salonflow_settings");
    localStorage.removeItem("salonflow_invoices");
    localStorage.removeItem("salonflow_appointments");
    localStorage.removeItem("salonflow_audit_logs");
    this.init();
  }
};
