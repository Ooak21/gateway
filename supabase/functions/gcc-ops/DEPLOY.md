# gcc-ops + gcc-grace-voice

Breeze-shaped church ops for GateWay Las Vegas: families, Sunday kids check-in, volunteer desk roles, parent SMS notices, templates, automations, Grace voice.

## Apply schema

Run `supabase/migrations/20260825180000_gcc_families_kids.sql` in the SQL editor on `jtifhcvbgxqwlywugvjv`. Do not `supabase db push --include-all`.

## Deploy functions

```
supabase functions deploy gcc-ops --no-verify-jwt
supabase functions deploy gcc-grace-voice --no-verify-jwt
```

`config.toml` already has `verify_jwt = false` for both. The functions still require a staff JWT (`gcc_admin`, `gcc_staff`, or `gcc_kids`) in the Authorization header.

## Secrets already used by gcc-geo-ping

- `GCC_SMS_ENABLED=true` to actually send parent texts
- `GCC_SMS_PROVIDER=sendblue` (or telnyx)
- `SENDBLUE_API_KEY`, `SENDBLUE_API_SECRET`, `SENDBLUE_FROM_NUMBER`
- `XAI_API_KEY` or `GCC_XAI_API_KEY` for Grace voice (Ara)

## Roles

Seed Auth users with `app_metadata.role`:

- `gcc_admin` / `gcc_staff` — full Grace people file
- `gcc_kids` — Kids desk only (check-in / pickup). Cannot open prayer, inbox, or automations.

Until those users exist, use `app/staff.html?preview=1` and `app/kids.html?preview=1`.
