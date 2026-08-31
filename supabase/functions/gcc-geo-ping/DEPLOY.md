# gcc-geo-ping deploy

From luisocadiz-portfolio (or wherever the supabase project link lives), copy
this folder into supabase/functions/, then:

    supabase functions deploy gcc-geo-ping --no-verify-jwt
    supabase secrets set GCC_SMS_ENABLED=false        # flip to true only after 10DLC approval
    supabase secrets set GCC_TELNYX_API_KEY=...       # {SLUG}_ convention: GCC_
    supabase secrets set GCC_TELNYX_FROM=+1702XXXXXXX # church number, auto-recharge ON

Add to config.toml:

    [functions.gcc-geo-ping]
    verify_jwt = false

Requires sql/church_schema.sql applied first (geo_token column + tables).
Smoke test (no SMS while disabled):

    curl "https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-geo-ping?t=TESTTOKEN&e=enter"
