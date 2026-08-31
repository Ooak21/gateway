// Visitor CRM client (Grace). Preview lives in localStorage so the file works
// before login/deploy; live mode reads PostgREST under the staff RLS policies
// and calls gcc-grace for everything that needs providers (Claude, Resend, SMS).
(function () {
  const C = window.GCC;
  const KEY = 'gcc-visitors-v1';
  const CAMPUS = 'lasvegas';
  const FN = C.SUPABASE_URL + '/functions/v1/gcc-grace';

  let preview = false;
  let token = null;

  function nowIso() { return new Date().toISOString(); }
  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
      '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }

  function seed() {
    const t = nowIso();
    const v1 = uid(), v2 = uid(), th = uid();
    const db = {
      visitors: [
        { id: v1, campus_slug: CAMPUS, name: 'Dana Whitfield', phone: '(702) 555-0161', email: 'dana.w@mail.com', how_heard: 'friend', prayer_request: 'Peace for my mom while she recovers from surgery.', service_preference: 'english', is_returning: false, email_1_sent_at: t, opted_out: false, created_at: t, last_activity_at: t },
        { id: v2, campus_slug: CAMPUS, name: 'Marco Reyes', phone: '(725) 555-0183', email: null, how_heard: 'drove_by', prayer_request: null, service_preference: 'spanish', is_returning: true, email_1_sent_at: null, opted_out: false, created_at: t, last_activity_at: t }
      ],
      attendance: [
        { id: uid(), visitor_id: v1, campus_slug: CAMPUS, service_type: 'english', visited_at: t },
        { id: uid(), visitor_id: v2, campus_slug: CAMPUS, service_type: 'spanish', visited_at: t }
      ],
      notes: [
        { id: uid(), visitor_id: v1, body: 'Asked about the Getting Connected track.', tag: 'needs-follow-up', created_at: t }
      ],
      emails: [
        { id: uid(), visitor_id: v1, email_type: 'welcome_1', subject: null, body: null, direction: 'outbound', sent_at: t, opened_at: t, resend_email_id: null }
      ],
      threads: [{ id: th, visitor_id: v1, campus_slug: CAMPUS, created_at: t }],
      messages: [
        { id: uid(), thread_id: th, direction: 'inbound', body: 'Thank you for the welcome! Sunday meant a lot.', from_number: '(702) 555-0161', to_number: null, sent_at: t }
      ]
    };
    localStorage.setItem(KEY, JSON.stringify(db));
    return db;
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || seed(); }
    catch { return seed(); }
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }

  async function rest(path, opts = {}) {
    const headers = {
      apikey: C.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + (token || C.SUPABASE_ANON_KEY),
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    };
    const res = await fetch(C.SUPABASE_URL + '/rest/v1/' + path, { ...opts, headers });
    if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async function fn(payload) {
    const res = await fetch(FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: C.SUPABASE_ANON_KEY,
        Authorization: 'Bearer ' + (token || C.SUPABASE_ANON_KEY)
      },
      body: JSON.stringify({ campus: CAMPUS, ...payload })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'gcc-grace ' + res.status);
    return data;
  }

  let cache = { visitors: [], attendance: [], notes: [], emails: [], threads: [], messages: [] };

  const api = {
    usePreview(on) { preview = !!on; },
    setAuth(t) { token = t; },
    data() { return cache; },

    async loadAll() {
      if (preview || C.DEMO_MODE) { cache = load(); return cache; }
      const [visitors, attendance, notes, emails, threads, messages] = await Promise.all([
        rest('church_visitors?campus_slug=eq.' + CAMPUS + '&order=last_activity_at.desc&limit=500&select=*'),
        rest('church_visitor_attendance?campus_slug=eq.' + CAMPUS + '&order=visited_at.desc&limit=1000&select=*'),
        rest('church_visitor_notes?order=created_at.desc&limit=1000&select=*'),
        rest('church_email_log?order=sent_at.desc&limit=1000&select=*'),
        rest('church_sms_threads?campus_slug=eq.' + CAMPUS + '&select=*'),
        rest('church_sms_messages?order=sent_at.asc&limit=2000&select=*')
      ]);
      cache = { visitors, attendance, notes, emails, threads, messages };
      return cache;
    },

    forVisitor(id) {
      const thread = cache.threads.find((t) => t.visitor_id === id) || null;
      return {
        attendance: cache.attendance.filter((a) => a.visitor_id === id),
        notes: cache.notes.filter((n) => n.visitor_id === id),
        emails: cache.emails.filter((e) => e.visitor_id === id),
        thread,
        messages: thread ? cache.messages.filter((m) => m.thread_id === thread.id) : []
      };
    },

    async addVisitor(fields) {
      if (preview || C.DEMO_MODE) {
        const db = load();
        db.visitors.unshift({ id: uid(), campus_slug: CAMPUS, opted_out: false, is_returning: false, created_at: nowIso(), last_activity_at: nowIso(), ...fields });
        save(db); cache = db; return true;
      }
      await fn({ action: 'intake', skip_notifications: true, ...fields });
      return true;
    },

    async addNote(visitorId, body, tag) {
      if (preview || C.DEMO_MODE) {
        const db = load();
        db.notes.unshift({ id: uid(), visitor_id: visitorId, body, tag: tag || null, created_at: nowIso() });
        save(db); cache = db; return true;
      }
      await rest('church_visitor_notes', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ visitor_id: visitorId, body, tag: tag || null }) });
      return true;
    },

    async logVisit(visitorId, serviceType) {
      if (preview || C.DEMO_MODE) {
        const db = load();
        db.attendance.unshift({ id: uid(), visitor_id: visitorId, campus_slug: CAMPUS, service_type: serviceType || null, visited_at: nowIso() });
        const v = db.visitors.find((x) => x.id === visitorId);
        if (v) v.is_returning = true;
        save(db); cache = db; return true;
      }
      await rest('church_visitor_attendance', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ visitor_id: visitorId, campus_slug: CAMPUS, service_type: serviceType || null }) });
      await rest('church_visitors?id=eq.' + visitorId, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ is_returning: true }) });
      return true;
    },

    async removeVisitor(visitorId) {
      if (preview || C.DEMO_MODE) {
        const db = load();
        db.visitors = db.visitors.filter((v) => v.id !== visitorId);
        save(db); cache = db; return true;
      }
      await rest('church_visitors?id=eq.' + visitorId, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      return true;
    },

    async insight(visitorId) {
      if (preview || C.DEMO_MODE) return { insight: 'Preview mode. Live insight comes from Grace once you are signed in.' };
      return fn({ action: 'insight', visitor_id: visitorId });
    },

    async suggestReply(visitorId, channel, recentMessages) {
      if (preview || C.DEMO_MODE) return { suggestion: 'Preview mode. Grace drafts real replies once you are signed in.', subject: 'Checking in' };
      return fn({ action: 'suggest_reply', visitor_id: visitorId, channel, recent_messages: recentMessages || [] });
    },

    async sendVisitorEmail(visitorId, subject, body) {
      if (preview || C.DEMO_MODE) {
        const db = load();
        db.emails.unshift({ id: uid(), visitor_id: visitorId, email_type: 'manual', subject, body, direction: 'outbound', sent_at: nowIso(), opened_at: null });
        save(db); cache = db; return true;
      }
      await fn({ action: 'email_send', visitor_id: visitorId, subject, body });
      return true;
    },

    async sendSmsReply(visitorId, body) {
      if (preview || C.DEMO_MODE) {
        const db = load();
        let thread = db.threads.find((t) => t.visitor_id === visitorId);
        if (!thread) { thread = { id: uid(), visitor_id: visitorId, campus_slug: CAMPUS, created_at: nowIso() }; db.threads.push(thread); }
        db.messages.push({ id: uid(), thread_id: thread.id, direction: 'outbound', body, sent_at: nowIso() });
        save(db); cache = db; return true;
      }
      let thread = cache.threads.find((t) => t.visitor_id === visitorId);
      if (!thread) {
        const rows = await rest('church_sms_threads', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ visitor_id: visitorId, campus_slug: CAMPUS }) });
        thread = rows && rows[0];
        if (thread) cache.threads.push(thread);
      }
      if (!thread) throw new Error('no thread');
      await fn({ action: 'sms_reply', thread_id: thread.id, body });
      return true;
    },

    async nlsearch(query) {
      if (preview || C.DEMO_MODE) return null;
      return fn({ action: 'nlsearch', query });
    }
  };

  window.GCCVisitors = api;
})();
