// src/lib/supabaseDb.js
// Cloud sync adapter for SalonFlow.
// 
// ARCHITECTURE: Hybrid localStorage + Supabase
// - localStorage drives all UI reads (instant, zero-lag)
// - Supabase syncs in background (non-blocking)
// - On app boot, Supabase hydrates localStorage
// - Realtime subscriptions refresh state automatically
// - If Supabase is unreachable, app works fully offline
//
// All public methods are async but NEVER block the UI thread.

import { supabase, isSupabaseReady } from './supabase.js';

// ─── Internal helpers ───────────────────────────────────────────────────────

function log(msg, data) {
  if (import.meta.env.DEV) {
    console.log(`[SupabaseDB] ${msg}`, data ?? '');
  }
}

function logError(msg, err) {
  console.error(`[SupabaseDB] ${msg}`, err);
}

// Safe wrapper: run a Supabase query, swallow network errors gracefully
async function safeQuery(label, queryFn) {
  if (!isSupabaseReady()) return { data: null, error: 'supabase_not_ready' };
  try {
    const result = await queryFn();
    if (result.error) {
      logError(`${label} failed:`, result.error.message);
    }
    return result;
  } catch (err) {
    logError(`${label} threw:`, err);
    return { data: null, error: err };
  }
}

// ─── Realtime subscription registry ─────────────────────────────────────────

const _channels = {};

function unsubscribe(name) {
  if (_channels[name]) {
    supabase.removeChannel(_channels[name]);
    delete _channels[name];
  }
}

// ─── CUSTOMERS ───────────────────────────────────────────────────────────────

/**
 * Pull all customers from Supabase, hydrate localStorage.
 * Called once on app boot.
 */
export async function loadCustomersFromCloud() {
  const { data, error } = await safeQuery('loadCustomers', () =>
    supabase.from('customers').select('*').order('created_at', { ascending: true })
  );
  if (error || !data) return null;

  // Map Supabase snake_case → app camelCase
  const mapped = data.map(mapCustomerFromDB);
  log('Loaded customers from cloud:', mapped.length);
  return mapped;
}

/**
 * Push a single customer to Supabase (upsert by id).
 * Fire-and-forget — does not block the UI.
 */
export async function upsertCustomer(customer) {
  await safeQuery('upsertCustomer', () =>
    supabase.from('customers').upsert(mapCustomerToDB(customer), { onConflict: 'id' })
  );
  log('Upserted customer:', customer.name);
}

/**
 * Delete a customer from Supabase.
 */
export async function deleteCustomer(customerId) {
  await safeQuery('deleteCustomer', () =>
    supabase.from('customers').delete().eq('id', customerId)
  );
  log('Deleted customer:', customerId);
}

/**
 * Subscribe to real-time customer changes.
 * @param {Function} onChange - called with updated full customer list from localStorage
 */
export function subscribeToCustomers(onChange) {
  if (!isSupabaseReady()) return;
  unsubscribe('customers');

  _channels['customers'] = supabase
    .channel('salon_customers')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' },
      async (payload) => {
        log('Customer realtime event:', payload.eventType);
        // Re-pull full list so localStorage stays in sync
        const fresh = await loadCustomersFromCloud();
        if (fresh) onChange(fresh);
      }
    )
    .subscribe((status) => {
      log('Customers channel status:', status);
    });
}

// ─── APPOINTMENTS ────────────────────────────────────────────────────────────

/**
 * Pull all appointments from Supabase, hydrate localStorage.
 */
export async function loadAppointmentsFromCloud() {
  const { data, error } = await safeQuery('loadAppointments', () =>
    supabase.from('appointments').select('*').order('start_time', { ascending: true })
  );
  if (error || !data) return null;

  const mapped = data.map(mapAppointmentFromDB);
  log('Loaded appointments from cloud:', mapped.length);
  return mapped;
}

/**
 * Push a single appointment to Supabase (upsert by id).
 */
export async function upsertAppointment(appt) {
  await safeQuery('upsertAppointment', () =>
    supabase.from('appointments').upsert(mapAppointmentToDB(appt), { onConflict: 'id' })
  );
  log('Upserted appointment:', appt.id);
}

/**
 * Update appointment status only.
 */
