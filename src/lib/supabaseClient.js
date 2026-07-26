import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Loud in dev, but don't crash the whole app over it -- lets the UI
  // still render on mock-data screens even if env vars aren't set yet.
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY -- auth and live data will not work until these are set.'
  )
}

export const supabase = createClient(url, anonKey)
