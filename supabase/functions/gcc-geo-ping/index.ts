// gcc-geo-ping — the autonomous welcome/goodbye receiver.
//
// The member's own iPhone fires this via an Apple Shortcuts "When I Arrive /
// When I Leave" automation (runs silently since iOS 17, phone in pocket).
// GET so the Shortcut is a single "Get Contents of URL" action:
//
//   https://<project>.supabase.co/functions/v1/gcc-geo-ping?t=<GEO_TOKEN>&e=enter
//   https://<project>.supabase.co/functions/v1/gcc-geo-ping?t=<GEO_TOKEN>&e=exit
//
// Deploy with --no-verify-jwt (public endpoint, the geo_token IS the auth —
// random per member, issued by the connect card, revocable by nulling it).
//
// Behavior: resolve token -> member; dedupe (same event within DEDUPE_HOURS
// is a no-op); write church_geofence_events (source 'shortcut'); on enter,
// upsert today's church_attendance; send the welcome/goodbye SMS via Telnyx
// ONLY when SMS is enabled and the member opted in.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GCC_SMS_ENABLED ('true'
// to send), GCC_SMS_PROVIDER ('sendblue' now; 'telnyx' when the church's own
// 10DLC line exists). Sendblue reuses the account-level SENDBLUE_API_KEY /
// SENDBLUE_API_SECRET / SENDBLUE_FROM_NUMBER secrets (+1 931 871 0392).
// Telnyx path: GCC_TELNYX_API_KEY + GCC_TELNYX_FROM.
//
// Sendblue AI-Agent constraint: outbound only reaches contacts who have
// texted the line first — the app's one-tap "JOIN <code>" text (handled by
// gcc-sms-inbound) opens that door during onboarding.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const DEDUPE_HOURS = 4;
const WELCOME_TEXT =
  'Welcome! We are so glad you are here today. - GateWay City Church';
const GOODBYE_TEXT =
  'Thank you for being with us today. We are always here if you need us. - GateWay City Church';

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

async function sendSms(to: string, text: string): Promise<string> {
  if ((Deno.env.get('GCC_SMS_ENABLED') || '').toLowerCase() !== 'true') return 'sms_disabled';
  const provider = (Deno.env.get('GCC_SMS_PROVIDER') || 'sendblue').toLowerCase();
  let res: Response;
  if (provider === 'sendblue') {
    const key = Deno.env.get('SENDBLUE_API_KEY');
    const secret = Deno.env.get('SENDBLUE_API_SECRET');
    const from = Deno.env.get('SENDBLUE_FROM_NUMBER');
    if (!key || !secret || !from) return 'sms_unconfigured';
    res = await fetch('https://api.sendblue.co/api/send-message', {
      method: 'POST',
      headers: { 'sb-api-key-id': key, 'sb-api-secret-key': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: to, from_number: from, content: text }),
    });
  } else {
    const from = Deno.env.get('GCC_TELNYX_FROM');
    const key = Deno.env.get('GCC_TELNYX_API_KEY');
    if (!from || !key) return 'sms_unconfigured';
    res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, text }),
    });
  }
  if (!res.ok) {
    console.error(`[GCC] ${provider} send failed`, res.status, await res.text());
    return 'sms_failed';
  }
  return 'sms_sent';
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = (url.searchParams.get('t') || '').trim().toUpperCase();
  const event = (url.searchParams.get('e') || '').trim().toLowerCase();

  if (!token || !['enter', 'exit'].includes(event)) {
    return Response.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  const { data: member } = await supabase
    .from('church_members')
    .select('id, campus_slug, first_name, last_name, phone, phone_e164, sms_opt_in, sms_opened_at')
    .eq('geo_token', token)
    .maybeSingle();
  // Unknown token gets a 200 so probing reveals nothing.
  if (!member) return Response.json({ ok: true });

  const name = `${member.first_name} ${member.last_name}`.trim();

  // Dedupe: same member, same event, within the window -> no-op.
  const since = new Date(Date.now() - DEDUPE_HOURS * 3600_000).toISOString();
  const { data: recent } = await supabase
    .from('church_geofence_events')
    .select('id')
    .eq('member_id', member.id)
    .eq('event', event)
    .gte('created_at', since)
    .limit(1);
  if (recent && recent.length) return Response.json({ ok: true, deduped: true });

  await supabase.from('church_geofence_events').insert({
    campus_slug: member.campus_slug,
    member_id: member.id,
    display_name: name || 'Guest',
    event,
    source: 'shortcut',
  });

  let sms = 'skipped';
  if (event === 'enter') {
    // One attendance row per member per day.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const { data: already } = await supabase
      .from('church_attendance')
      .select('id')
      .eq('member_id', member.id)
      .eq('service_date', today)
      .limit(1);
    if (!already || !already.length) {
      await supabase.from('church_attendance').insert({
        campus_slug: member.campus_slug,
        member_id: member.id,
        display_name: name || 'Guest',
        service_date: today,
        method: 'shortcut',
      });
    }
  }

  const to = member.phone_e164 || e164(member.phone);
  const provider = (Deno.env.get('GCC_SMS_PROVIDER') || 'sendblue').toLowerCase();
  const reachable = provider === 'sendblue' ? !!member.sms_opened_at : true;
  if (to && member.sms_opt_in && reachable) {
    sms = await sendSms(to, event === 'enter' ? WELCOME_TEXT : GOODBYE_TEXT);
  }

  console.log(`[GCC] ${event} ${name} (${member.id}) sms=${sms}`);
  return Response.json({ ok: true, event, sms });
});
