# Gateway — Reference

Source of truth for the consolidated GateWay City Church build. 2026-08-31.

## 1. Overview

One repo, IBS-owned end to end. Three surfaces over one Supabase backend:

| Surface | Path | Who |
|---|---|---|
| Public site (video hero, Watch, Grow Tracks, prayer chat) | `/index.html` | Everyone |
| Congregant PWA (check-in, geofence, events, volunteer, prayer) + connection card | `/app/` | Congregants + visitors, no login |
| Grace CRM (people file, visitors, families, kids desk, automations, voice) | `/crm/` | Staff, Supabase Auth login |

Church facts: 3630 N Rancho Dr, Las Vegas · (702) 881-5623 · Sundays 10 AM
English, 1 PM Español, Wednesdays 7 PM · Pastors Danny Hand, Paul, Fred.

## 2. Backend (shared IBS Supabase `jtifhcvbgxqwlywugvjv`)

Tenancy: every table carries `campus_slug` referencing `church_campuses`
(`lasvegas` seeded). Pastor contact lives on the campus row
(`pastor_name/phone/email`), driving new-visitor alerts, urgency alerts, and
the prayer digest.

**Migrations** (`supabase/migrations/`, apply in order via the SQL editor):
1. `20260823120000_gcc_church_schema.sql` — APPLIED LIVE. Members, attendance,
   geofence, events, volunteers, prayer, pastor messages, sms_log,
   `church_is_staff()`.
2. `20260825140000_gcc_watch_hello.sql` — not applied. Watch hello desk.
3. `20260825180000_gcc_families_kids.sql` — not applied. Families, classes,
   check-ins, templates, automations, notices, `church_is_kids_desk()`.
4. `20260831100000_gcc_visitor_crm.sql` — not applied. Visitor CRM: visitors,
   visitor attendance, email log, SMS threads/messages, notes, pastor columns
   on campuses, staff-only RLS, pg_cron notes for gcc-followup.

RLS model: anon inserts intake rows only and reads the public catalog; staff
roles read/write; nothing uses `using (true)`. Visitor intake goes through
gcc-grace (service role), not PostgREST.

**Edge functions** (`supabase/functions/`, all `verify_jwt=false`, JWT checked
inside):

| Function | Status | Job |
|---|---|---|
| gcc-geo-ping | LIVE | Shortcut arrival/exit pings, welcome/goodbye SMS |
| gcc-service-blast | LIVE | Sunday welcome/goodbye blast (pg_cron) |
| gcc-sms-inbound | LIVE (needs redeploy) | Sendblue receive: JOIN/STOP + NEW visitor thread logging + Claude urgency triage + pastor alert |
| gcc-youtube-feed | LIVE | Last 5 services for the Watch reel |
| gcc-watch-hello | not deployed | Watch hello desk backend |
| gcc-ops | not deployed | Families, kids check-in, templates, automations |
| gcc-grace-voice | not deployed | xAI realtime token + voice search (proxies gcc-grace nlsearch, falls back to gcc-ops keyword) |
| gcc-grace | NEW, not deployed | Visitor intake, nlsearch (Claude Haiku), insight, suggest replies, manual email, SMS replies |
| gcc-followup | NEW, not deployed | Cron jobs: day-3 + day-6 follow-ups, Monday prayer digest |
| gcc-email-events | NEW, not deployed | Resend webhook: opened tracking |

Shared code in `supabase/functions/_shared/`: `gcc.ts` (client, staff auth,
SMS provider switch, Resend), `grace.ts` (all Claude prompts, ported verbatim
from the GroundworkHQ build), `emails.ts` (email templates).

## 3. Grace

Text brain: Claude. `claude-sonnet-5` for judgment calls (drafts, insight,
urgency triage), `claude-haiku-4-5` for nlsearch (the latency path serving
both the typed dock and the voice search tool). All output strips em dashes.
Voice: xAI Grok realtime, voice `Ara` (case-sensitive), token minted by
gcc-grace-voice; voice search goes through the same nlsearch brain, so text
and voice cannot drift. No crisis/DV net in Grace itself, deliberately: Grace
serves staff. Congregant-facing crisis handling lives in the PWA prayer flow
(hard 911/988 gate) and in gcc-sms-inbound urgency triage.

## 4. The visitor lifecycle (works the way Miguel's build did)

1. `app/connect.html` posts intake to gcc-grace: dedupe by phone/email, log
   attendance, Claude-personalized welcome email via Resend, pastor SMS alert.
2. Day 3 and day 6: gcc-followup sends Claude-personalized email 2 and 3 plus
   SMS, logged to the thread. Cadence unchanged (09:00 UTC daily, digest
   Mondays 08:00 UTC).
3. Inbound texts land in gcc-sms-inbound, log to the visitor thread, get
   urgency-triaged; emergencies text the pastor immediately.
4. Staff work visitors in `crm/staff.html` > Visitors: insight card, notes
   with tags, email + SMS desks with Grace-suggested replies, visit logging,
   opt-out respected everywhere.

## 5. Environment (Supabase function secrets)

Set: `GCC_SMS_ENABLED`, `GCC_SMS_PROVIDER=sendblue`, `SENDBLUE_API_KEY/SECRET/FROM_NUMBER`.
Needed for the new functions: `GCC_ANTHROPIC_API_KEY` (falls back to
`ANTHROPIC_API_KEY`), `GCC_XAI_API_KEY` (falls back to `XAI_API_KEY`),
`GCC_RESEND_API_KEY` (falls back to `RESEND_API_KEY`), `GCC_RESEND_FROM`
(sender, e.g. `GateWay City Church <...>`), `GCC_PASTOR_EMAIL` (digest
fallback). Later: `GCC_TELNYX_API_KEY` + `GCC_TELNYX_FROM` when the church's
own 10DLC line exists; Breeze creds (`BREEZE_SUBDOMAIN` + `BREEZE_API_KEY`)
if/when the church hands them over — Breeze calls go through a server-side
proxy only, never a browser.

## 6. Go-live checklist (in order)

1. Create the GitHub repo, push, enable Pages.
2. Apply migrations 2, 3, 4 in the SQL editor.
3. Set the missing secrets (§5).
4. Deploy: gcc-grace, gcc-followup, gcc-email-events, gcc-grace-voice,
   gcc-ops, gcc-watch-hello, and REdeploy gcc-sms-inbound — all
   `--no-verify-jwt`, from THIS repo.
5. Schedule the two pg_cron jobs (SQL in migration 4's footer).
6. Point the Resend webhook (email.opened) at gcc-email-events.
7. Seed staff Auth users (`app_metadata.role`: gcc_admin / gcc_staff /
   gcc_kids).
8. Host `assets/august-2-2026.mp4` (gitignored) or accept a hero without the
   clip on the deployed site.
9. Smoke: connect card end to end, Visitors tab live, Grace dock nlsearch,
   voice token.

## 7. Open decisions

- Custom domain (`app.mygatewaycity.church`) vs github.io + QR reprint.
- Whether the public site should link to `app/connect.html` (site copy is
  Luis's presentation build; do not touch without direction).
- Telnyx 702 + auto-recharge vs staying on Sendblue (proposal line item).
- Sendblue receive webhook still single-target; gcc-sms-inbound owns it.
