# gcc-sms-inbound deploy

    supabase functions deploy gcc-sms-inbound --no-verify-jwt
    # config.toml: [functions.gcc-sms-inbound] verify_jwt = false
    sendblue webhooks add https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-sms-inbound --type receive

## ⚠ WEBHOOK COLLISION CHECK (do this FIRST)

The Sendblue account's receive webhook currently feeds **ibs-giveaway-sms**.
Before registering, confirm with `sendblue webhooks list` (or GET /api/lines)
whether the CLI supports MULTIPLE receive webhooks:

- If yes: register and both flows coexist (each function ignores messages
  it doesn't recognize).
- If it REPLACES the existing webhook: do NOT register directly. Either
  (a) point the webhook at gcc-sms-inbound and have it forward unmatched
  messages to ibs-giveaway-sms, or (b) retire the giveaway hook if that
  event is over (check with Luis — never assume).

## Flow
Member taps "Text us to turn on messages" in the app -> prefilled
"JOIN <code>" -> this webhook: stamps phone_e164 + sms_opened_at +
sms_opt_in, replies welcome-aboard. STOP opts out. From then on
gcc-geo-ping and gcc-service-blast can reach them on Sendblue.

## Sendblue plan limits that shape the church proposal
- AI Agent plan: outbound ONLY to contacts who texted first (the JOIN step),
  ~200 follow-ups/day/line, 1 msg/sec. Fine for demo + staff pilot.
- Full congregation Sunday blasts need the church's own line: either a
  dedicated Sendblue line (~$100/mo, iMessage blue bubble) or a Telnyx
  10DLC number (cheaper, SMS only). Both are hard costs for the proposal.
