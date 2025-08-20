window.SUPABASE_URL = "https://zpmqswjhesnixsycdmkr.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwbXFzd2poZXNuaXhzeWNkbWtyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU2MzQ4MDMsImV4cCI6MjA3MTIxMDgwM30.OiXrDG0ThoOFVhTNLPm4zpceUrUR6Q2r4Opd91fgE_Y";
window.supa = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// try { await window.supa?.auth?.signInAnonymously?.(); } catch {}