const isNode = typeof window === 'undefined';

/**
 * Supabase runtime params.
 *
 * Configure via Vite env:
 * - VITE_SUPABASE_URL = https://<project-ref>.supabase.co
 *
 * For client-side calls (Edge Functions gateway):
 * - Prefer the new publishable key: VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY=sb_publishable_...
 * - Fallback to legacy anon JWT: VITE_SUPABASE_ANON_KEY=eyJ...
 */
export const appParams = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || null,
  // Prefer the new publishable key if present; fallback to legacy anon key.
  supabaseAnonKey:
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    null,
};

// Clean up legacy Base44 keys (if the app was previously built with Base44)
if (!isNode) {
  try {
    window.localStorage.removeItem('base44_access_token');
    window.localStorage.removeItem('base44_refresh_token');
    window.localStorage.removeItem('base44_app_id');
    window.localStorage.removeItem('base44_app_base_url');
    window.localStorage.removeItem('base44_functions_version');
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('refresh_token');
  } catch (_e) {}
}
