# gcc-service-blast deploy

    supabase functions deploy gcc-service-blast --no-verify-jwt
    # config.toml: [functions.gcc-service-blast] verify_jwt = false

Schedule with pg_cron (times are UTC; Vegas is UTC-7/-8 — adjust at DST).
Example for Sunday 10:00 AM + 1:00 PM services, PDT (UTC-7):

    select cron.schedule('gcc-welcome-10am', '55 16 * * 0', $$
      select net.http_post(
        url := 'https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-service-blast',
        headers := jsonb_build_object('Authorization', 'Bearer ' || '<SERVICE_ROLE_KEY>', 'Content-Type', 'application/json'),
        body := '{"kind":"welcome","campus":"lasvegas"}'::jsonb
      );
    $$);
    -- goodbye ~11:45 AM: '45 18 * * 0'
    -- Spanish service welcome 12:55 PM: '55 19 * * 0', goodbye 2:45 PM: '45 21 * * 0'

Gate: 10DLC approval + GCC_SMS_ENABLED=true + auto-recharge ON. Until all
three, the function no-ops safely.
