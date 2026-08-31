// Shared helpers for the gcc-* edge functions: admin client, staff auth,
// SMS (Sendblue now, Telnyx when the church's own 10DLC line exists), Resend.
// Secrets: GCC_* prefixed where per-client, account-level SENDBLUE_* reused.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

export const CAMPUS = 'lasvegas';

// Staff JWT check (gcc_admin / gcc_staff). Same pattern as gcc-ops.
export async function requireStaff(req: Request) {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data } = await supabase.auth.getUser(token);
  const role = data.user?.app_metadata?.gcc_role || data.user?.app_metadata?.role;
  if (!role || !['gcc_admin', 'gcc_staff'].includes(role)) return null;
  return { user: data.user, role };
}

// Cron caller check: pg_cron posts with the service role key as Bearer.
export function isServiceRole(req: Request) {
  const header = req.headers.get('Authorization') || '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return !!token && token === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}

export function e164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return phone.startsWith('+') ? phone : null;
}

// Same provider switch as gcc-geo-ping. GCC_SMS_ENABLED gates all sends.
export async function sendSms(to: string, text: string): Promise<string> {
  if ((Deno.env.get('GCC_SMS_ENABLED') || '').toLowerCase() !== 'true') return 'sms_disabled';
  const provider = (Deno.env.get('GCC_SMS_PROVIDER') || 'sendblue').toLowerCase();
  let res: Response;
  if (provider === 'sendblue') {
    const key = Deno.env.get('SENDBLUE_API_KEY');
    const secret = Deno.env.get('SENDBLUE_API_SECRET');
    const from = Deno.env.get('SENDBLUE_FROM_NUMBER');
    if (!key || !secret || !from) return 'sms_unconfigured';
    res = await fetch('https://api.sendblue.co/api/send-message', {
      method: 'POST',
      headers: { 'sb-api-key-id': key, 'sb-api-secret-key': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: to, from_number: from, content: text }),
    });
  } else {
    const from = Deno.env.get('GCC_TELNYX_FROM');
    const key = Deno.env.get('GCC_TELNYX_API_KEY');
    if (!from || !key) return 'sms_unconfigured';
    res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, text }),
    });
  }
  if (!res.ok) {
    console.error('[GCC] sms send failed', res.status, await res.text());
    return 'sms_failed';
  }
  return 'sms_sent';
}

export function smsFromNumber(): string | null {
  const provider = (Deno.env.get('GCC_SMS_PROVIDER') || 'sendblue').toLowerCase();
  return (provider === 'sendblue' ? Deno.env.get('SENDBLUE_FROM_NUMBER') : Deno.env.get('GCC_TELNYX_FROM')) || null;
}

// Resend via plain fetch (no SDK: edge bundler npm limits).
// Returns the Resend email id, or null on failure/disabled.
export async function sendEmail(to: string, subject: string, html: string): Promise<string | null> {
  const key = Deno.env.get('GCC_RESEND_API_KEY') || Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('GCC_RESEND_FROM');
  if (!key || !from) {
    console.error('[GCC] email unconfigured');
    return null;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    console.error('[GCC] email send failed', res.status, await res.text());
    return null;
  }
  const data = await res.json().catch(() => ({}));
  return data?.id ?? null;
}

export async function getCampus(slug: string) {
  const { data } = await supabase
    .from('church_campuses')
    .select('slug, name, address, pastor_name, pastor_phone, pastor_email')
    .eq('slug', slug)
    .maybeSingle();
  return data;
}
