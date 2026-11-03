import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the build was given Supabase credentials. Without them the site shows a setup guide. */
export const isConfigured = /^https:\/\//.test(url) && anonKey.length > 20;

// Only the public anon key ships to the browser; every permission is enforced by RLS in Postgres.
export const supabase: SupabaseClient = createClient(
  isConfigured ? url : "https://not-configured.supabase.co",
  isConfigured ? anonKey : "not-configured-anon-key-placeholder",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Turn a Supabase/Postgres error into a short message suitable for a toast. */
export function errMsg(e: unknown): string {
  if (!e) return "Something went wrong";
  if (typeof e === "string") return e;
  const anyE = e as { message?: string; error_description?: string; details?: string };
  const m = anyE.message || anyE.error_description || anyE.details || "Something went wrong";
  if (m.includes("duplicate key") && m.includes("photos_hash")) return "This photo was already uploaded";
  if (m.includes("duplicate key") && m.includes("events_dupe")) return "An event with this title already exists on that date";
  if (m.includes("duplicate key")) return "This record already exists";
  if (m.includes("row-level security")) return "You don't have permission to do that";
  if (m.includes("Failed to fetch")) return "No internet connection — please try again";
  return m;
}