export async function updateAppointmentStatus(apptId, status) {
  await safeQuery('updateAppointmentStatus', () =>
    supabase.from('appointments').update({ status }).eq('id', apptId)
  );
}

/**
 * Delete an appointment.
 */
export async function deleteAppointment(apptId) {
  await safeQuery('deleteAppointment', () =>
    supabase.from('appointments').delete().eq('id', apptId)
  );
  log('Deleted appointment:', apptId);
}

/**
 * Subscribe to real-time appointment changes.
 * When any device books/cancels, all other devices refresh instantly.
 */
export function subscribeToAppointments(onChange) {
  if (!isSupabaseReady()) return;
  unsubscribe('appointments');

  _channels['appointments'] = supabase
    .channel('salon_appointments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' },
      async (payload) => {
        log('Appointment realtime event:', payload.eventType);
        const fresh = await loadAppointmentsFromCloud();
        if (fresh) onChange(fresh);
      }
    )
    .subscribe((status) => {
      log('Appointments channel status:', status);
    });
}

// ─── INVOICES ────────────────────────────────────────────────────────────────

/**
 * Pull all invoices from Supabase (with items joined).
 */
export async function loadInvoicesFromCloud() {
  const { data, error } = await safeQuery('loadInvoices', () =>
    supabase
      .from('invoices')
      .select(`*, invoice_items(*)`)
      .order('created_at', { ascending: false })
  );
  if (error || !data) return null;

  const mapped = data.map(mapInvoiceFromDB);
  log('Loaded invoices from cloud:', mapped.length);
  return mapped;
}

/**
 * Save a finalized invoice + its line items to Supabase.
 * Called after processCheckout() succeeds.
 */
export async function saveInvoice(invoice) {
  // 1. Insert/upsert the invoice header
  const { error: invErr } = await safeQuery('saveInvoice', () =>
    supabase.from('invoices').upsert(mapInvoiceToDB(invoice), { onConflict: 'id' })
  );
  if (invErr) return;

  // 2. Delete old items for this invoice (in case of re-save)
  await safeQuery('deleteOldItems', () =>
    supabase.from('invoice_items').delete().eq('invoice_id', invoice.id)
  );

  // 3. Insert all line items
  const items = (invoice.items || []).map(item => mapInvoiceItemToDB(invoice.id, item));
  if (items.length > 0) {
    await safeQuery('saveInvoiceItems', () =>
      supabase.from('invoice_items').insert(items)
    );
  }

  log('Saved invoice to cloud:', invoice.id);
}

/**
 * Subscribe to real-time invoice events.
 */
export function subscribeToInvoices(onChange) {
  if (!isSupabaseReady()) return;
  unsubscribe('invoices');

  _channels['invoices'] = supabase
    .channel('salon_invoices')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' },
      async (payload) => {
        log('Invoice realtime event:', payload.eventType);
        const fresh = await loadInvoicesFromCloud();
        if (fresh) onChange(fresh);
      }
    )
    .subscribe((status) => {
      log('Invoices channel status:', status);
    });
}

// ─── BULK SEED (one-time migration of existing localStorage data) ─────────────

/**
 * One-time push of all localStorage data to Supabase.
 * Safe to call multiple times (uses upsert).
 */
export async function seedFromLocalStorage(localCustomers, localAppointments, localInvoices) {
  if (!isSupabaseReady()) return;

  log('Starting bulk seed to Supabase...');

  // Customers
  if (localCustomers && localCustomers.length > 0) {
    const rows = localCustomers.map(mapCustomerToDB);
    await safeQuery('seedCustomers', () =>
      supabase.from('customers').upsert(rows, { onConflict: 'id' })
    );
    log('Seeded customers:', rows.length);
  }

  // Appointments
  if (localAppointments && localAppointments.length > 0) {
    const rows = localAppointments.map(mapAppointmentToDB);
    await safeQuery('seedAppointments', () =>
      supabase.from('appointments').upsert(rows, { onConflict: 'id' })
    );
    log('Seeded appointments:', rows.length);
  }

  // Invoices (header only — items would need separate seeding for existing data)
  if (localInvoices && localInvoices.length > 0) {
    const rows = localInvoices.filter(inv => inv.status === 'Final').map(mapInvoiceToDB);
    if (rows.length > 0) {
      await safeQuery('seedInvoices', () =>
        supabase.from('invoices').upsert(rows, { onConflict: 'id' })
      );
    }
    // Seed items per invoice
    for (const inv of localInvoices.filter(i => i.status === 'Final')) {
      const items = (inv.items || []).map(item => mapInvoiceItemToDB(inv.id, item));
      if (items.length > 0) {
        await safeQuery('seedInvoiceItems', () =>
          supabase.from('invoice_items').upsert(items, { onConflict: 'id' })
        );
      }
    }
    log('Seeded invoices:', rows.length);
  }

  log('Bulk seed complete.');
}

