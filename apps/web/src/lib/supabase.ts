import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Browser-side Supabase client (singleton). */
let _client: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient | null {
    if (!url || !key) return null;
    if (!_client) _client = createBrowserClient(url, key);
    return _client;
}

/** Quick check — returns false if env vars are missing. */
export const isSupabaseConfigured = (): boolean => Boolean(url && key);
