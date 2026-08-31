// gcc-followup — scheduled visitor follow-ups, ported from the Vercel crons.
// pg_cron calls this with the service role key as Bearer (see the cron notes
// in 20260831100000_gcc_visitor_crm.sql). Same cadence as before:
//   { job: 'follow_up' }     daily 09:00 UTC: email 2 (day 3) + email 3 (day 6)
//   { job: 'prayer_digest' } Mondays 08:00 UTC: pastor's weekly prayer summary
//
// Deploy: supabase functions deploy gcc-followup --no-verify-jwt
// Secrets: same as gcc-grace (Anthropic + Resend + SMS), GCC_PASTOR_EMAIL fallback.

import { isServiceRole, json, sendSms, smsFromNumber, supabase } from '../_shared/gcc.ts';
import { generateFollowUp, generatePrayerDigest } from '../_shared/grace.ts';
import { followUp2Email, followUp3Email } from '../_shared/emails.ts';
import { sendEmail } from '../_shared/gcc.ts';

async function ensureThreadAndLog(visitorId: string, campusSlug: string, phone: string, body: string) {
  const { data: existingThread } = await supabase.from('church_sms_threads')
    .select('id').eq('visitor_id', visitorId).maybeSingle();

  let threadId = existingThread?.id;
  if (!threadId) {
    const { data: newThread } = await supabase.from('church_sms_threads')
      .insert({ visitor_id: visitorId, campus_slug: campusSlug }).select('id').single();
    threadId = newThread?.id;
  }
  if (threadId) {
    await supabase.from('church_sms_messages').insert({
      thread_id: threadId, direction: 'outbound', body,
      from_number: smsFromNumber(), to_number: phone,
    });
  }
}

async function runFollowUp() {
  const now = Date.now();
  const day3Cutoff = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
  const day4Cutoff = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString();
  const day6Cutoff = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
  const day7Cutoff = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: campuses } = await supabase.from('church_campuses').select('slug, name, address');
  const campusOf = (slug: string) => (campuses ?? []).find((c) => c.slug === slug);

  const select = 'id, name, email, phone, prayer_request, how_heard, service_preference, is_returning, campus_slug';

  const { data: due2 } = await supabase.from('church_visitors').select(select)
    .not('email_1_sent_at', 'is', null).is('email_2_sent_at', null)
    .eq('opted_out', false)
    .lt('email_1_sent_at', day3Cutoff).gt('email_1_sent_at', day4Cutoff);

  const { data: due3 } = await supabase.from('church_visitors').select(select)
    .not('email_2_sent_at', 'is', null).is('email_3_sent_at', null)
    .eq('opted_out', false)
    .lt('email_1_sent_at', day6Cutoff).gt('email_1_sent_at', day7Cutoff);

  let sent2 = 0, sent3 = 0;

  for (const visitor of due2 ?? []) {
    const campus = campusOf(visitor.campus_slug);
    const churchName = campus?.name ?? 'Gateway City Church';
    const firstName = visitor.name.split(' ')[0];

    const ai = await generateFollowUp(2, {
      name: visitor.name, prayerRequest: visitor.prayer_request, howHeard: visitor.how_heard,
      servicePreference: visitor.service_preference, isReturning: visitor.is_returning, churchName,
    });

    if (visitor.email) {
      const html = followUp2Email(visitor.name, churchName, campus?.address ?? '', ai?.emailParagraphs);
      const resendId = await sendEmail(visitor.email, `Still thinking about you, ${firstName}`, html);
      await supabase.from('church_email_log').insert({
        visitor_id: visitor.id, email_type: 'followup_2', resend_email_id: resendId,
      });
    }

    if (visitor.phone) {
      const fallbackSms = `Hey ${firstName}! It was great having you at Gateway City Church on Sunday. Just wanted to check in and hope to see you again soon! Pastor Danny & the Gateway City Church Family`;
      const smsBody = ai ? `${ai.smsBody} Pastor Danny & the ${churchName} Family` : fallbackSms;
      await sendSms(visitor.phone, smsBody);
      await ensureThreadAndLog(visitor.id, visitor.campus_slug, visitor.phone, smsBody);
    }

    await supabase.from('church_visitors')
      .update({ email_2_sent_at: new Date().toISOString() }).eq('id', visitor.id);
    sent2++;
  }

  for (const visitor of due3 ?? []) {
    const campus = campusOf(visitor.campus_slug);
    const churchName = campus?.name ?? 'Gateway City Church';
    const firstName = visitor.name.split(' ')[0];

    const ai = await generateFollowUp(3, {
      name: visitor.name, prayerRequest: visitor.prayer_request, howHeard: visitor.how_heard,
      servicePreference: visitor.service_preference, isReturning: visitor.is_returning, churchName,
    });

    if (visitor.email) {
      const html = followUp3Email(visitor.name, churchName, campus?.address ?? '', ai?.emailParagraphs);
      const resendId = await sendEmail(visitor.email, `See you tomorrow, ${firstName}?`, html);
      await supabase.from('church_email_log').insert({
        visitor_id: visitor.id, email_type: 'followup_3', resend_email_id: resendId,
      });
    }

    if (visitor.phone) {
      const fallbackSms = `Hey ${firstName}! Tomorrow is Sunday and we'd love to see you back at Gateway City Church. Service starts at 10:00 AM. Come as you are! Pastor Danny & the ${churchName} Family`;
      const smsBody = ai ? `${ai.smsBody} Pastor Danny & the ${churchName} Family` : fallbackSms;
      await sendSms(visitor.phone, smsBody);
      await ensureThreadAndLog(visitor.id, visitor.campus_slug, visitor.phone, smsBody);
    }

    await supabase.from('church_visitors')
      .update({ email_3_sent_at: new Date().toISOString() }).eq('id', visitor.id);
    sent3++;
  }

  return json({ ok: true, sent2, sent3 });
}

