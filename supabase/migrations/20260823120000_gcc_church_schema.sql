-- GateWay City Church (Grace CRM data layer) on the IBS shared Supabase project.
-- Convention: {product}_{table} => church_*. Every row carries campus_slug so
-- this stays multi-campus clean from day one.
--
-- Access model:
--   * Congregants are ANONYMOUS. anon may INSERT intake rows and read the
--     public catalog (campuses, published events, active volunteer roles).
--     anon can NEVER read PII tables. No using(true) anywhere.
--   * Staff are Supabase Auth users with app_metadata.role in
--     ('gcc_staff','gcc_admin'). Other clients' authenticated users on the
--     shared project get nothing.
--
-- Apply with: supabase db push / apply_migration. Review before applying.

create table public.church_campuses (
  slug text primary key,
  name text not null,
  address text,
  phone text,
  lat double precision not null,
  lng double precision not null,
  fence_radius_m integer not null default 150,
  timezone text not null default 'America/Los_Angeles',
  created_at timestamptz not null default now()
);

create table public.church_members (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  first_name text not null,
  last_name text not null default '',
  phone text,
  email text,
  sms_opt_in boolean not null default false,
  source text not null default 'app',           -- app | qr | staff | import
  geo_token text unique,                        -- personal code for autonomous-welcome Shortcut pings
  sms_opened_at timestamptz,                    -- stamped when they text JOIN (Sendblue: outbound allowed only after inbound)
  phone_e164 text,                              -- verified sender number from the JOIN text (authoritative over self-typed phone)
  created_at timestamptz not null default now()
);
create index church_members_campus_idx on public.church_members (campus_slug, created_at desc);
create index church_members_phone_idx on public.church_members (phone) where phone is not null;
create index church_members_phone_e164_idx on public.church_members (phone_e164) where phone_e164 is not null;
create index church_members_email_idx on public.church_members (email) where email is not null;

create table public.church_attendance (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  member_id uuid references public.church_members(id),
  display_name text not null default 'Guest',
  service_date date not null default (now() at time zone 'America/Los_Angeles')::date,
  method text not null check (method in ('geofence', 'qr', 'manual', 'staff', 'shortcut')),
  created_at timestamptz not null default now()
);
create index church_attendance_day_idx on public.church_attendance (campus_slug, service_date);
create index church_attendance_member_idx on public.church_attendance (member_id) where member_id is not null;

create table public.church_geofence_events (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  member_id uuid references public.church_members(id),
  display_name text not null default 'Guest',
  event text not null check (event in ('enter', 'exit')),
  source text not null default 'app' check (source in ('app', 'shortcut', 'staff')),
  distance_m numeric,
  accuracy_m numeric,
  created_at timestamptz not null default now()
);
create index church_geofence_events_feed_idx on public.church_geofence_events (campus_slug, created_at desc);
create index church_geofence_events_member_idx on public.church_geofence_events (member_id) where member_id is not null;

create table public.church_events (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  title text not null,
  description text,
  location text,
  category text not null default 'Event',
  starts_at timestamptz not null,
  ends_at timestamptz,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);
create index church_events_upcoming_idx on public.church_events (campus_slug, starts_at) where is_published;

create table public.church_volunteer_roles (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  title text not null,
  description text,
  slots integer,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index church_volunteer_roles_campus_idx on public.church_volunteer_roles (campus_slug) where active;

create table public.church_volunteer_signups (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  role_id uuid references public.church_volunteer_roles(id),
  role_title text not null,
  member_id uuid references public.church_members(id),
  display_name text not null,
  contact text,
  note text,
  created_at timestamptz not null default now()
);
create index church_volunteer_signups_feed_idx on public.church_volunteer_signups (campus_slug, created_at desc);
create index church_volunteer_signups_role_idx on public.church_volunteer_signups (role_id) where role_id is not null;
create index church_volunteer_signups_member_idx on public.church_volunteer_signups (member_id) where member_id is not null;

create table public.church_prayer_requests (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  member_id uuid references public.church_members(id),
  display_name text not null default 'Anonymous',
  contact text,
  request text not null,
  is_private boolean not null default false,
  status text not null default 'new' check (status in ('new', 'praying', 'contacted', 'closed')),
  created_at timestamptz not null default now()
);
create index church_prayer_requests_feed_idx on public.church_prayer_requests (campus_slug, created_at desc);
create index church_prayer_requests_member_idx on public.church_prayer_requests (member_id) where member_id is not null;

create table public.church_pastor_messages (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  member_id uuid references public.church_members(id),
  pastor text not null,
  display_name text not null,
  contact text not null,
  message text not null,
  status text not null default 'new' check (status in ('new', 'replied', 'closed')),
  created_at timestamptz not null default now()
);
create index church_pastor_messages_feed_idx on public.church_pastor_messages (campus_slug, created_at desc);
create index church_pastor_messages_member_idx on public.church_pastor_messages (member_id) where member_id is not null;

create table public.church_sms_log (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  member_id uuid references public.church_members(id),
  kind text not null check (kind in ('welcome', 'goodbye')),
  to_phone text not null,
  status text not null check (status in ('sent', 'failed')),
  created_at timestamptz not null default now()
);
create index church_sms_log_dedupe_idx on public.church_sms_log (kind, created_at desc);
create index church_sms_log_member_idx on public.church_sms_log (member_id) where member_id is not null;

-- ============================ RLS ============================

alter table public.church_campuses          enable row level security;
alter table public.church_members           enable row level security;
alter table public.church_attendance        enable row level security;
alter table public.church_geofence_events   enable row level security;
alter table public.church_events            enable row level security;
alter table public.church_volunteer_roles   enable row level security;
alter table public.church_volunteer_signups enable row level security;
alter table public.church_prayer_requests   enable row level security;
alter table public.church_pastor_messages   enable row level security;
alter table public.church_sms_log            enable row level security;

-- Staff check: wrapped in select so it evaluates once per query, not per row.
create or replace function public.church_is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('gcc_staff', 'gcc_admin'),
    false
  );
