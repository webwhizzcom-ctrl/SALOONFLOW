// src/utils/currency.js

export function formatINR(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) {
    amount = 0;
  }
  
  if (amount % 1 === 0) {
    return "₹" + Number(amount).toLocaleString("en-IN", {
      maximumFractionDigits: 0
    });
  } else {
    return "₹" + Number(amount).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
}
