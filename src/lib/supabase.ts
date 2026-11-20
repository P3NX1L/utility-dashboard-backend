import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Existing Supabase project, configured only via env. Nothing is provisioned by this app.
const url = import.meta.env["VITE_SUPABASE_URL"] as string | undefined;
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string | undefined;

export const supabaseConfigured = Boolean(url && key);
export const isProduction = import.meta.env.PROD;
/** Local development without env vars may run in demo mode; production always requires sign-in. */
export const allowDemoWithoutAuth = !isProduction && !supabaseConfigured;

let client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient | null {
  if (!url || !key || typeof window === "undefined") return null;
  client ??= createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  return client;
}
