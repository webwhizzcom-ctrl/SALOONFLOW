// src/lib/supabase.js
// Supabase client singleton for SalonFlow
// Uses Vite environment variables — never expose the service_role key here

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[SalonFlow] Supabase env vars missing. ' +
    'Cloud sync disabled — running in localStorage-only mode.'
  );
}

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: { eventsPerSecond: 10 }
      },
      db: { schema: 'public' }
    })
  : null;

export const isSupabaseReady = () => supabase !== null;
