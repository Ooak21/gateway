// gcc-ops — Breeze-shaped church ops: families, Sunday kids check-in,
// volunteer desk, templates, automations, parent notices.
//
// POST { action, campus, ... }  Authorization: staff / kids JWT
// Desk roles: gcc_admin, gcc_staff, gcc_kids
// Write families/templates: gcc_admin, gcc_staff
//
// Deploy: supabase functions deploy gcc-ops --no-verify-jwt
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GCC_SMS_ENABLED,
// SENDBLUE_* or GCC_TELNYX_* (same as gcc-geo-ping).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const CAMPUS = 'lasvegas';
const DESK = ['gcc_admin', 'gcc_staff', 'gcc_kids'];
const STAFF = ['gcc_admin', 'gcc_staff'];

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

function todayLA() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

function ageYears(birthdate: string | null) {
  if (!birthdate) return null;
  const b = new Date(birthdate + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
  return a;
}

function pickupCode() {
  return String(1000 + Math.floor(Math.random() * 9000));
}

function renderTpl(body: string, vars: Record<string, string>) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

function e164(phone: string | null) {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return phone.startsWith('+') ? phone : null;
}

async function sendSms(to: string, text: string) {
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
    console.error('[gcc-ops] sms failed', res.status, await res.text());
    return 'sms_failed';
  }
  return 'sms_sent';
}

async function requireRole(req: Request, allowed: string[]) {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  const role = data.user?.app_metadata?.gcc_role || data.user?.app_metadata?.role;
  if (!role || !allowed.includes(role)) return null;
  return { user: data.user, role };
}

function campusOf(body: Record<string, unknown>) {
  return body.campus === CAMPUS ? CAMPUS : '';
}

async function familyBundle(familyId: string) {
  const { data: fam } = await supabase.from('church_families').select('*').eq('id', familyId).maybeSingle();
  if (!fam) return null;
  const { data: links } = await supabase
    .from('church_family_members')
    .select('role, member_id')
    .eq('family_id', familyId);
  const ids = (links || []).map((l) => l.member_id);
  let people: Record<string, unknown>[] = [];
  if (ids.length) {
    const { data } = await supabase
      .from('church_members')
      .select('id, first_name, last_name, phone, phone_e164, email, birthdate, sms_opt_in')
      .in('id', ids);
    people = data || [];
  }
  const members = (links || []).map((l) => {
    const p = people.find((x) => x.id === l.member_id) || { id: l.member_id };
    return { ...p, role: l.role, age: ageYears((p as { birthdate?: string }).birthdate || null) };
  });
  return { ...fam, members };
}

async function fireNotice(opts: {
  campus: string;
  trigger: string;
  child?: Record<string, unknown>;
  parent?: Record<string, unknown>;
  vars: Record<string, string>;
}) {
  const { data: autos } = await supabase
    .from('church_automations')
    .select('id, template_slug, enabled')
    .eq('campus_slug', opts.campus)
    .eq('trigger', opts.trigger)
    .eq('enabled', true);
  const notices = [];
  for (const auto of autos || []) {
    const { data: tpl } = await supabase
      .from('church_templates')
      .select('slug, channel, body, active')
      .eq('campus_slug', opts.campus)
      .eq('slug', auto.template_slug)
      .maybeSingle();
    if (!tpl || tpl.active === false) continue;
    const body = renderTpl(tpl.body, opts.vars);
    const parent = opts.parent || {};
    const to = e164((parent.phone_e164 as string) || (parent.phone as string) || null);
    let status = 'queued';
    if (tpl.channel === 'sms' && to && parent.sms_opt_in !== false) {
      const sent = await sendSms(to, body);
      status = sent === 'sms_sent' ? 'sent' : sent === 'sms_disabled' ? 'queued' : 'failed';
    } else if (tpl.channel === 'sms' && !to) {
      status = 'queued';
    } else {
      status = 'queued';
    }
    const row = {
      campus_slug: opts.campus,
      member_id: (parent.id as string) || null,
      child_id: (opts.child?.id as string) || null,
      template_slug: tpl.slug,
      channel: tpl.channel,
      to_phone: to,
      body,
      status,
    };
    const { data: saved } = await supabase.from('church_notices').insert(row).select('*').single();
    notices.push(saved || row);
  }
  return notices;
}

