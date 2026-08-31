import { gccAuthGuard, gccSignOut } from './auth.js';

const C = window.GCC, D = window.GCCData, Ops = window.GCCOps, Grace = window.GCCGrace;
const $ = (id) => document.getElementById(id);
const preview = new URLSearchParams(location.search).get('preview') === '1';
const session = preview ? { preview: true } : await gccAuthGuard();
if (!session) throw new Error('auth');

if (!preview && session.user && session.user.app_metadata && session.user.app_metadata.role === 'gcc_kids') {
  location.href = 'kids.html';
}

$('btnOut').onclick = preview ? () => location.href = '../index.html' : gccSignOut;
if (preview) {
  document.querySelectorAll('a[href="kids.html"]').forEach((a) => { a.href = 'kids.html?preview=1'; });
  document.querySelectorAll('a[href="staff.html"]').forEach((a) => { a.href = 'staff.html?preview=1'; });
}

Ops.usePreview(preview);
if (session.access_token) Ops.setAuth(session.access_token, session.user.app_metadata && session.user.app_metadata.role);

let filter = 'all', query = '', selected = null, people = [];
let famSelected = null, kidSelected = null, autoSelected = null;

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const ago = (iso) => {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return new Date(iso).toLocaleDateString();
};
const esc = (x) => String(x || '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const ini = (name) => (name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const full = (m) => ((m.first_name || '') + ' ' + (m.last_name || '')).trim();

function seedPeople() {
  const t = new Date().toISOString();
  return {
    members: [
      { id: '1', first_name: 'Maria', last_name: 'Solis', phone: '(702) 555-0144', email: 'maria.solis@mail.com', source: 'qr', created_at: t },
      { id: '2', first_name: 'James', last_name: 'Okonkwo', phone: '(702) 555-0190', email: 'james@okonkwo.mail', source: 'app', created_at: t },
      { id: '3', first_name: 'Elena', last_name: 'Ruiz', phone: '(725) 555-0112', email: null, source: 'qr', created_at: t },
      { id: '4', first_name: 'Chris', last_name: 'Nguyen', phone: '(702) 555-0177', email: 'chris.n@nv.dev', source: 'app', created_at: t }
    ],
    attendance: [
      { member_id: '1', display_name: 'Maria Solis', service_date: today(), method: 'shortcut', created_at: t },
      { member_id: '2', display_name: 'James Okonkwo', service_date: today(), method: 'qr', created_at: t },
      { member_id: '3', display_name: 'Elena Ruiz', service_date: today(), method: 'geofence', created_at: t }
    ],
    geofence: [
      { member_id: '1', display_name: 'Maria Solis', event: 'enter', created_at: t },
      { member_id: '2', display_name: 'James Okonkwo', event: 'enter', created_at: t }
    ],
    prayers: [
      { member_id: '1', display_name: 'Maria Solis', request: 'Please pray for my brother in the hospital. Surgery this week.', is_private: true, status: 'new', contact: 'text only', created_at: t }
    ],
    messages: [
      { member_id: '2', display_name: 'James Okonkwo', pastor: 'Pastor Danny Hand', message: 'Can we talk this week about baptism for my son?', contact: 'james@okonkwo.mail', status: 'new', created_at: t }
    ],
    volunteers: [
      { member_id: '3', display_name: 'Elena Ruiz', role_title: 'Kids check-in desk', contact: '(725) 555-0112', created_at: t }
    ]
  };
}

function buildPeople(f) {
  const byId = {};
  const put = (id, name, extra = {}) => {
    const key = id || ('n:' + name);
    if (!byId[key]) byId[key] = { id, name, here: false, prayer: [], inbox: [], serve: [], visits: [], last: extra.created_at };
    Object.assign(byId[key], extra);
    return byId[key];
  };
  (f.members || []).forEach((m) => put(m.id, (m.first_name + ' ' + (m.last_name || '')).trim(), {
    phone: m.phone, email: m.email, source: m.source, created_at: m.created_at, last: m.created_at
  }));
  (f.attendance || []).forEach((a) => {
    const p = put(a.member_id, a.display_name);
    p.visits.push(a);
    if (a.service_date === today()) p.here = true;
    p.last = a.created_at || p.last;
  });
  (f.geofence || []).forEach((g) => {
    const p = put(g.member_id, g.display_name);
    if (g.event === 'enter' && (g.created_at || '').slice(0, 10) === today()) p.here = true;
    p.last = g.created_at || p.last;
  });
  (f.prayers || []).forEach((r) => { const p = put(r.member_id, r.display_name); p.prayer.push(r); p.last = r.created_at || p.last; });
  (f.messages || []).forEach((m) => { const p = put(m.member_id, m.display_name); p.inbox.push(m); p.last = m.created_at || p.last; });
  (f.volunteers || []).forEach((v) => { const p = put(v.member_id, v.display_name); p.serve.push(v); });
  return Object.values(byId).sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

function kidsList() {
  const q = query.trim().toLowerCase();
  const roster = Ops.roster();
  const out = [];
  Ops.families().forEach((f) => {
    (f.members || []).filter((m) => m.role === 'child').forEach((m) => {
      const open = roster.find((r) => r.child_id === m.id);
      out.push({ ...m, family: f, name: full(m), open });
    });
  });
  return out.filter((k) => {
    if (!q) return true;
    return k.name.toLowerCase().includes(q) || (k.family.name || '').toLowerCase().includes(q);
  });
}

function visiblePeople() {
  const q = query.trim().toLowerCase();
  return people.filter((p) => {
    if (filter === 'here' && !p.here) return false;
    if (filter === 'prayer' && !p.prayer.length) return false;
    if (filter === 'inbox' && !p.inbox.length) return false;
    if (filter === 'serve' && !p.serve.length) return false;
    if (!q) return true;
    return (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q) || (p.email || '').toLowerCase().includes(q);
  });
}

function renderList() {
  if (filter === 'hello') return renderHelloList();
  if (filter === 'family') return renderFamilyList();
  if (filter === 'kids') return renderKidsList();
  if (filter === 'auto') return renderAutoList();
  const list = visiblePeople();
  $('people').innerHTML = list.map((p) => `
    <button class="person ${selected && selected.name === p.name ? 'on' : ''}" data-name="${esc(p.name)}">
      <span class="initials">${esc(ini(p.name))}</span>
      <span>
        <span class="nm">${esc(p.name)}</span>
        <span class="meta">${p.here ? '<span class="mark-here">Here</span>' : 'Out'} ${p.prayer.length ? '· <span class="mark-pray">Prayer</span>' : ''} ${p.inbox.length ? '· Inbox' : ''}</span>
      </span>
      <span class="when">${ago(p.last)}</span>
    </button>`).join('') || '<p class="ops-empty">No one matches.</p>';
  $('people').querySelectorAll('.person').forEach((btn) => {
    btn.onclick = () => { selected = people.find((p) => p.name === btn.dataset.name); renderList(); renderFile(); };
  });
  countHead();
}

function countHead() {
  const here = people.filter((p) => p.here).length;
  const kidsIn = Ops.roster().length;
  $('headCount').textContent = here + ' in the house · ' + kidsIn + ' in class · ' + people.length + ' on file';
}

function renderFamilyList() {
  const q = query.trim().toLowerCase();
  const list = Ops.families().filter((f) => !q || (f.name || '').toLowerCase().includes(q) || hayMembers(f).includes(q));
  $('people').innerHTML = list.map((f) => {
    const kids = (f.members || []).filter((m) => m.role === 'child');
    return `<button class="person ${famSelected && famSelected.id === f.id ? 'on' : ''}" data-fid="${esc(f.id)}">
      <span class="initials">${esc(ini(f.name))}</span>
      <span><span class="nm">${esc(f.name)}</span>
      <span class="meta">${(f.members || []).length} people${kids.length ? ' · ' + kids.length + ' kids' : ''}</span></span>
    </button>`;
  }).join('') || '<p class="ops-empty">No families yet.</p>';
  $('people').querySelectorAll('[data-fid]').forEach((btn) => {
    btn.onclick = () => {
      famSelected = Ops.families().find((f) => f.id === btn.dataset.fid);
      renderFamilyList();
      renderFamilyFile();
    };
  });
  countHead();
}

function hayMembers(f) {
  return (f.members || []).map((m) => full(m).toLowerCase()).join(' ');
}

function renderFamilyFile() {
  const f = famSelected;
  if (!f) { $('file').innerHTML = '<p class="ops-empty">Select a family.</p>'; return; }
  const adults = (f.members || []).filter((m) => m.role !== 'child');
  const kids = (f.members || []).filter((m) => m.role === 'child');
  $('file').innerHTML = `
    <p class="tiny">Household</p>
    <h1>${esc(f.name)}</h1>
    <div class="ops-block">
      <h3>Adults</h3>
      ${adults.map((m) => `<p><b>${esc(full(m))}</b> · ${esc(m.role)} · ${esc(m.phone || 'no phone')}</p>`).join('') || '<p class="tiny">None.</p>'}
    </div>
    <div class="ops-block">
      <h3>Kids</h3>
      ${kids.map((m) => {
        const open = Ops.roster().find((r) => r.child_id === m.id);
        return `<p><b>${esc(full(m))}</b> · age ${m.age ?? '—'} ${open ? '· <span class="mark-here">In ' + esc(open.class_name) + ' · ' + esc(open.pickup_code) + '</span>' : ''}</p>`;
      }).join('') || '<p class="tiny">No children on this file.</p>'}
    </div>
    <div class="ops-block">
      <h3>Add a child</h3>
      <div class="desk-form">
        <input id="newKidFirst" placeholder="First name">
        <input id="newKidLast" placeholder="Last name">
        <input id="newKidDob" type="date">
        <button class="btn btn-ink" id="addKidBtn">Add</button>
      </div>
    </div>`;
  $('addKidBtn').onclick = async () => {
    const first = $('newKidFirst').value.trim();
    if (!first) return;
    await Ops.addChild(f.id, { first_name: first, last_name: $('newKidLast').value.trim(), birthdate: $('newKidDob').value || null });
    famSelected = Ops.families().find((x) => x.id === f.id);
    renderFamilyList();
    renderFamilyFile();
  };
}

function renderKidsList() {
  const list = kidsList();
  $('people').innerHTML = list.map((k) => `
    <button class="person ${kidSelected && kidSelected.id === k.id ? 'on' : ''}" data-kid="${esc(k.id)}">
      <span class="initials">${esc(ini(k.name))}</span>
      <span>
        <span class="nm">${esc(k.name)}</span>
        <span class="meta">${esc(k.family.name)}${k.open ? ' · <span class="mark-here">' + esc(k.open.class_name) + '</span>' : ''}</span>
      </span>
      <span class="when">${k.open ? k.open.pickup_code : (k.age != null ? k.age + 'y' : '')}</span>
    </button>`).join('') || '<p class="ops-empty">No children on file.</p>';
  $('people').querySelectorAll('[data-kid]').forEach((btn) => {
    btn.onclick = () => {
      kidSelected = kidsList().find((k) => k.id === btn.dataset.kid);
      renderKidsList();
      renderKidsFile();
    };
  });
  countHead();
}

function renderKidsFile() {
  const k = kidSelected;
  const roster = Ops.roster();
  if (!k) {
    $('file').innerHTML = `
      <p class="tiny">Sunday classes</p>
      <h1>Kids in class</h1>
      <div class="roster-grid">
        ${Ops.classes().map((c) => {
          const inRoom = roster.filter((r) => r.class_id === c.id);
          return `<div class="roster-card"><h3>${esc(c.name)}</h3><p class="tiny">${esc(c.room)} · ages ${c.min_age}–${c.max_age}</p>
            ${inRoom.map((r) => `<p><b>${esc(r.child_name)}</b> · ${esc(r.pickup_code)}</p>`).join('') || '<p class="tiny">Empty</p>'}</div>`;
        }).join('')}
      </div>
      <p class="tiny" style="margin-top:18px">Volunteers use the <a href="kids.html${preview ? '?preview=1' : ''}">Kids desk</a> on a phone at the classroom door.</p>`;
    return;
  }
  const suggested = Ops.suggestedClass(k);
  const open = k.open;
  $('file').innerHTML = `
    <p class="tiny">${esc(k.family.name)}</p>
    <h1>${esc(k.name)}</h1>
    <dl class="facts">
      <div><dt>Age</dt><dd>${k.age ?? '—'}</dd></div>
      <div><dt>Suggested class</dt><dd>${esc(suggested ? suggested.name : '—')}</dd></div>
      <div><dt>Status</dt><dd>${open ? 'In ' + esc(open.class_name) : 'Not checked in'}</dd></div>
      <div><dt>Pickup code</dt><dd>${open ? esc(open.pickup_code) : '—'}</dd></div>
    </dl>
    ${open ? `
      <p class="pickup-code">${esc(open.pickup_code)}</p>
      <button class="btn btn-ghost" id="coBtn">Mark picked up</button>
    ` : `
      <div class="ops-block">
        <h3>Check in</h3>
        <div class="desk-form">
          <select id="classPick">${Ops.classes().map((c) => `<option value="${c.id}" ${suggested && suggested.id === c.id ? 'selected' : ''}>${esc(c.name)} · ${esc(c.room)}</option>`).join('')}</select>
          <button class="btn btn-ink" id="ciBtn">Check in</button>
        </div>
      </div>`}
    <div class="ops-block">
      <h3>Parent notice</h3>
      ${Ops.notices().filter((n) => n.child_id === k.id).slice(0, 4).map((n) => `<p class="tiny">${esc(n.status)} · ${esc(n.body)}</p>`).join('') || '<p class="tiny">None yet. Checking in sends the parent template if that automation is on.</p>'}
    </div>`;
  const ci = $('ciBtn');
  if (ci) ci.onclick = async () => {
    await Ops.checkIn({ child_id: k.id, class_id: $('classPick').value, volunteer_name: 'Grace desk' });
    kidSelected = kidsList().find((x) => x.id === k.id);
    renderKidsList();
    renderKidsFile();
  };
  const co = $('coBtn');
  if (co) co.onclick = async () => {
    await Ops.checkOut(open.id);
    kidSelected = kidsList().find((x) => x.id === k.id);
    renderKidsList();
    renderKidsFile();
  };
}

function renderAutoList() {
  const list = Ops.automations();
  $('people').innerHTML = list.map((a) => `
    <button class="person ${autoSelected && autoSelected.id === a.id ? 'on' : ''}" data-aid="${esc(a.id)}">
      <span class="initials">${a.enabled ? 'ON' : 'OFF'}</span>
      <span><span class="nm">${esc(a.name)}</span>
      <span class="meta">${esc(a.trigger)} → ${esc(a.template_slug)}</span></span>
    </button>`).join('');
  $('people').querySelectorAll('[data-aid]').forEach((btn) => {
    btn.onclick = () => {
      autoSelected = Ops.automations().find((a) => a.id === btn.dataset.aid);
      renderAutoList();
      renderAutoFile();
    };
  });
  countHead();
}

function renderAutoFile() {
  const a = autoSelected;
  const tpls = Ops.templates();
  if (!a) {
    $('file').innerHTML = `
      <p class="tiny">Automations</p>
      <h1>Templates</h1>
      <p class="tiny" style="margin:8px 0 18px">Same jobs Breeze email reports and check-in texts do. Tokens: {{child_first}} {{class_name}} {{pickup_code}} {{parent_first}} {{room}} {{first_name}}</p>
      ${tpls.map((t) => `
        <div class="ops-block">
          <h3>${esc(t.name)} · ${esc(t.channel)}</h3>
          <textarea class="tpl-body" data-slug="${esc(t.slug)}">${esc(t.body)}</textarea>
          <button class="btn btn-ghost tpl-save" data-slug="${esc(t.slug)}" style="margin-top:8px">Save</button>
        </div>`).join('')}
      <div class="ops-block">
        <h3>Recent parent notices</h3>
        ${Ops.notices().slice(0, 8).map((n) => `<p class="tiny">${ago(n.created_at)} · ${esc(n.status)} · ${esc(n.body)}</p>`).join('') || '<p class="tiny">None yet.</p>'}
      </div>`;
    document.querySelectorAll('.tpl-save').forEach((btn) => {
      btn.onclick = async () => {
        const slug = btn.dataset.slug;
        const t = tpls.find((x) => x.slug === slug);
        const body = document.querySelector('.tpl-body[data-slug="' + slug + '"]').value;
        await Ops.saveTemplate({ ...t, body });
        renderAutoFile();
      };
    });
    return;
  }
  $('file').innerHTML = `
    <p class="tiny">${esc(a.trigger)}</p>
    <h1>${esc(a.name)}</h1>
    <label class="toggle" style="margin:16px 0"><div><b>${a.enabled ? 'On' : 'Off'}</b><span>Runs when ${esc(a.trigger).replace(/_/g, ' ')} fires.</span></div>
      <input type="checkbox" id="autoEn" ${a.enabled ? 'checked' : ''}></label>
    <div class="ops-block">
      <h3>Template</h3>
      <p>${esc(a.template_slug)}</p>
      <p class="tiny">${esc((tpls.find((t) => t.slug === a.template_slug) || {}).body || '')}</p>
    </div>`;
  $('autoEn').onchange = async () => {
    await Ops.toggleAutomation(a.id, $('autoEn').checked);
    autoSelected = Ops.automations().find((x) => x.id === a.id);
    renderAutoList();
    renderAutoFile();
  };
}

function renderFile() {
  if (filter === 'hello') return renderHelloFile();
  if (filter === 'family') return renderFamilyFile();
  if (filter === 'kids') return renderKidsFile();
  if (filter === 'auto') return renderAutoFile();
  const p = selected;
  if (!p) { $('file').innerHTML = '<p class="ops-empty">Select someone on the left.</p>'; return; }
  const fam = Ops.familyForMember(p.id);
  $('file').innerHTML = `
    <p class="tiny">${p.here ? 'In the house right now' : 'Not on campus'}</p>
    <h1>${esc(p.name)}</h1>
    <dl class="facts">
      <div><dt>Phone</dt><dd>${esc(p.phone) || '—'}</dd></div>
      <div><dt>Email</dt><dd>${esc(p.email) || '—'}</dd></div>
      <div><dt>Source</dt><dd>${esc(p.source) || 'app'}</dd></div>
      <div><dt>Family</dt><dd>${fam ? esc(fam.name) : '—'}</dd></div>
    </dl>
    ${fam ? `<div class="ops-block"><h3>Household</h3>${fam.members.map((m) => `<p>${esc(full(m))} · ${esc(m.role)}${m.age != null ? ' · ' + m.age : ''}</p>`).join('')}</div>` : ''}
    <div class="ops-block">
      <h3>Prayer</h3>
      ${p.prayer.map((r) => `<p>${esc(r.request)}${r.is_private ? ' <span class="mark-pray">private</span>' : ''}</p>`).join('') || '<p class="tiny">None on file.</p>'}
    </div>
    <div class="ops-block">
      <h3>Pastor inbox</h3>
      ${p.inbox.map((m) => `<p><b>${esc(m.pastor)}</b> · ${esc(m.message)}</p>`).join('') || '<p class="tiny">No messages.</p>'}
    </div>
    <div class="ops-block">
      <h3>Serving</h3>
      ${p.serve.map((v) => `<p>${esc(v.role_title)}</p>`).join('') || '<p class="tiny">Not signed up.</p>'}
    </div>
    <div class="ops-block">
      <h3>Visits</h3>
      ${p.visits.slice(0, 8).map((v) => `<p>${esc(v.service_date)} · ${esc(v.method)}</p>`).join('') || '<p class="tiny">No check-ins yet.</p>'}
    </div>`;
}

async function loadPeople() {
  let f;
  if (preview) f = seedPeople();
  else {
    const auth = (!C.DEMO_MODE && session.access_token) ? { Authorization: 'Bearer ' + session.access_token } : {};
    f = await D.staffFeeds(auth);
  }
  people = buildPeople(f);
  if (!selected && people[0]) selected = people[0];
}

const FN = C.SUPABASE_URL + '/functions/v1/gcc-watch-hello';
const LOCAL_KEY = 'gcc-watch-local';
const DEFAULT_AUTO = 'Hello from GateWay Las Vegas. Glad you are watching with us. A host will write back shortly.';
let helloThreads = [];
let helloSelected = null;
let autoOn = true;

function loadLocalWatch() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || { auto_reply: true, auto_reply_text: DEFAULT_AUTO, threads: [] }; }
  catch { return { auto_reply: true, auto_reply_text: DEFAULT_AUTO, threads: [] }; }
}
function saveLocalWatch(store) { localStorage.setItem(LOCAL_KEY, JSON.stringify(store)); }