$$;

-- Public catalog reads
create policy church_campuses_public_read on public.church_campuses
  for select to anon, authenticated using (true);  -- campus name/address/coords only, no PII

create policy church_events_public_read on public.church_events
  for select to anon, authenticated
  using (is_published or (select public.church_is_staff()));

create policy church_volunteer_roles_public_read on public.church_volunteer_roles
  for select to anon, authenticated
  using (active or (select public.church_is_staff()));

-- Anonymous intake writes (insert only, never read back)
create policy church_members_intake on public.church_members
  for insert to anon, authenticated with check (true);
create policy church_attendance_intake on public.church_attendance
  for insert to anon, authenticated with check (true);
create policy church_geofence_events_intake on public.church_geofence_events
  for insert to anon, authenticated with check (true);
create policy church_volunteer_signups_intake on public.church_volunteer_signups
  for insert to anon, authenticated with check (true);
create policy church_prayer_requests_intake on public.church_prayer_requests
  for insert to anon, authenticated with check (true);
create policy church_pastor_messages_intake on public.church_pastor_messages
  for insert to anon, authenticated with check (true);

-- Staff full visibility + workflow updates on PII tables
create policy church_members_staff on public.church_members
  for select to authenticated using ((select public.church_is_staff()));
create policy church_members_staff_update on public.church_members
  for update to authenticated using ((select public.church_is_staff()));

create policy church_attendance_staff on public.church_attendance
  for select to authenticated using ((select public.church_is_staff()));

create policy church_geofence_events_staff on public.church_geofence_events
  for select to authenticated using ((select public.church_is_staff()));

create policy church_volunteer_signups_staff on public.church_volunteer_signups
  for select to authenticated using ((select public.church_is_staff()));

create policy church_prayer_requests_staff on public.church_prayer_requests
  for select to authenticated using ((select public.church_is_staff()));
create policy church_prayer_requests_staff_update on public.church_prayer_requests
  for update to authenticated using ((select public.church_is_staff()));

create policy church_pastor_messages_staff on public.church_pastor_messages
  for select to authenticated using ((select public.church_is_staff()));
create policy church_pastor_messages_staff_update on public.church_pastor_messages
  for update to authenticated using ((select public.church_is_staff()));

create policy church_sms_log_staff on public.church_sms_log
  for select to authenticated using ((select public.church_is_staff()));

-- Staff manage the catalog
create policy church_events_staff_write on public.church_events
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));
create policy church_volunteer_roles_staff_write on public.church_volunteer_roles
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

-- Projector count without exposing rows: security definer, anon-callable,
-- returns a single integer and nothing else.
create or replace function public.church_checkin_count(p_campus_slug text, p_date date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.church_attendance
  where campus_slug = p_campus_slug and service_date = p_date;
$$;
revoke all on function public.church_checkin_count(text, date) from public;
grant execute on function public.church_checkin_count(text, date) to anon, authenticated;

-- Seed the campus
insert into public.church_campuses (slug, name, address, phone, lat, lng, fence_radius_m)
values ('lasvegas', 'GateWay City Church', '3630 N Rancho Dr #112, Las Vegas, NV 89130',
        '(702) 881-5623', 36.2162, -115.2457, 150);