// ─── DATA MAPPERS ─────────────────────────────────────────────────────────────

function mapCustomerToDB(c) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone || '',
    email: c.email || '',
    address: c.address || '',
    dob: c.dob || null,
    anniversary: c.anniversary || null,
    membership_type: c.membershipType || 'Standard',
    loyalty_points: c.loyaltyPoints || 0,
    notes: c.notes || '',
  };
}

function mapCustomerFromDB(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    email: row.email || '',
    address: row.address || '',
    dob: row.dob || '',
    anniversary: row.anniversary || '',
    membershipType: row.membership_type || 'Standard',
    loyaltyPoints: row.loyalty_points || 0,
    notes: row.notes || '',
  };
}

function mapAppointmentToDB(a) {
  return {
    id: a.id,
    customer_id: a.customerID || a.customer_id || null,
    customer_name: a.customerName || a.customer_name || 'Walk-in',
    customer_phone: a.customerPhone || a.customer_phone || '',
    stylist_id: a.stylistID || a.stylist_id || null,
    stylist_name: a.stylistName || a.stylist_name || '',
    service_name: a.serviceName || a.service_name || '',
    start_time: a.startTime || a.start_time,
    end_time: a.endTime || a.end_time || null,
    status: a.status || 'Scheduled',
    notes: a.notes || '',
  };
}

function mapAppointmentFromDB(row) {
  return {
    id: row.id,
    customerID: row.customer_id || '',
    customerName: row.customer_name || 'Walk-in',
    customerPhone: row.customer_phone || '',
    stylistID: row.stylist_id || '',
    stylistName: row.stylist_name || '',
    serviceName: row.service_name || '',
    startTime: row.start_time,
    endTime: row.end_time || null,
    status: row.status || 'Scheduled',
    notes: row.notes || '',
  };
}

function mapInvoiceToDB(inv) {
  const payment = inv.payments && inv.payments[0] ? inv.payments[0] : {};
  return {
    id: inv.id,
    customer_id: inv.customerId || inv.customerID || null,
    customer_name: inv.customerName || 'Walk-in',
    subtotal: inv.subtotal || 0,
    discount: inv.discount || 0,
    total: inv.total || 0,
    payment_method: payment.method || inv.paymentMethod || 'Cash',
    status: inv.status || 'Final',
    notes: inv.notes || '',
    created_at: inv.createdAt || new Date().toISOString(),
  };
}

function mapInvoiceFromDB(row) {
  return {
    id: row.id,
    customerName: row.customer_name,
    customerId: row.customer_id,
    subtotal: parseFloat(row.subtotal) || 0,
    discount: parseFloat(row.discount) || 0,
    total: parseFloat(row.total) || 0,
    payments: [{ method: row.payment_method, amount: parseFloat(row.total) || 0 }],
    status: row.status,
    notes: row.notes || '',
    createdAt: row.created_at,
    items: (row.invoice_items || []).map(mapInvoiceItemFromDB),
  };
}

function mapInvoiceItemToDB(invoiceId, item) {
  return {
    invoice_id: invoiceId,
    item_name: item.name,
    item_type: item.type || 'Service',
    qty: item.qty || 1,
    price: item.price || 0,
    discount: item.discount || 0,
    total: ((item.price || 0) - (item.discount || 0)) * (item.qty || 1),
  };
}

function mapInvoiceItemFromDB(row) {
  return {
    name: row.item_name,
    type: row.item_type || 'Service',
    qty: row.qty || 1,
    price: parseFloat(row.price) || 0,
    discount: parseFloat(row.discount) || 0,
  };
}
