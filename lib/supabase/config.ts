// Central place to read Supabase env. During Phase 1 the app is runnable
// without live credentials: when they are absent, auth is bypassed in dev so
// the portal shell + placeholder data can be viewed (see middleware.ts).

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