async function watchCall(payload) {
  const headers = { 'Content-Type': 'application/json', apikey: C.SUPABASE_ANON_KEY };
  if (session.access_token) headers.Authorization = 'Bearer ' + session.access_token;
  else headers.Authorization = 'Bearer ' + C.SUPABASE_ANON_KEY;
  const res = await fetch(FN, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.json();
}

function renderHelloList() {
  $('people').innerHTML = helloThreads.map((t) => {
    const last = (t.messages || []).slice(-1)[0];
    return `<button class="person ${helloSelected && helloSelected.id === t.id ? 'on' : ''}" data-hid="${esc(t.id)}">
      <span class="initials">${esc(ini(t.display_name))}</span>
      <span><span class="nm">${esc(t.display_name)}</span>
      <span class="meta">${esc((last && last.body) || 'Hello')}</span></span>
      <span class="when">${ago(t.created_at)}</span>
    </button>`;
  }).join('') || '<p class="ops-empty">No hellos yet. They show up when someone writes from Watch.</p>';
  $('people').querySelectorAll('[data-hid]').forEach((btn) => {
    btn.onclick = () => {
      helloSelected = helloThreads.find((t) => t.id === btn.dataset.hid);
      renderHelloList();
      renderHelloFile();
    };
  });
}

function renderHelloFile() {
  const t = helloSelected;
  if (!t) { $('file').innerHTML = '<p class="ops-empty">Select a hello on the left.</p>'; return; }
  const msgs = t.messages || [];
  $('file').innerHTML = `
    <p class="tiny">Watch desk</p>
    <h1>${esc(t.display_name)}</h1>
    <div class="hello-log" id="staffHelloLog" style="min-height:220px;margin:16px 0">
      ${msgs.map((m) => `<div class="hello-row ${m.role === 'viewer' ? 'me' : 'house'}"><span class="who">${esc(m.display_name)}</span>${esc(m.body)}</div>`).join('') || '<p class="tiny">No messages.</p>'}
    </div>
    <div class="hello-form">
      <textarea id="staffReply" placeholder="Write back..."></textarea>
      <button class="btn btn-ink" id="staffReplyBtn">Send</button>
    </div>`;
  const box = document.getElementById('staffHelloLog');
  if (box) box.scrollTop = box.scrollHeight;
  document.getElementById('staffReplyBtn').onclick = sendStaffReply;
}

async function sendStaffReply() {
  const text = document.getElementById('staffReply').value.trim();
  if (!text || !helloSelected) return;
  if (preview) {
    const store = loadLocalWatch();
    const th = store.threads.find((x) => x.id === helloSelected.id);
    if (th) {
      th.messages.push({ id: 's' + Date.now(), role: 'staff', display_name: 'Host', body: text, created_at: new Date().toISOString() });
      saveLocalWatch(store);
      helloThreads = store.threads;
      helloSelected = th;
    }
  } else {
    await watchCall({ action: 'staff_reply', thread_id: helloSelected.id, body: text });
    await loadHellos();
    helloSelected = helloThreads.find((t) => t.id === helloSelected.id) || helloSelected;
  }
  renderHelloList();
  renderHelloFile();
}

async function loadHellos() {
  if (preview) {
    const store = loadLocalWatch();
    autoOn = store.auto_reply !== false;
    $('autoReply').checked = autoOn;
    helloThreads = store.threads || [];
    return;
  }
  try {
    const data = await watchCall({ action: 'feed', campus: 'lasvegas' });
    autoOn = data.auto_reply !== false;
    $('autoReply').checked = autoOn;
    const byId = {};
    (data.threads || []).forEach((t) => { byId[t.id] = { ...t, messages: [] }; });
    (data.messages || []).forEach((m) => { if (byId[m.thread_id]) byId[m.thread_id].messages.push(m); });
    helloThreads = Object.values(byId);
  } catch (e) {
    const store = loadLocalWatch();
    autoOn = store.auto_reply !== false;
    $('autoReply').checked = autoOn;
    helloThreads = store.threads || [];
    console.warn('hello feed fallback', e);
  }
}

$('autoReply').onchange = async () => {
  autoOn = $('autoReply').checked;
  if (preview) {
    const store = loadLocalWatch();
    store.auto_reply = autoOn;
    saveLocalWatch(store);
    return;
  }
  try { await watchCall({ action: 'settings', campus: 'lasvegas', auto_reply: autoOn }); }
  catch (e) { console.warn(e); }
};

$('q').oninput = (e) => {
  query = e.target.value;
  renderList();
  if (filter === 'hello') renderHelloFile();
  else if (filter === 'family') renderFamilyFile();
  else if (filter === 'kids') renderKidsFile();
  else if (filter === 'auto') renderAutoFile();
  else renderFile();
};

document.querySelectorAll('.ops-filters button').forEach((b) => {
  b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll('.ops-filters button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
    if (filter === 'hello') renderHelloFile();
    else if (filter === 'family') { if (!famSelected) famSelected = Ops.families()[0] || null; renderFamilyFile(); }
    else if (filter === 'kids') renderKidsFile();
    else if (filter === 'auto') renderAutoFile();
    else renderFile();
  };
});

function paintGrace() {
  const log = $('graceLog');
  if (!log) return;
  log.scrollTop = log.scrollHeight;
}

function pushGrace(role, content) {
  const log = $('graceLog');
  if (!log) return;
  const row = document.createElement('div');
  row.className = 'g-msg ' + (role === 'you' ? 'is-you' : 'is-grace');
  const lab = document.createElement('div');
  lab.className = 'g-lab';
  lab.textContent = role === 'you' ? 'You' : 'Grace';
  const body = document.createElement('p');
  body.className = 'g-body';
  body.textContent = content;
  row.appendChild(lab);
  row.appendChild(body);
  log.appendChild(row);
  paintGrace();
}

$('graceAsk').onclick = async () => {
  const q = $('graceQ').value.trim();
  if (!q) return;
  $('graceQ').value = '';
  pushGrace('you', q);
  const spoken = await Grace.ask(q);
  pushGrace('grace', spoken);
};

$('graceTalk').onclick = async () => {
  if (Grace.active) { Grace.stop(); $('graceTalk').textContent = 'Talk'; $('graceState').textContent = 'Typed'; return; }
  $('graceState').textContent = 'Connecting';
  Grace.onState = (s) => { $('graceState').textContent = s || 'Typed'; $('graceTalk').textContent = Grace.active ? 'Stop' : 'Talk'; };
  Grace.onTurn = (t) => { if (t && t.content) pushGrace(t.role === 'user' ? 'you' : 'grace', t.content); };
  const err = await Grace.start();
  if (err) {
    pushGrace('grace', err);
    $('graceState').textContent = 'Typed';
  } else {
    $('graceTalk').textContent = 'Stop';
  }
};

await Ops.bootstrap();
await loadPeople();
await loadHellos();
renderList();
renderFile();
pushGrace('grace', 'I can look up families, kids classes, pickup codes, and who is in the house. Type a name, or tap Talk when voice is live.');

setInterval(async () => {
  if (filter === 'hello') { await loadHellos(); renderHelloList(); if (helloSelected) renderHelloFile(); }
  else if (!preview && (filter === 'all' || filter === 'here')) { await loadPeople(); renderList(); }
}, 4000);