async function bootstrap(campus: string) {
  const [families, classes, checkins, templates, automations, notices] = await Promise.all([
    supabase.from('church_families').select('*').eq('campus_slug', campus).order('name'),
    supabase.from('church_classes').select('*').eq('campus_slug', campus).eq('active', true).order('min_age'),
    supabase.from('church_class_checkins').select('*').eq('campus_slug', campus).eq('service_date', todayLA()),
    supabase.from('church_templates').select('*').eq('campus_slug', campus).order('name'),
    supabase.from('church_automations').select('*').eq('campus_slug', campus).order('name'),
    supabase.from('church_notices').select('*').eq('campus_slug', campus).order('created_at', { ascending: false }).limit(50),
  ]);
  const famRows = families.data || [];
  const bundles = [];
  for (const f of famRows) bundles.push(await familyBundle(f.id));
  const childIds = (checkins.data || []).map((c) => c.child_id);
  let kids: Record<string, unknown>[] = [];
  if (childIds.length) {
    const { data } = await supabase
      .from('church_members')
      .select('id, first_name, last_name, birthdate')
      .in('id', childIds);
    kids = data || [];
  }
  const roster = (checkins.data || []).map((c) => {
    const kid = kids.find((k) => k.id === c.child_id) || {};
    const cls = (classes.data || []).find((x) => x.id === c.class_id) || {};
    return {
      ...c,
      child_name: `${kid.first_name || ''} ${kid.last_name || ''}`.trim(),
      class_name: cls.name || '',
      room: cls.room || '',
    };
  });
  return {
    families: bundles.filter(Boolean),
    classes: classes.data || [],
    roster,
    templates: templates.data || [],
    automations: automations.data || [],
    notices: notices.data || [],
    today: todayLA(),
  };
}

