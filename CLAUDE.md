# Gateway — Claude Code context

## What this is
Everything GateWay City Church (Las Vegas), consolidated into ONE IBS-owned repo
on 2026-08-31. Supersedes: `GroundworkHQ/gateway-city-church` (Miguel's Next.js
Grace on his Vercel + his Supabase — replaced entirely), the old
`Ooak21/gateway-city-church` PWA repo layout, and the loose files in
`~/Desktop/gateway-build/`. Nobody's keys but ours.

**`docs/REFERENCE.md` is the source of truth.** Read it before working here.

## Layout
- `index.html` + `grow-tracks.html` + `gateway-prayer-chat.js` — public site
  (the cinematic video-hero build). `assets/august-2-2026.mp4` is gitignored;
  host it or carry it by hand.
- `app/` — congregant PWA: check-in, geofence, events, volunteer, prayer,
  pastor messages, `connect.html` visitor connection card.
- `crm/` — Grace staff surfaces: `staff.html` people file (members, visitors,
  families, kids, automations, Watch hellos, Grace dock), `kids.html` volunteer
  desk, `login.html` + `auth.js` (roles `gcc_admin` / `gcc_staff` / `gcc_kids`
  in `app_metadata.role`).
- `supabase/` — canonical home for ALL gcc-* migrations + edge functions.
  The copies in `luisocadiz-portfolio/supabase/` are superseded; deploy from
  here only.

## Stack
Static HTML/JS (no build step) + Supabase (shared IBS project
`jtifhcvbgxqwlywugvjv`, `church_*` tables, campus_slug tenancy, real RLS) +
edge functions. AI: Anthropic Claude (Grace text brain: Sonnet + Haiku for
nlsearch) and xAI Grok realtime (voice "Ara"). Email: Resend. SMS: Sendblue
now, Telnyx 10DLC later (`GCC_SMS_PROVIDER`).

## Rules
- Root `/Users/luisocadiz/CLAUDE.md` rules apply, especially: `verify_jwt=false`
  is deliberate (rule 4), single-author commits (rule 1), no redesigns without
  direction (rule 8).
- Migrations go in via the SQL editor or `supabase db query --linked --file`,
  never `supabase db push --include-all` (old counsel history breaks it).
- Syntax-check every inline `<script>` block separately AND runtime-drive UI
  changes in headless Chrome before shipping.
- Geofence is settled: Apple Shortcuts + gcc-geo-ping + Sunday blast. Never
  propose scan-triggers, store apps, Wi-Fi presence, or plate cams.
- Secrets are `GCC_`-prefixed Supabase function secrets. Never in source.