async function runPrayerDigest() {
  const { data: campuses } = await supabase.from('church_campuses')
    .select('slug, name, address, pastor_email');
  if (!campuses?.length) return json({ sent: 0 });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  let sent = 0;

  for (const campus of campuses) {
    const pastorEmail = campus.pastor_email ?? Deno.env.get('GCC_PASTOR_EMAIL');
    if (!pastorEmail) continue;

    const { data: visitors } = await supabase.from('church_visitors')
      .select('name, prayer_request, created_at, how_heard')
      .eq('campus_slug', campus.slug)
      .not('prayer_request', 'is', null)
      .gt('created_at', weekAgo)
      .order('created_at', { ascending: false });
    if (!visitors?.length) continue;

    const digest = await generatePrayerDigest(visitors, campus.name);
    const bodyText = digest ?? visitors.map((v) => `• ${v.name}: "${v.prayer_request}"`).join('\n');
    const count = visitors.length;

    const html = `
<!DOCTYPE html>
<html>
<head>
<style>
  body { margin: 0; padding: 0; background: #f4f1ea; font-family: Georgia, serif; }
  .wrap { max-width: 560px; margin: 48px auto; background: #fff; border-radius: 4px; overflow: hidden; }
  .header { background: #0D1B2A; padding: 24px 40px; text-align: center; }
  .cross { font-size: 20px; color: #B8832A; margin-bottom: 4px; }
  .church-name { color: #B8832A; font-size: 15px; margin: 0; letter-spacing: 0.06em; }
  .body { padding: 40px 40px 32px; color: #2C2C2A; font-size: 15px; line-height: 1.8; }
  .week { color: #999; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 20px; }
  .summary { white-space: pre-wrap; }
  .footer { padding: 20px 40px; text-align: center; font-size: 11px; color: #bbb; border-top: 1px solid #f0ece3; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="cross">✝</div>
    <p class="church-name">${campus.name.toUpperCase()}</p>
  </div>
  <div class="body">
    <p class="week">Weekly Prayer Digest, ${count} request${count !== 1 ? 's' : ''} this week</p>
    <div class="summary">${bodyText.replace(/\n/g, '<br>')}</div>
  </div>
  <div class="footer">${campus.name} &bull; ${campus.address ?? ''}</div>
</div>
</body>
</html>`;

    await sendEmail(pastorEmail, `Prayer Digest, ${count} request${count !== 1 ? 's' : ''} this week`, html);
    sent++;
  }

  return json({ sent });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!isServiceRole(req)) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const job = String(body.job || '');

  try {
    if (job === 'follow_up') return await runFollowUp();
    if (job === 'prayer_digest') return await runPrayerDigest();
    return json({ error: 'unknown job' }, 400);
  } catch (err) {
    console.error('[gcc-followup]', err);
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
