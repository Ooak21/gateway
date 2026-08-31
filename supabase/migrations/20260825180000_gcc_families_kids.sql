-- GateWay families, Sunday kids classes, volunteer desk roles,
-- parent notices, templates, and automations. Additive on church_*.
-- Breeze-shaped domain: families, check-in, volunteers, forms-as-templates.
-- Apply via SQL editor (do not supabase db push --include-all).

alter table public.church_members
  add column if not exists birthdate date,
  add column if not exists breeze_person_id text;

create unique index if not exists church_members_breeze_idx
  on public.church_members (breeze_person_id)
  where breeze_person_id is not null;

create or replace function public.church_is_kids_desk()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select auth.jwt() -> 'app_metadata' ->> 'role') in ('gcc_staff', 'gcc_admin', 'gcc_kids'),
    false
  );
$$;

create table public.church_families (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  name text not null,
  notes text,
  created_at timestamptz not null default now()
);
create index church_families_campus_idx
  on public.church_families (campus_slug, name);

create table public.church_family_members (
  family_id uuid not null references public.church_families(id) on delete cascade,
  member_id uuid not null references public.church_members(id) on delete cascade,
  role text not null default 'unassigned'
    check (role in ('head', 'spouse', 'adult', 'child', 'unassigned')),
  created_at timestamptz not null default now(),
  primary key (family_id, member_id)
);
create index church_family_members_member_idx
  on public.church_family_members (member_id);

create table public.church_classes (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  name text not null,
  room text,
  min_age integer not null default 0,
  max_age integer not null default 18,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index church_classes_name_idx
  on public.church_classes (campus_slug, name);

create table public.church_class_checkins (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  class_id uuid not null references public.church_classes(id),
  child_id uuid not null references public.church_members(id),
  family_id uuid references public.church_families(id),
  service_date date not null default (now() at time zone 'America/Los_Angeles')::date,
  pickup_code text not null,
  checked_in_by_name text not null default 'desk',
  checked_in_by_role text not null default 'gcc_kids',
  checked_in_at timestamptz not null default now(),
  checked_out_at timestamptz,
  parent_notified_at timestamptz
);
create unique index church_class_checkins_open_idx
  on public.church_class_checkins (child_id, service_date)
  where checked_out_at is null;
create index church_class_checkins_day_idx
  on public.church_class_checkins (campus_slug, service_date, class_id);

create table public.church_templates (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  slug text not null,
  name text not null,
  channel text not null check (channel in ('sms', 'email', 'voice')),
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campus_slug, slug)
);

create table public.church_automations (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  name text not null,
  trigger text not null check (trigger in (
    'kid_checked_in', 'kid_checked_out', 'first_visit',
    'member_arrived', 'sunday_reminder'
  )),
  template_slug text not null,
  enabled boolean not null default true,
  delay_minutes integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index church_automations_unique_idx
  on public.church_automations (campus_slug, trigger, template_slug);

create table public.church_notices (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  member_id uuid references public.church_members(id),
  child_id uuid references public.church_members(id),
  template_slug text,
  channel text not null default 'sms',
  to_phone text,
  body text not null,
  status text not null check (status in ('queued', 'sent', 'failed', 'preview')),
  created_at timestamptz not null default now()
);
create index church_notices_feed_idx
  on public.church_notices (campus_slug, created_at desc);

alter table public.church_families        enable row level security;
alter table public.church_family_members  enable row level security;
alter table public.church_classes         enable row level security;
alter table public.church_class_checkins  enable row level security;
alter table public.church_templates       enable row level security;
alter table public.church_automations     enable row level security;
alter table public.church_notices         enable row level security;

grant select on public.church_families, public.church_family_members,
  public.church_classes, public.church_class_checkins, public.church_templates,
  public.church_automations, public.church_notices to authenticated;
grant insert, update on public.church_families, public.church_family_members,
  public.church_class_checkins, public.church_templates, public.church_automations
  to authenticated;

create policy church_families_staff on public.church_families
  for select to authenticated using ((select public.church_is_kids_desk()));
create policy church_families_staff_write on public.church_families
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_family_members_desk on public.church_family_members
  for select to authenticated using ((select public.church_is_kids_desk()));
create policy church_family_members_staff_write on public.church_family_members
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_classes_desk on public.church_classes
  for select to authenticated using ((select public.church_is_kids_desk()));
create policy church_classes_staff_write on public.church_classes
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_class_checkins_desk on public.church_class_checkins
  for select to authenticated using ((select public.church_is_kids_desk()));
create policy church_class_checkins_desk_ins on public.church_class_checkins
  for insert to authenticated
  with check ((select public.church_is_kids_desk()));
create policy church_class_checkins_desk_upd on public.church_class_checkins
  for update to authenticated
  using ((select public.church_is_kids_desk()))
  with check ((select public.church_is_kids_desk()));

create policy church_templates_staff on public.church_templates
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_automations_staff on public.church_automations
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_notices_desk on public.church_notices
  for select to authenticated using ((select public.church_is_kids_desk()));

insert into public.church_classes (campus_slug, name, room, min_age, max_age)
values
  ('lasvegas', 'Nursery', 'Room 1', 0, 2),
  ('lasvegas', 'Preschool', 'Room 2', 3, 5),
  ('lasvegas', 'Elementary', 'Room 3', 6, 11),
  ('lasvegas', 'Youth', 'Room 4', 12, 17)
on conflict do nothing;

insert into public.church_templates (campus_slug, slug, name, channel, body)
values
  ('lasvegas', 'kid_checked_in', 'Kid checked in', 'sms',
   '{{child_first}} is checked into {{class_name}} ({{room}}). Pickup code {{pickup_code}}. GateWay Kids.'),
  ('lasvegas', 'kid_checked_out', 'Kid picked up', 'sms',
   '{{child_first}} was picked up from {{class_name}}. See you next Sunday. GateWay Kids.'),
  ('lasvegas', 'first_visit', 'First visit welcome', 'sms',
   'Welcome to GateWay Las Vegas, {{first_name}}. Glad you are here. Reply STOP to opt out.'),
  ('lasvegas', 'sunday_reminder', 'Saturday reminder', 'sms',
   'See you tomorrow at GateWay Las Vegas. English 10am, Spanish 1pm. 3630 N Rancho Dr.'),
  ('lasvegas', 'grace_voice_open', 'Grace voice greeting', 'voice',
   'Hi, this is Grace at GateWay Las Vegas. I can look up families, kids classes, and who is here today. What do you need?')
on conflict (campus_slug, slug) do nothing;

insert into public.church_automations (campus_slug, name, trigger, template_slug, enabled)
values
  ('lasvegas', 'Text parent when a child checks in', 'kid_checked_in', 'kid_checked_in', true),
  ('lasvegas', 'Text parent when a child is picked up', 'kid_checked_out', 'kid_checked_out', true),
  ('lasvegas', 'Welcome text on first connect', 'first_visit', 'first_visit', true),
  ('lasvegas', 'Saturday service reminder', 'sunday_reminder', 'sunday_reminder', false)
on conflict do nothing;
