let createClient;
try {
    const supabaseModule = require('@supabase/supabase-js');
    createClient = supabaseModule.createClient;
} catch (e) {
    console.warn('⚠️  @supabase/supabase-js module not found. Falling back to local storage.');
    createClient = null;
}

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://onzarfpadpfctwgtkhhi.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uemFyZnBhZHBmY3R3Z3RraGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3MjYxNzIsImV4cCI6MjA5MjMwMjE3Mn0.S3ttqo9OYVDJE6lXH4bkRf_oVRGBBmGFFTLgSyrMgWg';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uemFyZnBhZHBmY3R3Z3RraGhpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NjcyNjE3MiwiZXhwIjoyMDkyMzAyMTcyfQ.W3eCNYkbdZjOoy4lwzz3-zp5Liuca_GIkdbwIZ7gVDQ';

// Initialize Supabase client
let supabase = null;

if (createClient && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
} else {
  console.warn('⚠️  Supabase credentials not configured - using local JSON files only');
  console.log('   Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables');
}

module.exports = {
  supabase,
  SUPABASE_URL,
  SUPABASE_ANON_KEY
};
