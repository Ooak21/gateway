// gcc-grace — the visitor CRM brain + server-side visitor actions.
// Ports the GroundworkHQ Grace API routes onto IBS Supabase. One POST API:
//
//   { action: 'intake', ... }                          anon (connection card)
//   { action: 'nlsearch', query }                      staff JWT
//   { action: 'insight', visitor_id }                  staff JWT
//   { action: 'suggest_reply', visitor_id, channel, recent_messages } staff JWT
//   { action: 'email_send', visitor_id, subject, body } staff JWT
//   { action: 'sms_reply', thread_id, body }           staff JWT
//
// Plain reads/writes (visitor list, notes, checkin, delete) go straight to
// PostgREST under the staff RLS policies; this function only holds what needs
// providers (Claude, Resend, SMS) or must run without a login (intake).
//
// Deploy: supabase functions deploy gcc-grace --no-verify-jwt
// Secrets: GCC_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY), GCC_RESEND_API_KEY
// (or RESEND_API_KEY), GCC_RESEND_FROM, GCC_SMS_ENABLED + provider secrets.

import { CAMPUS, CORS, e164, getCampus, json, requireStaff, sendSms, smsFromNumber, supabase } from '../_shared/gcc.ts';
import {
  generateSuggestedReply,
  generateVisitorInsight,
  generateWelcomeEmail,
  naturalLanguageSearch,
} from '../_shared/grace.ts';
import { manualEmail, welcomeEmail } from '../_shared/emails.ts';
import { sendEmail } from '../_shared/gcc.ts';

const HOW_HEARD_ALERT_LABELS: Record<string, string> = {
  friend: 'a friend',
  social_media: 'social media',
  google: 'Google',
  drove_by: 'driving by',
  other: 'word of mouth',
};

async function intake(body: Record<string, unknown>) {
  const campusSlug = String(body.campus || CAMPUS);
  const rawName = String(body.name || '').trim();
  if (!rawName) return json({ error: 'name required' }, 400);

  const phone = body.phone ? String(body.phone).trim() : null;
  const email = body.email ? String(body.email).trim() : null;
  const howHeard = body.how_heard ? String(body.how_heard) : null;
  const prayerRequest = body.prayer_request ? String(body.prayer_request) : null;
  const servicePreference = body.service_preference ? String(body.service_preference) : null;
  const skipNotifications = body.skip_notifications === true;

  const name = rawName.toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase());

  const campus = await getCampus(campusSlug);
  if (!campus) return json({ error: 'campus not found' }, 404);

  // Dedupe by email or phone
  const orClause = [email ? `email.eq.${email}` : null, phone ? `phone.eq.${phone}` : null]
    .filter(Boolean).join(',');
  const { data: existing } = orClause
    ? await supabase.from('church_visitors').select('id, is_returning').eq('campus_slug', campusSlug).or(orClause).maybeSingle()
    : { data: null };

  let visitorId: string;
  if (existing) {
    visitorId = existing.id;
    await supabase.from('church_visitors')
      .update({
        is_returning: true, phone, phone_e164: e164(phone), how_heard: howHeard, prayer_request: prayerRequest,
        service_preference: servicePreference, last_activity_at: new Date().toISOString(),
      })
      .eq('id', visitorId);
  } else {
    const { data: newVisitor, error } = await supabase.from('church_visitors')
      .insert({
        campus_slug: campusSlug, name, phone, phone_e164: e164(phone), email,
        how_heard: howHeard, prayer_request: prayerRequest,
        service_preference: servicePreference,
        is_returning: body.is_returning === true,
      })
      .select('id').single();
    if (error || !newVisitor) {
      console.error('[gcc-grace] intake insert failed', error);
      return json({ error: 'failed to save visitor' }, 500);
    }
    visitorId = newVisitor.id;
  }

  // Log attendance (skip for manual staff adds: no visit actually happened)
  if (!skipNotifications) {
    await supabase.from('church_visitor_attendance').insert({
      visitor_id: visitorId, campus_slug: campusSlug, service_type: servicePreference,
    });
  }

  // Welcome email (new visitors from the card only)
  if (!existing && !skipNotifications && email) {
    const aiBody = await generateWelcomeEmail({
      name, prayerRequest, howHeard, servicePreference,
      isReturning: false, churchName: campus.name,
    }).catch(() => null);
    const html = welcomeEmail(name, campus.name, campus.address || '', aiBody ?? undefined);
    const resendId = await sendEmail(email, `Welcome to ${campus.name}, ${name.split(' ')[0]}!`, html);
    await supabase.from('church_email_log').insert({
      visitor_id: visitorId, email_type: 'welcome_1', resend_email_id: resendId,
    });
    await supabase.from('church_visitors')
      .update({ email_1_sent_at: new Date().toISOString() }).eq('id', visitorId);
  }

  // Pastor SMS alert (new visitors from the card only)
  if (!existing && !skipNotifications && campus.pastor_phone) {
    const howLine = howHeard ? ` Found us through ${HOW_HEARD_ALERT_LABELS[howHeard] ?? howHeard}.` : '';
    const serviceLine = servicePreference
      ? ` Attended the ${servicePreference.charAt(0).toUpperCase() + servicePreference.slice(1)} service.` : '';
    const prayerLine = prayerRequest ? `\nPrayer request: "${prayerRequest}"` : '';
    await sendSms(campus.pastor_phone, `${name} just checked in for the first time.${howLine}${serviceLine}${prayerLine}`);
  }

  return json({ ok: true, visitor_id: visitorId, is_returning: !!existing });
}

