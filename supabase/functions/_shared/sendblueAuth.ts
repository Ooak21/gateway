// Sendblue receive-webhook authentication. Configure the same per-webhook secret
// at Sendblue and as SENDBLUE_WEBHOOK_SECRET before deploying the caller.
// https://docs.sendblue.com/security/
export async function verifySendblueWebhook(req: Request, secret: string): Promise<boolean> {
  const provided = req.headers.get('sb-signing-secret') || '';
  if (!secret || !provided || provided.length > 1024) return false;
  const enc = new TextEncoder();
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(secret)),
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
  ]);
  const a = new Uint8Array(expected), b = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
