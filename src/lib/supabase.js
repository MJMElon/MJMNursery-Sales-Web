import { createClient } from '@supabase/supabase-js';

// Same Supabase project as every other MJM app (and as the static pages
// still living in public/). Defaults are the public client config; env
// vars allow pointing a build at a different project if ever needed.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://kibqjztozokohqmhqqqf.supabase.co';
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpYnFqenRvem9rb2hxbWhxcXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzQzNjIsImV4cCI6MjA4OTgxMDM2Mn0.J7qJUZhWXYf5b9oey4wXJkjdi66jomEMw_NeV9NWF7M';

// Default client options match the CDN setup the static pages use, so the
// stored session (sb-*-auth-token in localStorage) is shared between
// migrated React pages and not-yet-migrated static pages.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
