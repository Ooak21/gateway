// gcc-email-events — Resend webhook: stamps opened_at on the visitor email log.
// Point the Resend webhook (email.opened) at this function's URL.
// Deploy: supabase functions deploy gcc-email-events --no-verify-jwt

import { json, supabase } from '../_shared/gcc.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });
  const payload = await req.json().catch(() => ({}));

  if (payload?.type === 'email.opened') {
    const emailId = payload.data?.email_id;
    if (emailId) {
      await supabase.from('church_email_log')
        .update({ opened_at: new Date().toISOString() })
        .eq('resend_email_id', emailId)
        .is('opened_at', null);
    }
  }

  return json({ ok: true });
});
