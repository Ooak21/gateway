// Staff auth, SOP 3-file pattern (mirrors /crm/auth.js). Congregants never
// log in; this guards staff.html only. In DEMO_MODE the guard is skipped.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = 'https://jtifhcvbgxqwlywugvjv.supabase.co';
const SUPABASE_ANON_KEY = window.GCC ? window.GCC.SUPABASE_ANON_KEY : '';

export const gccSupabase = SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    })
  : null;

export async function gccAuthGuard(opts = {}) {
  if (window.GCC && window.GCC.DEMO_MODE) return { demo: true };
  if (!gccSupabase) { location.href = 'login.html'; return null; }
  const { data: { session } } = await gccSupabase.auth.getSession();
  if (!session) { location.href = 'login.html'; return null; }
  const meta = session.user.app_metadata || {};
  const role = meta.gcc_role || meta.role;
  const allow = opts.allow || ['gcc_staff', 'gcc_admin'];
  if (!allow.includes(role)) {
    if (role === 'gcc_kids') {
      location.href = 'kids.html';
      return null;
    }
    await gccSupabase.auth.signOut();
    location.href = 'login.html';
    return null;
  }
  return session;
}

export async function gccSignOut() {
  if (gccSupabase) await gccSupabase.auth.signOut();
  location.href = 'login.html';
}
