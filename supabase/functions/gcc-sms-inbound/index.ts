// gcc-sms-inbound — Sendblue receive webhook for the GateWay line.
//
// The one-tap onboarding text ("JOIN <CODE>") lands here. It: (1) opens the
// Sendblue conversation so the church may text this person from now on,
// (2) verifies + stores their real number on the member record,
// (3) stamps sms_opened_at, (4) replies instantly with the welcome-aboard
// message. STOP/UNSUBSCRIBE flips sms_opt_in off. Anything else gets a
// gentle pointer (this line is not a chat line — pastors live in the app).
//
// Webhook body (Sendblue): from_number, to_number, content, service, ...
// Register: sendblue webhooks add <fn-url> --type receive
// ⚠ The account currently routes receive webhooks to ibs-giveaway-sms.
//   Verify whether the CLI supports multiple receive webhooks before
//   registering; if it replaces, the giveaway flow breaks. See DEPLOY.md.
//
// Deploy with --no-verify-jwt. Secrets: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SENDBLUE_API_KEY/SECRET/FROM_NUMBER.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const WELCOME_ABOARD =
  "You're in! This is GateWay City Church. We'll text you a welcome when you join us and a goodbye when you head out. Reply STOP any time to opt out.";
const UNKNOWN_CODE =
  "We couldn't match that code. Open the GateWay app, check your welcome code on the Check In screen, and text JOIN plus the code.";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function reply(to: string, content: string) {
  const res = await fetch('https://api.sendblue.co/api/send-message', {
    method: 'POST',
    headers: {
      'sb-api-key-id': Deno.env.get('SENDBLUE_API_KEY')!,
      'sb-api-secret-key': Deno.env.get('SENDBLUE_API_SECRET')!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ number: to, from_number: Deno.env.get('SENDBLUE_FROM_NUMBER'), content }),
  });
  if (!res.ok) console.error('[GCC inbound] reply failed', res.status, await res.text());
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const from = (body.from_number || '').trim();
  const content = (body.content || '').trim();
  if (!from || !content) return Response.json({ ok: true });

  // Sendblue posts OUTBOUND status callbacks to the same receive webhook.
  // Without this guard we would reply to our own sends in a loop.
  const ourLine = (Deno.env.get('SENDBLUE_FROM_NUMBER') || '').replace(/\D/g, '');
  if (body.is_outbound === true) return Response.json({ ok: true });
  if (ourLine && from.replace(/\D/g, '') === ourLine) return Response.json({ ok: true });

  const upper = content.toUpperCase();

  if (/^(STOP|UNSUBSCRIBE|QUIT|CANCEL)\b/.test(upper)) {
    await supabase.from('church_members')
      .update({ sms_opt_in: false })
      .eq('phone_e164', from);
    console.log('[GCC inbound] opt-out', from);
    return Response.json({ ok: true });
  }

  const m = upper.match(/^JOIN\s+([A-Z0-9]{4,10})\b/);
  if (m) {
    const code = m[1];
    const { data: member } = await supabase
      .from('church_members')
      .select('id, first_name')
      .eq('geo_token', code)
      .maybeSingle();
    if (!member) {
      await reply(from, UNKNOWN_CODE);
      return Response.json({ ok: true });
    }
    await supabase.from('church_members').update({
      phone_e164: from,
      sms_opt_in: true,
      sms_opened_at: new Date().toISOString(),
    }).eq('id', member.id);
    await reply(from, WELCOME_ABOARD);
    console.log(`[GCC inbound] JOIN ${code} -> member ${member.id}`);
    return Response.json({ ok: true });
  }

  // Not a command: point them at the app, never leave a member on read.
  await reply(from, 'This is the GateWay City Church check-in line. To reach a pastor or send a prayer request, use the GateWay app. God bless!');
  return Response.json({ ok: true });
});
