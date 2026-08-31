// gcc-service-blast — the Awaken-style experience with zero member setup.
//
// Scan the QR once (connect card captures the number + opt-in), and from then
// on the church texts the whole opted-in congregation on a schedule:
// "Welcome!" as service starts, "we're always here if you need" as it ends.
// Feels like presence detection to everyone in the room; it is a timer.
// The gcc-geo-ping Shortcut path layers true arrival detection on top.
//
// Invoked by pg_cron (or manually from the staff board later):
//   POST { "kind": "welcome" | "goodbye", "campus": "lasvegas" }
//
// Dedupe: one blast of each kind per member per DEDUPE_HOURS, tracked in
// church_sms_log, so a re-run or overlapping cron cannot double-text anyone.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GCC_SMS_ENABLED,
//          GCC_SMS_PROVIDER ('sendblue' now / 'telnyx' later),
//          SENDBLUE_API_KEY + SENDBLUE_API_SECRET + SENDBLUE_FROM_NUMBER,
//          or GCC_TELNYX_API_KEY + GCC_TELNYX_FROM.
//
// Sendblue notes: only members who have texted the line first are reachable
// (sms_opened_at is stamped by gcc-sms-inbound on their JOIN text) and the
// AI Agent plan caps follow-ups at ~200/day/line — fine for the demo and
// staff phase, the reason the proposal includes the church's own line.
// Deploy with --no-verify-jwt; require the service key in the Authorization
// header (pg_cron passes it) — checked below.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEDUPE_HOURS = 6;
const COPY: Record<string, string> = {
  welcome: 'Welcome! We are so glad you are here today. - GateWay City Church',
  goodbye: 'Thank you for being with us today. We are always here if you need us. - GateWay City Church',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function e164(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return phone.startsWith('+') ? phone : null;
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const { kind, campus } = await req.json().catch(() => ({}));
  if (!COPY[kind] || !campus) {
    return Response.json({ ok: false, error: 'kind must be welcome|goodbye, campus required' }, { status: 400 });
  }
  if ((Deno.env.get('GCC_SMS_ENABLED') || '').toLowerCase() !== 'true') {
    return Response.json({ ok: true, sent: 0, note: 'GCC_SMS_ENABLED is not true' });
  }
  const provider = (Deno.env.get('GCC_SMS_PROVIDER') || 'sendblue').toLowerCase();
  const sbKey = Deno.env.get('SENDBLUE_API_KEY'), sbSecret = Deno.env.get('SENDBLUE_API_SECRET'),
        sbFrom = Deno.env.get('SENDBLUE_FROM_NUMBER');
  const txFrom = Deno.env.get('GCC_TELNYX_FROM'), txKey = Deno.env.get('GCC_TELNYX_API_KEY');
  if (provider === 'sendblue' ? !(sbKey && sbSecret && sbFrom) : !(txFrom && txKey)) {
    return Response.json({ ok: false, error: provider + ' unconfigured' }, { status: 500 });
  }

  // Sendblue can only reach contacts who texted the line first, so that
  // branch also requires sms_opened_at (one chain per branch — reassigning
  // the builder trips supabase-js generics).
  const base = () => supabase
    .from('church_members')
    .select('id, first_name, phone, phone_e164')
    .eq('campus_slug', campus)
    .eq('sms_opt_in', true)
    .not('phone', 'is', null);
  const { data: members } = provider === 'sendblue'
    ? await base().not('sms_opened_at', 'is', null)
    : await base();

  const since = new Date(Date.now() - DEDUPE_HOURS * 3600_000).toISOString();
  const { data: recent } = await supabase
    .from('church_sms_log')
    .select('member_id')
    .eq('kind', kind)
    .gte('created_at', since);
  const alreadySent = new Set((recent || []).map((r) => r.member_id));

  let sent = 0, failed = 0;
  for (const m of members || []) {
    if (alreadySent.has(m.id)) continue;
    const to = m.phone_e164 || e164(m.phone);
    if (!to) continue;
    const res = provider === 'sendblue'
      ? await fetch('https://api.sendblue.co/api/send-message', {
          method: 'POST',
          headers: { 'sb-api-key-id': sbKey!, 'sb-api-secret-key': sbSecret!, 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: to, from_number: sbFrom, content: COPY[kind] }),
        })
      : await fetch('https://api.telnyx.com/v2/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${txKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: txFrom, to, text: COPY[kind] }),
        });
    const ok = res.ok;
    if (!ok) console.error('[GCC blast] send failed', m.id, res.status, await res.text());
    await supabase.from('church_sms_log').insert({
      campus_slug: campus, member_id: m.id, kind, to_phone: to, status: ok ? 'sent' : 'failed',
    });
    ok ? sent++ : failed++;
    await new Promise((r) => setTimeout(r, provider === 'sendblue' ? 1100 : 120)); // Sendblue: 1 msg/sec/line
  }
  console.log(`[GCC blast] ${kind} sent=${sent} failed=${failed}`);
  return Response.json({ ok: true, kind, sent, failed });
});
