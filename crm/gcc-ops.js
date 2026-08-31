// Families, kids classes, templates, automations. Preview lives in
// localStorage so the desk works before gcc-ops is deployed.
(function () {
  const C = window.GCC;
  const KEY = 'gcc-ops-v1';
  const CAMPUS = 'lasvegas';

  function uid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
    return h.slice(0, 4).join('') + '-' + h.slice(4, 6).join('') + '-' + h.slice(6, 8).join('') +
      '-' + h.slice(8, 10).join('') + '-' + h.slice(10).join('');
  }
  function today() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  }
  function ageYears(birthdate) {
    if (!birthdate) return null;
    const b = new Date(birthdate + 'T00:00:00');
    const now = new Date();
    let a = now.getFullYear() - b.getFullYear();
    const m = now.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < b.getDate())) a--;
    return a;
  }
  function pickup() { return String(1000 + Math.floor(Math.random() * 9000)); }
  function tpl(body, vars) { return body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ''); }

  function seed() {
    const t = new Date().toISOString();
    const maria = { id: '1', first_name: 'Maria', last_name: 'Solis', phone: '(702) 555-0144', email: 'maria.solis@mail.com', sms_opt_in: true, role: 'head' };
    const diego = { id: 'c1', first_name: 'Diego', last_name: 'Solis', birthdate: '2018-04-12', role: 'child' };
    const sofia = { id: 'c2', first_name: 'Sofia', last_name: 'Solis', birthdate: '2021-09-03', role: 'child' };
    const james = { id: '2', first_name: 'James', last_name: 'Okonkwo', phone: '(702) 555-0190', email: 'james@okonkwo.mail', sms_opt_in: true, role: 'head' };
    const amara = { id: 'c3', first_name: 'Amara', last_name: 'Okonkwo', birthdate: '2016-01-22', role: 'child' };
    const elena = { id: '3', first_name: 'Elena', last_name: 'Ruiz', phone: '(725) 555-0112', role: 'head' };
    const chris = { id: '4', first_name: 'Chris', last_name: 'Nguyen', phone: '(702) 555-0177', email: 'chris.n@nv.dev', role: 'adult' };
    const classes = [
      { id: 'cl1', name: 'Nursery', room: 'Room 1', min_age: 0, max_age: 2 },
      { id: 'cl2', name: 'Preschool', room: 'Room 2', min_age: 3, max_age: 5 },
      { id: 'cl3', name: 'Elementary', room: 'Room 3', min_age: 6, max_age: 11 },
      { id: 'cl4', name: 'Youth', room: 'Room 4', min_age: 12, max_age: 17 }
    ];
    const templates = [
      { id: 't1', slug: 'kid_checked_in', name: 'Kid checked in', channel: 'sms', active: true,
        body: '{{child_first}} is checked into {{class_name}} ({{room}}). Pickup code {{pickup_code}}. GateWay Kids.' },
      { id: 't2', slug: 'kid_checked_out', name: 'Kid picked up', channel: 'sms', active: true,
        body: '{{child_first}} was picked up from {{class_name}}. See you next Sunday. GateWay Kids.' },
      { id: 't3', slug: 'first_visit', name: 'First visit welcome', channel: 'sms', active: true,
        body: 'Welcome to GateWay Las Vegas, {{first_name}}. Glad you are here. Reply STOP to opt out.' },
      { id: 't4', slug: 'sunday_reminder', name: 'Saturday reminder', channel: 'sms', active: false,
        body: 'See you tomorrow at GateWay Las Vegas. English 10am, Spanish 1pm. 3630 N Rancho Dr.' },
      { id: 't5', slug: 'grace_voice_open', name: 'Grace voice greeting', channel: 'voice', active: true,
        body: 'Hi, this is Grace at GateWay Las Vegas. I can look up families, kids classes, and who is here today. What do you need?' }
    ];
    const automations = [
      { id: 'a1', name: 'Text parent when a child checks in', trigger: 'kid_checked_in', template_slug: 'kid_checked_in', enabled: true },
      { id: 'a2', name: 'Text parent when a child is picked up', trigger: 'kid_checked_out', template_slug: 'kid_checked_out', enabled: true },
      { id: 'a3', name: 'Welcome text on first connect', trigger: 'first_visit', template_slug: 'first_visit', enabled: true },
      { id: 'a4', name: 'Saturday service reminder', trigger: 'sunday_reminder', template_slug: 'sunday_reminder', enabled: false }
    ];
    const db = {
      families: [
        { id: 'f1', name: 'Solis family', created_at: t, members: [maria, diego, sofia] },
        { id: 'f2', name: 'Okonkwo family', created_at: t, members: [james, amara] },
        { id: 'f3', name: 'Ruiz household', created_at: t, members: [elena] },
        { id: 'f4', name: 'Nguyen', created_at: t, members: [chris] }
      ],
      classes,
      checkins: [],
      templates,
      automations,
      notices: []
    };
    localStorage.setItem(KEY, JSON.stringify(db));
    return db;
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      const db = JSON.parse(raw);
      if (!db.families || !db.classes) return seed();
      return db;
    } catch { return seed(); }
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }

  function decorateFamily(f) {
    return {
      ...f,
      members: (f.members || []).map((m) => ({ ...m, age: ageYears(m.birthdate) }))
    };
  }

  function classForAge(db, age) {
    if (age == null) return db.classes[2];
    return db.classes.find((c) => age >= c.min_age && age <= c.max_age) || db.classes[2];
  }

  function fireLocal(db, trigger, vars, parent, child) {
    const autos = db.automations.filter((a) => a.enabled && a.trigger === trigger);
    const out = [];
    autos.forEach((a) => {
      const template = db.templates.find((t) => t.slug === a.template_slug && t.active !== false);
      if (!template) return;
      const body = tpl(template.body, vars);
      const notice = {
        id: uid(), campus_slug: CAMPUS, member_id: parent && parent.id, child_id: child && child.id,
        template_slug: template.slug, channel: template.channel, to_phone: parent && parent.phone,
        body, status: 'preview', created_at: new Date().toISOString()
      };
      db.notices.unshift(notice);
      out.push(notice);
    });
    return out;
  }

  function rosterOf(db) {
    const day = today();
    return db.checkins.filter((c) => c.service_date === day).map((c) => {
      const cls = db.classes.find((x) => x.id === c.class_id) || {};
      const child = db.families.flatMap((f) => f.members).find((m) => m.id === c.child_id) || {};
      return {
        ...c,
        child_name: ((child.first_name || '') + ' ' + (child.last_name || '')).trim(),
        class_name: cls.name || '',
        room: cls.room || ''
      };
    });
  }

  function hay(x) { return JSON.stringify(x).toLowerCase(); }

  function searchLocal(query) {
    const db = load();
    const families = db.families.map(decorateFamily);
    const roster = rosterOf(db).filter((r) => !r.checked_out_at);
    const q = (query || '').trim().toLowerCase();
    if (!q) {
      const spoken = roster.length
        ? roster.length + ' kids are checked in right now. ' + roster.map((r) => r.child_name + ' in ' + r.class_name).join('. ')
        : 'No kids are checked in yet today.';
      return { spoken, families, roster, classes: db.classes };
    }
    const famHits = families.filter((f) => hay(f).includes(q));
    const parts = [];
    if (/check.?in|here|roster|class/.test(q)) {
      parts.push(roster.length
        ? roster.length + ' checked in: ' + roster.map((r) => r.child_name + ' in ' + r.class_name + ', code ' + r.pickup_code).join('; ')
        : 'Nobody is checked into a class yet.');
    }
    if (famHits.length) {
      parts.push(famHits.slice(0, 4).map((f) => {
        const kids = (f.members || []).filter((m) => m.role === 'child');
        const adults = (f.members || []).filter((m) => m.role !== 'child');
        return f.name + ': ' + adults.map((a) => a.first_name).join(', ') +
          (kids.length ? ', kids ' + kids.map((k) => k.first_name).join(', ') : '');
      }).join('. '));
    }
    const rosterHits = roster.filter((r) => hay(r).includes(q));
    const spoken = parts.join(' ') || (rosterHits.length
      ? rosterHits.map((r) => r.child_name + ' is in ' + r.class_name + '. Pickup ' + r.pickup_code + '.').join(' ')
      : 'I did not find a matching family or class. Try a last name or a class name.');
    return { spoken, families: famHits, roster: rosterHits.length ? rosterHits : roster, classes: db.classes };
  }

  const api = {
    preview: false,
    token: null,
    role: 'gcc_staff',
    cache: null,

    usePreview(on) { this.preview = !!on; },
    setAuth(token, role) { this.token = token; if (role) this.role = role; },

    async call(payload) {
      const headers = { 'Content-Type': 'application/json', apikey: C.SUPABASE_ANON_KEY };
      headers.Authorization = 'Bearer ' + (this.token || C.SUPABASE_ANON_KEY);
      const res = await fetch(C.OPS_URL, { method: 'POST', headers, body: JSON.stringify({ campus: CAMPUS, ...payload }) });
      if (!res.ok) throw new Error('ops ' + res.status);
      return res.json();
    },

    async bootstrap() {
      if (this.preview) {
        const db = load();
        this.cache = {
          families: db.families.map(decorateFamily),
          classes: db.classes,
          roster: rosterOf(db),
          templates: db.templates,
          automations: db.automations,
          notices: db.notices,
          today: today(),
          role: this.role
        };
        return this.cache;
      }
      try {
        const data = await this.call({ action: 'bootstrap' });
        this.cache = data;
        if (data.role) this.role = data.role;
        return data;
      } catch (e) {
        console.warn('gcc-ops fallback preview', e);
        this.preview = true;
        return this.bootstrap();
      }
    },

    families() { return (this.cache && this.cache.families) || []; },
    classes() { return (this.cache && this.cache.classes) || []; },
    roster() { return ((this.cache && this.cache.roster) || []).filter((r) => !r.checked_out_at); },
    templates() { return (this.cache && this.cache.templates) || []; },
    automations() { return (this.cache && this.cache.automations) || []; },
    notices() { return (this.cache && this.cache.notices) || []; },

    familyForMember(memberId) {
      return this.families().find((f) => (f.members || []).some((m) => m.id === memberId)) || null;
    },
    suggestedClass(member) {
      return classForAge({ classes: this.classes() }, member && member.age);
    },

    async addChild(familyId, { first_name, last_name, birthdate }) {
      if (this.preview) {
        const db = load();
        const fam = db.families.find((f) => f.id === familyId);
        if (!fam) throw new Error('family missing');
        const child = { id: uid(), first_name, last_name: last_name || '', birthdate, role: 'child' };
        fam.members.push(child);
        save(db);
        await this.bootstrap();
        return child;
      }
      await this.call({ action: 'family_add', family_id: familyId, first_name, last_name, birthdate, role: 'child' });
      return this.bootstrap();
    },

    async createFamily({ name, members }) {
      if (this.preview) {
        const db = load();
        db.families.push({ id: uid(), name, created_at: new Date().toISOString(), members: members || [] });
        save(db);
        return this.bootstrap();
      }
      await this.call({ action: 'family_create', name, members });
      return this.bootstrap();
    },

    async checkIn({ child_id, class_id, volunteer_name }) {
      if (this.preview) {
        const db = load();
        const child = db.families.flatMap((f) => f.members.map((m) => ({ ...m, family: f }))).find((m) => m.id === child_id);
        if (!child) throw new Error('child missing');
        const open = db.checkins.find((c) => c.child_id === child_id && c.service_date === today() && !c.checked_out_at);
        if (open) return { error: 'already checked in', checkin: open };
        const cls = db.classes.find((c) => c.id === class_id);
        const code = pickup();
        const row = {
          id: uid(), campus_slug: CAMPUS, class_id, child_id, family_id: child.family.id,
          service_date: today(), pickup_code: code, checked_in_by_name: volunteer_name || 'desk',
          checked_in_at: new Date().toISOString(), checked_out_at: null
        };
        db.checkins.push(row);
        const parent = (child.family.members || []).find((m) => m.role === 'head' || m.role === 'spouse' || m.role === 'adult');
        const notices = fireLocal(db, 'kid_checked_in', {
          child_first: child.first_name,
          child_name: (child.first_name + ' ' + (child.last_name || '')).trim(),
          class_name: cls.name, room: cls.room || '', pickup_code: code,
          parent_first: parent ? parent.first_name : 'parent',
          first_name: parent ? parent.first_name : ''
        }, parent, child);
        save(db);
        await this.bootstrap();
        return {
          ok: true,
          checkin: { ...row, child_name: (child.first_name + ' ' + (child.last_name || '')).trim(), class_name: cls.name, room: cls.room },
          notices
        };
      }
      const data = await this.call({ action: 'checkin', child_id, class_id, volunteer_name });
      await this.bootstrap();
      return data;
    },

    async checkOut(checkin_id) {
      if (this.preview) {
        const db = load();
        const row = db.checkins.find((c) => c.id === checkin_id);
        if (row) row.checked_out_at = new Date().toISOString();
        const child = db.families.flatMap((f) => f.members.map((m) => ({ ...m, family: f }))).find((m) => m.id === row.child_id);
        const cls = db.classes.find((c) => c.id === row.class_id) || {};
        const parent = child && child.family.members.find((m) => m.role === 'head' || m.role === 'spouse');
        fireLocal(db, 'kid_checked_out', {
          child_first: child ? child.first_name : '',
          class_name: cls.name || '', room: cls.room || '', pickup_code: row.pickup_code,
          parent_first: parent ? parent.first_name : ''
        }, parent, child);
        save(db);
        return this.bootstrap();
      }
      await this.call({ action: 'checkout', checkin_id });
      return this.bootstrap();
    },

    async saveTemplate(t) {
      if (this.preview) {
        const db = load();
        const hit = db.templates.find((x) => x.slug === t.slug);
        if (hit) Object.assign(hit, t);
        else db.templates.push({ id: uid(), active: true, channel: 'sms', ...t });
        save(db);
        return this.bootstrap();
      }
      await this.call({ action: 'template_save', ...t });
      return this.bootstrap();
    },

    async toggleAutomation(id, enabled) {
      if (this.preview) {
        const db = load();
        const a = db.automations.find((x) => x.id === id);
        if (a) a.enabled = enabled;
        save(db);
        return this.bootstrap();
      }
      await this.call({ action: 'automation_save', id, enabled });
      return this.bootstrap();
    },

    search(query) {
      if (this.preview) return Promise.resolve(searchLocal(query));
      return this.call({ action: 'search', query }).catch(() => searchLocal(query));
    }
  };

  window.GCCOps = api;
})();
