-- Shared-project auth fix: some users (Luis) already carry app_metadata.role
-- for OTHER products on this Supabase project, so the Gateway role can also
-- live in app_metadata.gcc_role, which wins when present. Fresh church staff
-- accounts keep using plain role = gcc_admin / gcc_staff / gcc_kids.

create or replace function public.church_is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    coalesce(
      (select auth.jwt() -> 'app_metadata' ->> 'gcc_role'),
      (select auth.jwt() -> 'app_metadata' ->> 'role')
    ) in ('gcc_staff', 'gcc_admin'),
    false
  );
$$;

create or replace function public.church_is_kids_desk()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    coalesce(
      (select auth.jwt() -> 'app_metadata' ->> 'gcc_role'),
      (select auth.jwt() -> 'app_metadata' ->> 'role')
    ) in ('gcc_staff', 'gcc_admin', 'gcc_kids'),
    false
  );
$$;
