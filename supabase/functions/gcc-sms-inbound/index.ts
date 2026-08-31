// gcc-sms-inbound — Sendblue receive webhook for the GateWay line.
//
// Handles, in order:
//   1. Outbound status callbacks (Sendblue posts them here too): ignored.
//   2. STOP/UNSUBSCRIBE: opts out both the member (sms_opt_in) and the
//      visitor (opted_out) matching this number.
//   3. "JOIN <CODE>": member onboarding — verifies + stores the number,
//      stamps sms_opened_at, replies welcome-aboard.
//   4. A known VISITOR texting back: logs the message into their CRM thread
//      and runs Grace's urgency triage. Urgent/emergency messages create an
//      'urgent' note and alert the pastor by SMS. No auto-reply — a pastor
//      answers personally from the CRM (never robo-reply a crisis text).
//   5. Anything else: gentle pointer to the app (line is not a chat line).
//
// Webhook body (Sendblue): from_number, to_number, content, service, ...
// Register: sendblue webhooks add <fn-url> --type receive
//
// Deploy with --no-verify-jwt. Secrets: SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SENDBLUE_API_KEY/SECRET/FROM_NUMBER,
// GCC_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) for triage.

import { sendSms, smsFromNumber, supabase } from '../_shared/gcc.ts';
import { analyzeUrgency } from '../_shared/grace.ts';

const WELCOME_ABOARD =
  "You're in! This is GateWay City Church. We'll text you a welcome when you join us and a goodbye when you head out. Reply STOP any time to opt out.";
const UNKNOWN_CODE =
  "We couldn't match that code. Open the GateWay app, check your welcome code on the Check In screen, and text JOIN plus the code.";
const POINTER =
  'This is the GateWay City Church check-in line. To reach a pastor or send a prayer request, use the GateWay app. God bless!';

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

// Logs an inbound visitor message into their thread and triages it.
async function handleVisitorMessage(
  visitor: { id: string; campus_slug: string; name: string },
  from: string,
  content: string,
) {
  const { data: existingThread } = await supabase.from('church_sms_threads')
    .select('id').eq('visitor_id', visitor.id).maybeSingle();

  let threadId = existingThread?.id;
  if (!threadId) {
    const { data: newThread } = await supabase.from('church_sms_threads')
      .insert({ visitor_id: visitor.id, campus_slug: visitor.campus_slug })
      .select('id').single();
    threadId = newThread?.id;
  }

  if (threadId) {
    await supabase.from('church_sms_messages').insert({
      thread_id: threadId, direction: 'inbound', body: content,
      from_number: from, to_number: smsFromNumber(),
    });
  }

  await supabase.from('church_visitors')
    .update({ last_activity_at: new Date().toISOString() }).eq('id', visitor.id);

  const urgency = await analyzeUrgency(content).catch(() => null);
  if (urgency?.isUrgent) {
    const isEmergency = urgency.severity === 'emergency';
    await supabase.from('church_visitor_notes').insert({
      visitor_id: visitor.id,
      body: `${isEmergency ? 'EMERGENCY' : 'Urgent'} message flagged: "${content}"${urgency.reason ? ` (${urgency.reason})` : ''}`,
      tag: 'urgent',
    });

    const { data: campus } = await supabase.from('church_campuses')
      .select('pastor_phone').eq('slug', visitor.campus_slug).maybeSingle();
    if (campus?.pastor_phone) {
      const firstName = (visitor.name ?? 'A visitor').split(' ')[0];
      const alert = isEmergency
        ? `EMERGENCY: ${firstName} sent a message that may need immediate attention right now.${urgency.reason ? ` ${urgency.reason}` : ''} Check the Grace CRM.`
        : `Urgent: ${firstName} sent a message that may need same-day attention. Check the Grace CRM.`;
      await sendSms(campus.pastor_phone, alert).catch(() => null);
    }
  }
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
    await supabase.from('church_visitors')
      .update({ opted_out: true })
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

  // A visitor with this number gets their message logged into the Grace CRM.
  const { data: visitor } = await supabase.from('church_visitors')
    .select('id, campus_slug, name, opted_out')
    .eq('phone_e164', from)
    .maybeSingle();
  if (visitor) {
    await handleVisitorMessage(visitor, from, content);
    return Response.json({ ok: true });
  }

  // Not a command, not a visitor: point them at the app, never leave anyone on read.
  await reply(from, POINTER);
  return Response.json({ ok: true });
});
