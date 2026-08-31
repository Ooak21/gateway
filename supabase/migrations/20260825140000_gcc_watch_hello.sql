-- Watch-desk hello channel: viewers greet the house, staff replies,
-- optional auto-reply. Congregants never SELECT PII; they go through
-- gcc-watch-hello. Staff JWT (gcc_staff / gcc_admin) reads the feed.

create table public.church_watch_settings (
  campus_slug text primary key references public.church_campuses(slug),
  auto_reply boolean not null default true,
  auto_reply_text text not null default 'Hello from GateWay Las Vegas. Glad you are watching with us. A host will write back shortly.',
  updated_at timestamptz not null default now()
);

create table public.church_watch_threads (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  service_date date not null default (now() at time zone 'America/Los_Angeles')::date,
  display_name text not null,
  created_at timestamptz not null default now()
);
create index church_watch_threads_feed_idx
  on public.church_watch_threads (campus_slug, service_date, created_at desc);

create table public.church_watch_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.church_watch_threads(id) on delete cascade,
  campus_slug text not null references public.church_campuses(slug),
  role text not null check (role in ('viewer', 'staff', 'auto')),
  display_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index church_watch_messages_thread_idx
  on public.church_watch_messages (thread_id, created_at);

alter table public.church_watch_settings enable row level security;
alter table public.church_watch_threads  enable row level security;
alter table public.church_watch_messages enable row level security;

grant select, update on public.church_watch_settings to authenticated;
grant select on public.church_watch_threads to authenticated;
grant select, insert on public.church_watch_messages to authenticated;

create policy church_watch_settings_staff on public.church_watch_settings
  for select to authenticated using ((select public.church_is_staff()));
create policy church_watch_settings_staff_update on public.church_watch_settings
  for update to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_watch_threads_staff on public.church_watch_threads
  for select to authenticated using ((select public.church_is_staff()));

create policy church_watch_messages_staff on public.church_watch_messages
  for select to authenticated using ((select public.church_is_staff()));
create policy church_watch_messages_staff_insert on public.church_watch_messages
  for insert to authenticated
  with check ((select public.church_is_staff()) and role = 'staff');

insert into public.church_watch_settings (campus_slug)
values ('lasvegas')
on conflict (campus_slug) do nothing;
