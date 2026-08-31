-- GateWay City Church visitor CRM (Grace) on the IBS shared Supabase project.
-- Ports the GroundworkHQ Grace data layer onto our campus_slug tenancy with
-- real RLS. Replaces Miguel's schema, which had `using (true)` on every table
-- so anon could read all visitor PII. Here congregant intake goes through the
-- gcc-visitors edge function (service role); anon touches nothing directly.
--
-- Access model, same as 20260823120000_gcc_church_schema.sql:
--   * anon: no access to any table in this file.
--   * staff (app_metadata.role gcc_staff/gcc_admin): read + write via PostgREST.
--   * kids desk (gcc_kids): no visitor CRM access.
--
-- Apply in the SQL editor (supabase db push breaks on old counsel history).

-- Pastor contact lives on the campus (was churches.pastor_* in Miguel's schema):
-- drives the new-visitor SMS alert, urgency alerts, and the prayer digest.
alter table public.church_campuses add column if not exists pastor_name text;
alter table public.church_campuses add column if not exists pastor_phone text;
alter table public.church_campuses add column if not exists pastor_email text;
update public.church_campuses set pastor_name = 'Pastor Danny Hand' where slug = 'lasvegas' and pastor_name is null;

-- Visitors (connection card intake)
create table public.church_visitors (
  id uuid primary key default gen_random_uuid(),
  campus_slug text not null references public.church_campuses(slug),
  name text not null,
  phone text,
  email text,
  how_heard text,
  prayer_request text,
  service_preference text,                       -- english | spanish
  is_returning boolean not null default false,
  email_1_sent_at timestamptz,                   -- welcome (same day)
  email_2_sent_at timestamptz,                   -- follow-up (day 3)
  email_3_sent_at timestamptz,                   -- Sunday invite (day 6)
  opted_out boolean not null default false,
  phone_e164 text,                               -- normalized at intake; inbound SMS matches on this
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index church_visitors_campus_idx on public.church_visitors (campus_slug, created_at desc);
create index church_visitors_phone_idx on public.church_visitors (phone) where phone is not null;
create index church_visitors_phone_e164_idx on public.church_visitors (phone_e164) where phone_e164 is not null;
create index church_visitors_email_idx on public.church_visitors (email) where email is not null;

-- Visitor attendance. Named church_visitor_attendance because church_attendance
-- (member/geofence check-ins) already exists and has a different shape.
create table public.church_visitor_attendance (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.church_visitors(id) on delete cascade,
  campus_slug text not null references public.church_campuses(slug),
  service_type text,                             -- english | spanish
  visited_at timestamptz not null default now()
);
create index church_visitor_attendance_visitor_idx on public.church_visitor_attendance (visitor_id, visited_at desc);

-- Outbound/inbound email log (Resend)
create table public.church_email_log (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.church_visitors(id) on delete cascade,
  email_type text not null check (email_type in ('welcome_1', 'followup_2', 'followup_3', 'manual')),
  subject text,
  body text,
  direction text not null default 'outbound' check (direction in ('inbound', 'outbound')),
  sent_at timestamptz not null default now(),
  opened_at timestamptz,
  resend_email_id text
);
create index church_email_log_visitor_idx on public.church_email_log (visitor_id, sent_at desc);
create index church_email_log_resend_idx on public.church_email_log (resend_email_id) where resend_email_id is not null;

-- SMS threads: one per visitor
create table public.church_sms_threads (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.church_visitors(id) on delete cascade,
  campus_slug text not null references public.church_campuses(slug),
  created_at timestamptz not null default now()
);
create unique index church_sms_threads_visitor_idx on public.church_sms_threads (visitor_id);

create table public.church_sms_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.church_sms_threads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  from_number text,
  to_number text,
  provider_message_id text,                      -- Sendblue/Telnyx message id
  sent_at timestamptz not null default now()
);
create index church_sms_messages_thread_idx on public.church_sms_messages (thread_id, sent_at);

-- Staff notes on a visitor (tag 'urgent' rows come from SMS triage,
-- 'connected-with-pastor' rows count as logged calls)
create table public.church_visitor_notes (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.church_visitors(id) on delete cascade,
  body text not null,
  tag text,
  created_at timestamptz not null default now()
);
create index church_visitor_notes_visitor_idx on public.church_visitor_notes (visitor_id, created_at desc);

-- RLS: staff-only, no using(true), no anon
alter table public.church_visitors           enable row level security;
alter table public.church_visitor_attendance enable row level security;
alter table public.church_email_log          enable row level security;
alter table public.church_sms_threads        enable row level security;
alter table public.church_sms_messages       enable row level security;
alter table public.church_visitor_notes      enable row level security;

create policy church_visitors_staff on public.church_visitors
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_visitor_attendance_staff on public.church_visitor_attendance
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_email_log_staff on public.church_email_log
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_sms_threads_staff on public.church_sms_threads
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_sms_messages_staff on public.church_sms_messages
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

create policy church_visitor_notes_staff on public.church_visitor_notes
  for all to authenticated
  using ((select public.church_is_staff()))
  with check ((select public.church_is_staff()));

-- Cron parity with the Vercel deployment (times were UTC there too):
-- follow-up daily 09:00 UTC, prayer digest Mondays 08:00 UTC.
-- Run these AFTER gcc-followup is deployed, with the real service role key:
--
--   select cron.schedule('gcc-followup-daily', '0 9 * * *', $$
--     select net.http_post(
--       url := 'https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-followup',
--       headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
--       body := '{"job":"follow_up"}'::jsonb
--     );
--   $$);
--
--   select cron.schedule('gcc-prayer-digest-weekly', '0 8 * * 1', $$
--     select net.http_post(
--       url := 'https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-followup',
--       headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
--       body := '{"job":"prayer_digest"}'::jsonb
--     );
--   $$);
