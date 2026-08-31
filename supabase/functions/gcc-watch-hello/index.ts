// gcc-watch-hello — viewer greets the house; staff replies; optional auto-reply.
//
// POST { action: 'hello', campus, name, body }
// POST { action: 'poll', thread_id }
// POST { action: 'staff_reply', thread_id, body }   // staff JWT
// POST { action: 'feed', campus }                  // staff JWT
// POST { action: 'settings', campus, auto_reply?, auto_reply_text? } // staff JWT
//
// Deploy: supabase functions deploy gcc-watch-hello --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const DEFAULT_AUTO =
  'Hello from GateWay Las Vegas. Glad you are watching with us. A host will write back shortly.';

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

function cleanName(s: unknown) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
function cleanBody(s: unknown) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 280);
}

async function requireStaff(req: Request) {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  const role = data.user?.app_metadata?.role;
  if (role === 'gcc_staff' || role === 'gcc_admin') return data.user;
  return null;
}

async function threadMessages(threadId: string) {
  const { data } = await supabase
    .from('church_watch_messages')
    .select('id, role, display_name, body, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  return data || [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const body = await req.json().catch(() => ({}));
  const action = body.action;

  if (action === 'hello') {
    const campus = body.campus === 'lasvegas' ? 'lasvegas' : '';
    const name = cleanName(body.name);
    const text = cleanBody(body.body) || 'Hello';
    if (!campus || !name) return json({ error: 'name required' }, 400);

    const since = new Date(Date.now() - 20_000).toISOString();
    const { data: recent } = await supabase
      .from('church_watch_threads')
      .select('id')
      .eq('campus_slug', campus)
      .eq('display_name', name)
      .gte('created_at', since)
      .limit(1);
    if (recent && recent.length) {
      const messages = await threadMessages(recent[0].id);
      return json({ thread_id: recent[0].id, messages, deduped: true });
    }

    const { data: thread, error: tErr } = await supabase
      .from('church_watch_threads')
      .insert({ campus_slug: campus, display_name: name })
      .select('id')
      .single();
    if (tErr || !thread) {
      console.error('[gcc-watch-hello] thread', tErr);
      return json({ error: 'could not start' }, 500);
    }
    await supabase.from('church_watch_messages').insert({
      thread_id: thread.id,
      campus_slug: campus,
      role: 'viewer',
      display_name: name,
      body: text,
    });

    const { data: settings } = await supabase
      .from('church_watch_settings')
      .select('auto_reply, auto_reply_text')
      .eq('campus_slug', campus)
      .maybeSingle();
    if (settings?.auto_reply !== false) {
      await supabase.from('church_watch_messages').insert({
        thread_id: thread.id,
        campus_slug: campus,
        role: 'auto',
        display_name: 'GateWay Las Vegas',
        body: settings?.auto_reply_text || DEFAULT_AUTO,
      });
    }

    return json({ thread_id: thread.id, messages: await threadMessages(thread.id) });
  }

  if (action === 'poll') {
    const threadId = String(body.thread_id || '');
    if (!threadId) return json({ error: 'thread_id required' }, 400);
    const { data: thread } = await supabase
      .from('church_watch_threads')
      .select('id')
      .eq('id', threadId)
      .maybeSingle();
    if (!thread) return json({ error: 'not found' }, 404);
    return json({ thread_id: threadId, messages: await threadMessages(threadId) });
  }

  if (action === 'feed' || action === 'staff_reply' || action === 'settings') {
    const staff = await requireStaff(req);
    if (!staff) return json({ error: 'unauthorized' }, 401);
  }

  if (action === 'feed') {
    const campus = body.campus === 'lasvegas' ? 'lasvegas' : 'lasvegas';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
    const { data: threads } = await supabase
      .from('church_watch_threads')
      .select('id, display_name, created_at, service_date')
      .eq('campus_slug', campus)
      .eq('service_date', today)
      .order('created_at', { ascending: false })
      .limit(80);
    const ids = (threads || []).map((t) => t.id);
    let messages: Awaited<ReturnType<typeof threadMessages>> = [];
    if (ids.length) {
      const { data } = await supabase
        .from('church_watch_messages')
        .select('id, thread_id, role, display_name, body, created_at')
        .in('thread_id', ids)
        .order('created_at', { ascending: true });
      messages = data || [];
    }
    const { data: settings } = await supabase
      .from('church_watch_settings')
      .select('auto_reply, auto_reply_text')
      .eq('campus_slug', campus)
      .maybeSingle();
    return json({
      threads: threads || [],
      messages,
      auto_reply: settings?.auto_reply !== false,
      auto_reply_text: settings?.auto_reply_text || DEFAULT_AUTO,
    });
  }

  if (action === 'staff_reply') {
    const threadId = String(body.thread_id || '');
    const text = cleanBody(body.body);
    if (!threadId || !text) return json({ error: 'thread_id and body required' }, 400);
    const { data: thread } = await supabase
      .from('church_watch_threads')
      .select('id, campus_slug')
      .eq('id', threadId)
      .maybeSingle();
    if (!thread) return json({ error: 'not found' }, 404);
    await supabase.from('church_watch_messages').insert({
      thread_id: threadId,
      campus_slug: thread.campus_slug,
      role: 'staff',
      display_name: 'Host',
      body: text,
    });
    return json({ thread_id: threadId, messages: await threadMessages(threadId) });
  }

  if (action === 'settings') {
    const campus = body.campus === 'lasvegas' ? 'lasvegas' : 'lasvegas';
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.auto_reply === 'boolean') patch.auto_reply = body.auto_reply;
    if (typeof body.auto_reply_text === 'string' && body.auto_reply_text.trim()) {
      patch.auto_reply_text = cleanBody(body.auto_reply_text) || DEFAULT_AUTO;
    }
    await supabase.from('church_watch_settings').upsert({
      campus_slug: campus,
      auto_reply: typeof body.auto_reply === 'boolean' ? body.auto_reply : true,
      auto_reply_text: typeof body.auto_reply_text === 'string'
        ? (cleanBody(body.auto_reply_text) || DEFAULT_AUTO)
        : DEFAULT_AUTO,
      ...patch,
    });
    const { data: settings } = await supabase
      .from('church_watch_settings')
      .select('auto_reply, auto_reply_text')
      .eq('campus_slug', campus)
      .maybeSingle();
    return json({
      auto_reply: settings?.auto_reply !== false,
      auto_reply_text: settings?.auto_reply_text || DEFAULT_AUTO,
    });
  }

  return json({ error: 'unknown action' }, 400);
});