// Builds the rich per-visitor profiles + kids-desk context Grace searches over.
async function buildSearchContext(campusSlug: string) {
  const { data: visitors } = await supabase.from('church_visitors').select('*').eq('campus_slug', campusSlug);
  if (!visitors) return null;
  const visitorIds = visitors.map((v) => v.id);

  const houseToday = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

  const [
    { data: emails }, { data: threads }, { data: allNotes }, { data: allAttendance },
    { data: families }, { data: checkins }, { data: classes }, { data: members },
    { data: serviceToday }, { data: roles }, { data: signups },
  ] = await Promise.all([
    supabase.from('church_email_log').select('*').in('visitor_id', visitorIds.length ? visitorIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('church_sms_threads').select('*').eq('campus_slug', campusSlug),
    supabase.from('church_visitor_notes').select('*').in('visitor_id', visitorIds.length ? visitorIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('church_visitor_attendance').select('*').in('visitor_id', visitorIds.length ? visitorIds : ['00000000-0000-0000-0000-000000000000']),
    supabase.from('church_families').select('id, name').eq('campus_slug', campusSlug),
    supabase.from('church_class_checkins').select('child_id, class_id, pickup_code').eq('campus_slug', campusSlug).is('checked_out_at', null),
    supabase.from('church_classes').select('id, name').eq('campus_slug', campusSlug),
    supabase.from('church_members').select('id, first_name, last_name, phone, email').eq('campus_slug', campusSlug),
    supabase.from('church_attendance').select('display_name, method').eq('campus_slug', campusSlug).eq('service_date', houseToday),
    supabase.from('church_volunteer_roles').select('title, description, slots, active').eq('campus_slug', campusSlug),
    supabase.from('church_volunteer_signups').select('role_title, display_name, contact, note').eq('campus_slug', campusSlug),
  ]);
  const kidMembers = members;

  const threadIds = (threads ?? []).map((t) => t.id);
  const { data: allSms } = threadIds.length > 0
    ? await supabase.from('church_sms_messages').select('*').in('thread_id', threadIds)
    : { data: [] };

  const profiles = visitors.map((v) => {
    const vEmails = (emails ?? []).filter((e) => e.visitor_id === v.id);
    const vNotes = (allNotes ?? []).filter((n) => n.visitor_id === v.id);
    const vAttendance = (allAttendance ?? []).filter((a) => a.visitor_id === v.id);
    const vThread = (threads ?? []).find((t) => t.visitor_id === v.id);
    const vSms = vThread ? (allSms ?? []).filter((s) => s.thread_id === vThread.id) : [];
    const calls = vNotes.filter((n) => n.tag === 'connected-with-pastor');

    return {
      id: v.id,
      name: v.name,
      email: v.email ?? null,
      phone: v.phone ?? null,
      is_returning: v.is_returning,
      service: v.service_preference ?? null,
      how_heard: v.how_heard ?? null,
      prayer_request: v.prayer_request ?? null,
      first_visit: v.created_at.split('T')[0],
      total_visits: vAttendance.length,
      last_visit: vAttendance.length > 0
        ? vAttendance.sort((a, b) => b.visited_at.localeCompare(a.visited_at))[0].visited_at.split('T')[0]
        : null,
      emails_sent: vEmails.map((e) => ({ type: e.email_type, sent: e.sent_at.split('T')[0], opened: !!e.opened_at })),
      sms: vSms.map((s) => ({ direction: s.direction, body: s.body, date: s.sent_at.split('T')[0] })),
      calls_logged: calls.length,
      notes: vNotes.filter((n) => n.tag !== 'connected-with-pastor')
        .map((n) => ({ body: n.body, tag: n.tag ?? null, date: n.created_at.split('T')[0] })),
    };
  });

  const memberName = (id: string) => {
    const m = (kidMembers ?? []).find((x) => x.id === id);
    return m ? `${m.first_name} ${m.last_name}`.trim() : null;
  };
  const kidsContext = {
    families: (families ?? []).map((f) => ({ id: f.id, name: f.name })),
    classes_in_session: (checkins ?? []).map((c) => ({
      child: memberName(c.child_id),
      class: (classes ?? []).find((x) => x.id === c.class_id)?.name,
      pickup_code: c.pickup_code,
    })),
  };

  const rosterContext = {
    type: 'church_roster',
    members_on_file: (members ?? []).map((m) => ({
      name: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim(),
      phone: m.phone ?? null,
      email: m.email ?? null,
    })),
    in_the_house_today: (serviceToday ?? []).map((a) => ({ name: a.display_name, method: a.method })),
    serve_team: {
      roles: (roles ?? []).map((r) => ({ role: r.title, description: r.description ?? null, slots: r.slots ?? null, active: r.active })),
      signups: (signups ?? []).map((s) => ({ role: s.role_title, person: s.display_name, contact: s.contact ?? null, note: s.note ?? null })),
    },
  };

  return [...profiles, { type: 'kids_desk', ...kidsContext }, rosterContext];
}

function visitorContextOf(v: Record<string, unknown>, churchName: string) {
  return {
    name: String(v.name),
    prayerRequest: (v.prayer_request as string) ?? null,
    howHeard: (v.how_heard as string) ?? null,
    servicePreference: (v.service_preference as string) ?? null,
    isReturning: v.is_returning === true,
    churchName,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || '');
  const campusSlug = String(body.campus || CAMPUS);

  try {
    if (action === 'intake') return await intake(body);

    const staff = await requireStaff(req);
    if (!staff) return json({ error: 'staff required' }, 401);

    const campus = await getCampus(campusSlug);
    if (!campus) return json({ error: 'campus not found' }, 404);

    if (action === 'nlsearch') {
      const query = String(body.query || '').trim();
      if (!query) return json({ error: 'query required' }, 400);
      const context = await buildSearchContext(campusSlug);
      if (!context) return json({ error: 'failed to load visitors' }, 500);
      const result = await naturalLanguageSearch(query, context);
      if (!result) return json({ error: 'search failed' }, 500);
      return json(result);
    }

    if (action === 'insight') {
      const visitorId = String(body.visitor_id || '');
      const [{ data: visitor }, { data: attendance }, { data: thread }] = await Promise.all([
        supabase.from('church_visitors').select('*').eq('id', visitorId).single(),
        supabase.from('church_visitor_attendance').select('id').eq('visitor_id', visitorId),
        supabase.from('church_sms_threads').select('id').eq('visitor_id', visitorId).maybeSingle(),
      ]);
      if (!visitor) return json({ error: 'not found' }, 404);

      let recentSmsContext: string | undefined;
      if (thread?.id) {
        const { data: msgs } = await supabase.from('church_sms_messages')
          .select('direction, body').eq('thread_id', thread.id)
          .order('sent_at', { ascending: false }).limit(4);
        if (msgs?.length) {
          recentSmsContext = msgs.reverse()
            .map((m) => `${m.direction === 'inbound' ? visitor.name.split(' ')[0] : 'Pastor Danny'}: ${m.body}`)
            .join(' | ');
        }
      }

      const insight = await generateVisitorInsight(
        { ...visitorContextOf(visitor, campus.name), visitCount: attendance?.length ?? 0 },
        recentSmsContext,
      );
      if (!insight) return json({ error: 'failed to generate insight' }, 500);
      return json({ insight });
    }

    if (action === 'suggest_reply') {
      const visitorId = String(body.visitor_id || '');
      const { data: visitor } = await supabase.from('church_visitors').select('*').eq('id', visitorId).single();
      if (!visitor) return json({ error: 'not found' }, 404);
      const channel = body.channel === 'email' ? 'email' : 'sms';
      const recent = Array.isArray(body.recent_messages) ? body.recent_messages : [];
      const suggestion = await generateSuggestedReply(
        visitorContextOf(visitor, campus.name),
        recent as Array<{ direction: 'inbound' | 'outbound'; body: string }>,
        channel,
      );
      if (!suggestion) return json({ error: 'failed to generate suggestion' }, 500);
      return json({ suggestion: suggestion.body, subject: suggestion.subject ?? null });
    }

    if (action === 'email_send') {
      const visitorId = String(body.visitor_id || '');
      const subject = String(body.subject || '').trim();
      const emailBody = String(body.body || '').trim();
      if (!subject || !emailBody) return json({ error: 'subject and body are required' }, 400);

      const { data: visitor } = await supabase.from('church_visitors')
        .select('email, name').eq('id', visitorId).single();
      if (!visitor?.email) return json({ error: 'visitor has no email' }, 400);

      const html = manualEmail(emailBody, campus.name, campus.address || '');
      const resendId = await sendEmail(visitor.email, subject, html);
      if (!resendId) return json({ error: 'email send failed' }, 502);

      const { data: log } = await supabase.from('church_email_log')
        .insert({
          visitor_id: visitorId, email_type: 'manual', subject, body: emailBody,
          direction: 'outbound', resend_email_id: resendId,
        })
        .select().single();
      return json(log);
    }

    if (action === 'sms_reply') {
      const threadId = String(body.thread_id || '');
      const text = String(body.body || '').trim();
      if (!text) return json({ error: 'message body required' }, 400);

      const { data: thread } = await supabase.from('church_sms_threads')
        .select('id, visitor_id').eq('id', threadId).single();
      if (!thread) return json({ error: 'thread not found' }, 404);

      const { data: visitor } = await supabase.from('church_visitors')
        .select('phone, opted_out').eq('id', thread.visitor_id).single();
      if (!visitor?.phone) return json({ error: 'no phone number on file' }, 400);
      if (visitor.opted_out) return json({ error: 'visitor has opted out of SMS' }, 400);

      const status = await sendSms(visitor.phone, text);
      if (status === 'sms_failed') return json({ error: 'sms send failed' }, 502);

      await supabase.from('church_sms_messages').insert({
        thread_id: threadId, direction: 'outbound', body: text,
        from_number: smsFromNumber(), to_number: visitor.phone,
      });
      return json({ ok: true, status });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (err) {
    console.error('[gcc-grace]', err);
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
