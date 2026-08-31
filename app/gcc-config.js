// GateWay City Church app config. One flip from demo to live: set DEMO_MODE
// false and fill SUPABASE_ANON_KEY after the sql/church_schema.sql migration
// is applied. Everything else reads from here.
window.GCC = {
  DEMO_MODE: false,

  CAMPUS: {
    slug: 'lasvegas',
    name: 'GateWay City Church',
    tagline: 'Inspiring Transformed Lives',
    address: '3630 N Rancho Dr #112, Las Vegas, NV 89130',
    phone: '(702) 881-5623',
    site: 'https://mygatewaycity.church/lasvegas',
    lat: 36.2162,
    lng: -115.2457,
    fenceRadius: 150 // meters; 80 tight / 150 medium / 250 wide (indoor GPS drift)
  },

  SERVICES: [
    { day: 'Sunday', time: '10:00 AM', label: 'English Service' },
    { day: 'Sunday', time: '1:00 PM', label: 'Spanish Service' },
    { day: 'Wednesday', time: '7:00 PM', label: 'Midweek Service' }
  ],

  PASTORS: [
    { id: 'danny', name: 'Pastor Danny Hand', role: 'Lead Pastor' },
    { id: 'paul',  name: 'Pastor Paul',       role: 'Pastor' },
    { id: 'fred',  name: 'Pastor Fred',       role: 'Pastor' }
  ],

  // The church's existing Tithe.ly giving page. No API needed, deep link only.
  // TODO: replace with the real giving URL from the church.
  GIVE_URL: 'https://give.tithe.ly/?formId=8d5c2d54-cee2-4c1d-9411-857b559a804a',

  // Where the projector QR sends phones. Set to the live origin at deploy.
  APP_URL: location.origin.startsWith('http') ? location.origin + location.pathname.replace(/[^/]*$/, 'index.html') : 'index.html',

  // Autonomous welcome (Door 1): the shared iCloud link to the "GateWay
  // Welcome" Apple Shortcut. Luis creates it once on an iPhone per
  // SHORTCUT.md and pastes the icloud.com/shortcuts/... link here.
  SHORTCUT_URL: 'https://www.icloud.com/shortcuts/c696af1115bc407ea5b5707afb08fbdd', // Gateway Welcome, verified 2026-08-22
  SHORTCUT_GOODBYE_URL: 'https://www.icloud.com/shortcuts/505289c4bcd742b7a8e1622b11f762da', // Gateway Goodbye, verified 2026-08-22

  // The church-facing text line (Sendblue for now, +1 931 871 0392; swaps to
  // the church's own line in the proposal). JOIN <code> opens the channel.
  SMS_LINE: '+19318710392',
  SMS_JOIN_KEYWORD: 'JOIN',
  PING_URL: 'https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-geo-ping',
  OPS_URL: 'https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-ops',
  GRACE_VOICE_URL: 'https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-grace-voice',

  SUPABASE_URL: 'https://jtifhcvbgxqwlywugvjv.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0aWZoY3ZiZ3hxd2x5d3Vndmp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MDc5NTgsImV4cCI6MjA4ODA4Mzk1OH0.UfRVLuvM8_HPvKXUEDXb0cxR50znv16L5Tf99AnSc7g' // public anon key, RLS enforces access
};
