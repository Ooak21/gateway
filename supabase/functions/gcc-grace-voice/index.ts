// gcc-grace-voice — short-lived xAI realtime token for Grace (staff + kids desk).
// Same pattern as meg-voice-token / vit-voice-token / Miguel's /api/grace/realtime-token.
// POST { action: 'token' } -> { token, voice, instructions }
// POST { action: 'search', query, campus } with staff JWT -> spoken answer
//
// Deploy: supabase functions deploy gcc-grace-voice --no-verify-jwt
// Secrets: XAI_API_KEY (or GCC_XAI_API_KEY), plus gcc-ops auth for search.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const XAI_API_KEY = Deno.env.get('GCC_XAI_API_KEY') || Deno.env.get('XAI_API_KEY') || '';
const GRACE_VOICE = 'Ara';

const GRACE_VOICE_PROMPT = `You are Grace, the AI assistant for GateWay City Church Las Vegas staff. You are on a voice call with a pastor, staff member, or kids-ministry volunteer.

You can look up families, children, Sunday class attendance, pickup codes, prayer, and who is in the house by calling search_church. Whenever they ask about a person, a family, a class, who is checked in, or a pickup code, call search_church. Do not guess names from memory.

You also know the Bible. Scripture and theology questions you answer directly. Do not call search_church for those.

HOW YOU TALK
- Warm, calm, practical. You serve pastors and volunteers in a busy hallway.
- Keep spoken replies to one or two sentences.
- Never use dashes of any kind as a pause. Use a comma or a period.
- Never mention JSON, IDs, or field names.
- If a lookup returns nothing, say so and offer another search.

If it is the start of the call, greet them in one short sentence and ask what they need.`;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

async function requireDesk(req: Request) {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  const role = data.user?.app_metadata?.role;
  if (!role || !['gcc_admin', 'gcc_staff', 'gcc_kids'].includes(role)) return null;
  return { user: data.user, role };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const desk = await requireDesk(req);
  if (!desk) return json({ error: 'staff required' }, 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || 'token');

  if (action === 'token') {
    if (!XAI_API_KEY) return json({ error: 'voice is not configured yet' }, 500);
    const r = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expires_after: { seconds: 600 } }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[gcc-grace-voice]', detail);
      return json({ error: 'could not start voice' }, 502);
    }
    const data = await r.json();
    return json({
      token: data.value,
      expires_at: data.expires_at,
      voice: GRACE_VOICE,
      instructions: GRACE_VOICE_PROMPT,
    });
  }

  if (action === 'search') {
    const url = Deno.env.get('SUPABASE_URL') + '/functions/v1/gcc-ops';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.get('Authorization') || '',
        apikey: Deno.env.get('SUPABASE_ANON_KEY') || '',
      },
      body: JSON.stringify({ action: 'search', campus: body.campus || 'lasvegas', query: body.query || '' }),
    });
    const data = await r.json().catch(() => ({}));
    return json(data, r.status);
  }

  return json({ error: 'unknown action' }, 400);
});
