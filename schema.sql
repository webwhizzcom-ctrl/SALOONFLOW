-- SALONFLOW SUPABASE SCHEMA MIGRATION
-- Copy and paste this script into the Supabase SQL Editor (https://supabase.com) to initialize your database.

-- 1. Create Customers Table
CREATE TABLE IF NOT EXISTS public.customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  dob TEXT,
  anniversary TEXT,
  membership_type TEXT DEFAULT 'Standard',
  loyalty_points INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create Appointments Table
CREATE TABLE IF NOT EXISTS public.appointments (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  stylist_id TEXT,
  stylist_name TEXT,
  service_name TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  status TEXT DEFAULT 'Scheduled',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create Invoices Table
CREATE TABLE IF NOT EXISTS public.invoices (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_name TEXT NOT NULL,
  subtotal NUMERIC NOT NULL,
  discount NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL,
  payment_method TEXT DEFAULT 'Cash',
  status TEXT DEFAULT 'Final',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create Invoice Items Table
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  invoice_id TEXT REFERENCES public.invoices(id) ON DELETE CASCADE,
  item_name TEXT NOT NULL,
  item_type TEXT DEFAULT 'Service',
  qty INTEGER DEFAULT 1,
  price NUMERIC NOT NULL,
  discount NUMERIC DEFAULT 0,
  total NUMERIC NOT NULL
);

-- 5. Enable Realtime Publications for all tables
-- This ensures instant synchronization across all receptionists and devices.
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.invoices;
alter publication supabase_realtime add table public.invoice_items;
