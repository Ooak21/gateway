// Data layer. DEMO_MODE keeps everything in localStorage so the whole app
// works from a laptop with zero backend. Live mode talks straight to
// Supabase PostgREST with the public anon key; RLS does the enforcement
// (anon can insert intake rows and read published events, nothing else).
// Every write carries campus_slug so the schema stays multi-campus clean.
(function () {
  const C = window.GCC;
  const DB_KEY = 'gcc-db-v1';

  // ---------- demo store ----------
  function load() {
    try { return JSON.parse(localStorage.getItem(DB_KEY)) || seed(); }
    catch { return seed(); }
  }
  function save(db) { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  function seed() {
    const now = new Date();
    const d = (days, h, m) => {
      const x = new Date(now); x.setDate(x.getDate() + days); x.setHours(h, m, 0, 0); return x.toISOString();
    };
    const db = {
      members: [], attendance: [], geofence_events: [], prayer_requests: [],
      pastor_messages: [], volunteer_signups: [],
      events: [
        { id: 'e1', title: 'Sunday Service (English)', starts_at: d(((7 - now.getDay()) % 7) || 7, 10, 0), location: 'Main Sanctuary', category: 'Service', description: 'Worship and the Word. Kids ministry available.' },
        { id: 'e2', title: 'Servicio Dominical (Español)', starts_at: d(((7 - now.getDay()) % 7) || 7, 13, 0), location: 'Main Sanctuary', category: 'Service', description: 'Adoración y la Palabra.' },
        { id: 'e3', title: 'Midweek Service', starts_at: d((3 - now.getDay() + 7) % 7 || 7, 19, 0), location: 'Main Sanctuary', category: 'Service', description: 'Prayer and teaching night.' },
        { id: 'e4', title: 'Community Food Drive', starts_at: d(9, 9, 0), location: 'Parking Lot', category: 'Outreach', description: 'Serving families in the North Rancho neighborhood. All hands welcome.' },
        { id: 'e5', title: 'Grow Track: Getting Connected', starts_at: d(14, 11, 45), location: 'Room 112', category: 'Grow Tracks', description: 'First step on the discipleship path. Lunch provided.' }
      ],
      volunteer_roles: [
        { id: 'v1', title: 'Greeter Team', description: 'First face people see on Sunday. Arrive 30 minutes early.', slots: 4 },
        { id: 'v2', title: 'Kids Ministry Helper', description: 'Assist during the 10 AM service. Background check required.', slots: 3 },
        { id: 'v3', title: 'Worship / Media Team', description: 'Slides, sound, or stream. Training provided.', slots: 2 },
        { id: 'v4', title: 'Food Drive Crew', description: 'Load, sort, and hand out boxes at the Community Food Drive.', slots: 10 }
      ]
    };
    save(db); return db;
  }

  // ---------- live (PostgREST) ----------
  async function rest(path, opts = {}) {
    // Inserts default to return=minimal: anon can write intake rows but has
    // no SELECT policy, and return=representation would need one (PostgREST
    // reports that as an RLS violation). Ids are generated client-side.
    const headers = {
      apikey: C.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + C.SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    };
    if (opts.method === 'POST' && !headers.Prefer) headers.Prefer = 'return=minimal';
    const res = await fetch(C.SUPABASE_URL + '/rest/v1/' + path, { ...opts, headers });
    if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const nowIso = () => new Date().toISOString();
  const uid = () => Math.random().toString(36).slice(2, 10);
  // crypto.randomUUID only exists in secure contexts (https/localhost); the
  // members.id column is a real uuid, so the fallback must be a valid v4.
  function uuid4() {
    const b = new Uint8Array(16);
    if (crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return h.slice(0,4).join('') + '-' + h.slice(4,6).join('') + '-' + h.slice(6,8).join('') +
      '-' + h.slice(8,10).join('') + '-' + h.slice(10).join('');
  }

  const api = {
    // Local device identity (who this phone belongs to)
    getMe() { try { return JSON.parse(localStorage.getItem('gcc-me')); } catch { return null; } },
    setMe(me) { localStorage.setItem('gcc-me', JSON.stringify(me)); },

    async saveMember(m) {
      // id + geo_token are generated client-side: anon can insert but never
      // select, so the server can't hand ids back. geo_token is the member's
      // personal code for the autonomous-welcome Shortcut pings.
      const id = (crypto.randomUUID) ? crypto.randomUUID() : uuid4();
      const geo_token = Math.random().toString(36).slice(2, 8).toUpperCase();
      const row = { id, geo_token, campus_slug: C.CAMPUS.slug, first_name: m.first_name, last_name: m.last_name || '',
        phone: m.phone || null, email: m.email || null, sms_opt_in: !!m.sms_opt_in, source: m.source || 'app' };
      if (C.DEMO_MODE) {
        const db = load(); const rec = { created_at: nowIso(), ...row };
        db.members.push(rec); save(db); return rec;
      }
      await rest('church_members', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      return row;
    },

    async checkIn({ member_id, name, method, distance, accuracy }) {
      const row = { campus_slug: C.CAMPUS.slug, member_id: member_id || null, display_name: name || 'Guest',
        service_date: new Date().toISOString().slice(0, 10), method };
      const geo = { campus_slug: C.CAMPUS.slug, member_id: member_id || null, display_name: name || 'Guest',
        event: 'enter', distance_m: distance ?? null, accuracy_m: accuracy ?? null };
      if (C.DEMO_MODE) {
        const db = load();
        db.attendance.push({ id: uid(), created_at: nowIso(), ...row });
        db.geofence_events.push({ id: uid(), created_at: nowIso(), ...geo });
        save(db); return true;
      }
      await rest('church_attendance', { method: 'POST', body: JSON.stringify(row) });
      await rest('church_geofence_events', { method: 'POST', body: JSON.stringify(geo) });
      return true;
    },

    async logGeofence(event, { member_id, name, distance, accuracy }) {
      const row = { campus_slug: C.CAMPUS.slug, member_id: member_id || null, display_name: name || 'Guest',
        event, distance_m: distance ?? null, accuracy_m: accuracy ?? null };
      if (C.DEMO_MODE) {
        const db = load(); db.geofence_events.push({ id: uid(), created_at: nowIso(), ...row }); save(db); return true;
      }
      await rest('church_geofence_events', { method: 'POST', body: JSON.stringify(row) });
      return true;
    },

    async listEvents() {
      if (C.DEMO_MODE) return load().events.sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      return rest('church_events?is_published=eq.true&starts_at=gte.' + nowIso() + '&order=starts_at.asc&select=*');
    },

    async listVolunteerRoles() {
      if (C.DEMO_MODE) return load().volunteer_roles;
      return rest('church_volunteer_roles?active=eq.true&order=created_at.asc&select=*');
    },

    async volunteerSignup({ role_id, role_title, member_id, name, contact, note }) {
      const row = { campus_slug: C.CAMPUS.slug, role_id: role_id || null, role_title, member_id: member_id || null,
        display_name: name, contact: contact || null, note: note || null };
      if (C.DEMO_MODE) { const db = load(); db.volunteer_signups.push({ id: uid(), created_at: nowIso(), ...row }); save(db); return true; }
      await rest('church_volunteer_signups', { method: 'POST', body: JSON.stringify(row) });
      return true;
    },

    async submitPrayer({ member_id, name, contact, request, is_private }) {
      const row = { campus_slug: C.CAMPUS.slug, member_id: member_id || null, display_name: name || 'Anonymous',
        contact: contact || null, request, is_private: !!is_private };
      if (C.DEMO_MODE) { const db = load(); db.prayer_requests.push({ id: uid(), created_at: nowIso(), status: 'new', ...row }); save(db); return true; }
      await rest('church_prayer_requests', { method: 'POST', body: JSON.stringify(row) });
      return true;
    },

    async messagePastor({ member_id, pastor, name, contact, message }) {
      const row = { campus_slug: C.CAMPUS.slug, member_id: member_id || null, pastor, display_name: name,
        contact: contact || null, message };
      if (C.DEMO_MODE) { const db = load(); db.pastor_messages.push({ id: uid(), created_at: nowIso(), status: 'new', ...row }); save(db); return true; }
      await rest('church_pastor_messages', { method: 'POST', body: JSON.stringify(row) });
      return true;
    },

    async todayCheckinCount() {
      const today = new Date().toISOString().slice(0, 10);
      if (C.DEMO_MODE) return load().attendance.filter(a => a.service_date === today).length;
      const rows = await rest('rpc/church_checkin_count', {
        method: 'POST', body: JSON.stringify({ p_campus_slug: C.CAMPUS.slug, p_date: today })
      });
      return typeof rows === 'number' ? rows : rows;
    },

    // Staff board reads. Demo: localStorage. Live: requires a staff JWT, so
    // staff.html passes the session token in via authHeaders.
    async staffFeeds(authHeaders) {
      if (C.DEMO_MODE) {
        const db = load();
        return {
          members: db.members.slice().reverse(),
          attendance: db.attendance.slice().reverse(),
          geofence: db.geofence_events.slice().reverse(),
          prayers: db.prayer_requests.slice().reverse(),
          messages: db.pastor_messages.slice().reverse(),
          volunteers: db.volunteer_signups.slice().reverse()
        };
      }
      const h = { headers: authHeaders };
      const q = (t) => rest(t + '?campus_slug=eq.' + C.CAMPUS.slug + '&order=created_at.desc&limit=200&select=*', h);
      const [members, attendance, geofence, prayers, messages, volunteers] = await Promise.all([
        q('church_members'), q('church_attendance'), q('church_geofence_events'),
        q('church_prayer_requests'), q('church_pastor_messages'), q('church_volunteer_signups')
      ]);
      return { members, attendance, geofence, prayers, messages, volunteers };
    }
  };

  window.GCCData = api;
})();