function hay(obj: unknown) {
  return JSON.stringify(obj).toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || '');
  const campus = campusOf(body);
  if (!campus && action !== 'search') return json({ error: 'campus required' }, 400);

  const desk = await requireRole(req, DESK);
  if (!desk) return json({ error: 'staff required' }, 401);
  const staffOk = STAFF.includes(desk.role);

  try {
    if (action === 'bootstrap') return json({ ok: true, role: desk.role, ...(await bootstrap(campus)) });

    if (action === 'family_create') {
      if (!staffOk) return json({ error: 'staff only' }, 403);
      const name = String(body.name || '').trim();
      if (!name) return json({ error: 'name required' }, 400);
      const { data: fam, error } = await supabase
        .from('church_families')
        .insert({ campus_slug: campus, name, notes: body.notes || null })
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 400);
      const members = Array.isArray(body.members) ? body.members as Record<string, unknown>[] : [];
      for (const m of members) {
        let memberId = String(m.member_id || '');
        if (!memberId) {
          const row = {
            campus_slug: campus,
            first_name: String(m.first_name || '').trim(),
            last_name: String(m.last_name || '').trim(),
            phone: m.phone || null,
            email: m.email || null,
            birthdate: m.birthdate || null,
            source: 'staff',
          };
          if (!row.first_name) continue;
          const { data: person } = await supabase.from('church_members').insert(row).select('id').single();
          memberId = person?.id;
        }
        if (!memberId) continue;
        await supabase.from('church_family_members').upsert({
          family_id: fam.id,
          member_id: memberId,
          role: ['head', 'spouse', 'adult', 'child', 'unassigned'].includes(String(m.role)) ? m.role : 'unassigned',
        });
      }
      return json({ ok: true, family: await familyBundle(fam.id) });
    }

    if (action === 'family_add') {
      if (!staffOk) return json({ error: 'staff only' }, 403);
      const familyId = String(body.family_id || '');
      let memberId = String(body.member_id || '');
      if (!familyId) return json({ error: 'family_id required' }, 400);
      if (!memberId) {
        const row = {
          campus_slug: campus,
          first_name: String(body.first_name || '').trim(),
          last_name: String(body.last_name || '').trim(),
          phone: body.phone || null,
          birthdate: body.birthdate || null,
          source: 'staff',
        };
        if (!row.first_name) return json({ error: 'first_name required' }, 400);
        const { data: person, error } = await supabase.from('church_members').insert(row).select('id').single();
        if (error) return json({ error: error.message }, 400);
        memberId = person.id;
      }
      await supabase.from('church_family_members').upsert({
        family_id: familyId,
        member_id: memberId,
        role: String(body.role || 'child'),
      });
      return json({ ok: true, family: await familyBundle(familyId) });
    }

    if (action === 'family_remove') {
      if (!staffOk) return json({ error: 'staff only' }, 403);
      await supabase.from('church_family_members')
        .delete()
        .eq('family_id', body.family_id)
        .eq('member_id', body.member_id);
      return json({ ok: true, family: await familyBundle(String(body.family_id)) });
    }

    if (action === 'checkin') {
      const childId = String(body.child_id || '');
      const classId = String(body.class_id || '');
      if (!childId || !classId) return json({ error: 'child_id and class_id required' }, 400);
      const { data: child } = await supabase
        .from('church_members')
        .select('id, first_name, last_name, birthdate')
        .eq('id', childId)
        .maybeSingle();
      if (!child) return json({ error: 'child not found' }, 404);
      const { data: cls } = await supabase.from('church_classes').select('*').eq('id', classId).maybeSingle();
      if (!cls) return json({ error: 'class not found' }, 404);
      const { data: link } = await supabase
        .from('church_family_members')
        .select('family_id, role')
        .eq('member_id', childId)
        .maybeSingle();
      const { data: open } = await supabase
        .from('church_class_checkins')
        .select('id')
        .eq('child_id', childId)
        .eq('service_date', todayLA())
        .is('checked_out_at', null)
        .maybeSingle();
      if (open) return json({ error: 'already checked in', checkin_id: open.id }, 409);

      const code = pickupCode();
      const { data: row, error } = await supabase
        .from('church_class_checkins')
        .insert({
          campus_slug: campus,
          class_id: classId,
          child_id: childId,
          family_id: link?.family_id || null,
          pickup_code: code,
          checked_in_by_name: String(body.volunteer_name || desk.user.email || 'desk'),
          checked_in_by_role: desk.role,
        })
        .select('*')
        .single();
      if (error) return json({ error: error.message }, 400);

      let parent: Record<string, unknown> | undefined;
      if (link?.family_id) {
        const fam = await familyBundle(link.family_id);
        parent = (fam?.members || []).find((m: Record<string, unknown>) =>
          m.role === 'head' || m.role === 'spouse' || m.role === 'adult'
        ) as Record<string, unknown> | undefined;
      }

      const notices = await fireNotice({
        campus,
        trigger: 'kid_checked_in',
        child,
        parent,
        vars: {
          child_first: child.first_name,
          child_name: `${child.first_name} ${child.last_name || ''}`.trim(),
          class_name: cls.name,
          room: cls.room || '',
          pickup_code: code,
          parent_first: String(parent?.first_name || 'parent'),
          first_name: String(parent?.first_name || ''),
        },
      });

      if (notices.some((n) => n && n.status === 'sent')) {
        await supabase.from('church_class_checkins')
          .update({ parent_notified_at: new Date().toISOString() })
          .eq('id', row.id);
      }

      return json({
        ok: true,
        checkin: { ...row, child_name: `${child.first_name} ${child.last_name || ''}`.trim(), class_name: cls.name, room: cls.room },
        notices,
      });
    }

    if (action === 'checkout') {
      const id = String(body.checkin_id || '');
      const { data: row } = await supabase.from('church_class_checkins').select('*').eq('id', id).maybeSingle();
      if (!row) return json({ error: 'not found' }, 404);
      await supabase.from('church_class_checkins')
        .update({ checked_out_at: new Date().toISOString() })
        .eq('id', id);
      const { data: child } = await supabase
        .from('church_members')
        .select('id, first_name, last_name')
        .eq('id', row.child_id)
        .maybeSingle();
      const { data: cls } = await supabase.from('church_classes').select('name, room').eq('id', row.class_id).maybeSingle();
      let parent: Record<string, unknown> | undefined;
      if (row.family_id) {
        const fam = await familyBundle(row.family_id);
        parent = (fam?.members || []).find((m: Record<string, unknown>) =>
          m.role === 'head' || m.role === 'spouse' || m.role === 'adult'
        ) as Record<string, unknown> | undefined;
      }
      const notices = await fireNotice({
        campus,
        trigger: 'kid_checked_out',
        child: child || undefined,
        parent,
        vars: {
          child_first: child?.first_name || '',
          class_name: cls?.name || '',
          room: cls?.room || '',
          pickup_code: row.pickup_code,
          parent_first: String(parent?.first_name || ''),
        },
      });
      return json({ ok: true, notices });
    }

    if (action === 'template_save') {
      if (!staffOk) return json({ error: 'staff only' }, 403);
      const slug = String(body.slug || '').trim();
      const { error } = await supabase.from('church_templates').upsert({
        campus_slug: campus,
        slug,
        name: String(body.name || slug),
        channel: body.channel === 'email' || body.channel === 'voice' ? body.channel : 'sms',
        body: String(body.body || ''),
        active: body.active !== false,
      }, { onConflict: 'campus_slug,slug' });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === 'automation_save') {
      if (!staffOk) return json({ error: 'staff only' }, 403);
      const id = String(body.id || '');
      if (!id) return json({ error: 'id required' }, 400);
      const patch: Record<string, unknown> = {};
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
      if (body.template_slug) patch.template_slug = body.template_slug;
      if (body.name) patch.name = body.name;
      await supabase.from('church_automations').update(patch).eq('id', id);
      return json({ ok: true });
    }

    if (action === 'search') {
      const q = String(body.query || '').trim().toLowerCase();
      const snap = await bootstrap(campus || CAMPUS);
      const hits = {
        families: snap.families.filter((f) => hay(f).includes(q)),
        roster: snap.roster.filter((r) => hay(r).includes(q) && !r.checked_out_at),
        classes: snap.classes.filter((c) => hay(c).includes(q)),
      };
      if (!q) {
        const inClass = snap.roster.filter((r) => !r.checked_out_at);
        const spoken = inClass.length
          ? `${inClass.length} kids are checked in right now. ` +
            inClass.slice(0, 8).map((r) => `${r.child_name} in ${r.class_name}`).join('. ')
          : 'No kids are checked in yet today.';
        return json({ ok: true, spoken, ...hits, roster: inClass });
      }
      const parts = [];
      if (/check.?in|here|roster|class/.test(q)) {
        const open = snap.roster.filter((r) => !r.checked_out_at);
        parts.push(open.length ? `${open.length} checked in: ` + open.map((r) => `${r.child_name} in ${r.class_name}, code ${r.pickup_code}`).join('; ') : 'Nobody is checked into a class yet.');
      }
      if (hits.families.length) {
        parts.push(hits.families.slice(0, 4).map((f) => {
          const kids = (f.members || []).filter((m: Record<string, unknown>) => m.role === 'child');
          const adults = (f.members || []).filter((m: Record<string, unknown>) => m.role !== 'child');
          return `${f.name}: ${adults.map((a: Record<string, unknown>) => a.first_name).join(', ')}` +
            (kids.length ? `, kids ${kids.map((k: Record<string, unknown>) => k.first_name).join(', ')}` : '');
        }).join('. '));
      }
      const spoken = parts.join(' ') || (hits.roster.length
        ? hits.roster.map((r) => `${r.child_name} is in ${r.class_name}. Pickup ${r.pickup_code}.`).join(' ')
        : 'I did not find a matching family or class. Try a last name or a class name.');
      return json({ ok: true, spoken, ...hits });
    }

    return json({ error: 'unknown action' }, 400);
  } catch (err) {
    console.error('[gcc-ops]', err);
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
