// gcc-email-events — authenticated Resend open-event webhook.
// Configure the endpoint-specific GCC_RESEND_WEBHOOK_SECRET before resuming.
import { json as gccJson, supabase } from '../_shared/gcc.ts';

function json(body, status = 200) {
  const response = gccJson(body, status);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}

// Resend/Svix verification over the unmodified request body.
// https://www.svix.com/guides/receiving/receive-webhooks-with-javascript-express/
async function verifyResendWebhook(req, raw, secret, now = Date.now()) {
  const id = req.headers.get("svix-id") || "";
  const timestamp = req.headers.get("svix-timestamp") || "";
  const signatures = req.headers.get("svix-signature") || "";
  if (!secret || !id || !/^\d+$/.test(timestamp) || !signatures) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now / 1000 - seconds) > 300) return false;
  try {
    const decode = (value) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", decode(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(id + "." + timestamp + "." + raw);
    for (const candidate of signatures.trim().split(/\s+/).slice(0, 10)) {
      const [version, signature] = candidate.split(",");
      if (version !== "v1" || !signature) continue;
      try {
        if (await crypto.subtle.verify("HMAC", key, decode(signature), signed)) return true;
      } catch { /* Ignore malformed rotation candidates, not signature verification. */ }
    }
  } catch { return false; }
  return false;
}

const MAX_BODY_BYTES = 64 * 1024;
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const secret = Deno.env.get('GCC_RESEND_WEBHOOK_SECRET') || '';
  if (!secret) return json({ error: 'webhook temporarily unavailable' }, 503);
  let raw;
  try {
    const reader = req.body?.getReader();
    if (!reader) return json({ error: 'bad request' }, 400);
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return json({ error: 'body too large' }, 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return json({ error: 'bad request' }, 400); }
  if (!await verifyResendWebhook(req, raw, secret)) return json({ error: 'unauthorized' }, 401);
  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'bad event' }, 400);
  if (payload.type !== 'email.opened') return json({ ok: true });
  const emailId = payload.data?.email_id;
  if (typeof emailId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(emailId)) return json({ error: 'bad event' }, 400);
  try {
    const { error } = await supabase.from('church_email_log')
      .update({ opened_at: new Date().toISOString() })
      .eq('resend_email_id', emailId)
      .is('opened_at', null);
    if (error) return json({ error: 'event processing unavailable' }, 503);
  } catch { return json({ error: 'event processing unavailable' }, 503); }
  return json({ ok: true });
});
