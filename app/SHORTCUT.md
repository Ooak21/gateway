# The Gateway Welcome / Goodbye Apple Shortcuts (Door 1, true arrival detection)

FINAL DESIGN (2026-08-22, simplified after build): the shortcut is TWO actions
and the member pastes their full personal link, not a code.

## Structure (both shortcuts)

1. **Text** action — placeholder content:
   `https://jtifhcvbgxqwlywugvjv.supabase.co/functions/v1/gcc-geo-ping?t=CODE&e=enter`
   (goodbye version ends `&e=exit`)
2. **Get Contents of URL** — auto-wired to the Text variable ("Get contents of Text").
3. Import question (i -> Setup -> Add Import Question) on the Text action:
   - Welcome prompt: "Paste your welcome link from the GateWay app"
   - Goodbye prompt: "Paste your goodbye link from the GateWay app"
   - Default answer: BLANK. Never customize link answers (one member's link
     would check in the whole congregation).

The app's Auto-welcome card gives every member "Copy welcome link" /
"Copy goodbye link" buttons (their geo_token baked in), so the paste is
one tap from the app.

## Share

Long-press each shortcut -> Share -> Copy iCloud Link. Links are SNAPSHOTS:
every edit needs a fresh share, and the new link goes into gcc-config.js
SHORTCUT_URL (welcome) + the setup copy (goodbye).

## Member setup (guided by the app card)

1. Tap "Copy welcome link" in the app -> add the Welcome shortcut -> paste.
2. Shortcuts -> Automation -> New -> Arrive -> church address -> Run
   Immediately -> run Gateway Welcome.
3. Repeat with Leave + goodbye link + Gateway Goodbye.

## Gotchas learned building it

- Typing/pasting a URL directly into Get Contents of URL's field alongside a
  variable causes "couldn't convert from Rich Text to URL". The Text-action
  pass-through avoids it entirely.
- iCloud links freeze the shortcut at share time. Broken first share:
  https://www.icloud.com/shortcuts/44b330a911ef492fb40830741d4a6ccd (dead, do not distribute).
