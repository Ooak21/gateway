// Grace's text brain, ported verbatim from GroundworkHQ lib/claude.ts onto
// plain fetch (no SDK: edge bundler npm limits). Prompts unchanged. All output
// strips em dashes. Model split unchanged: Sonnet for judgment calls, Haiku
// for the latency-sensitive nlsearch path (text chat + voice search tool).

export interface VisitorContext {
  name: string;
  prayerRequest?: string | null;
  howHeard?: string | null;
  servicePreference?: string | null;
  isReturning?: boolean;
  churchName: string;
}

interface FollowUpContent {
  emailParagraphs: string;
  smsBody: string;
}

const HOW_HEARD_LABELS: Record<string, string> = {
  friend: 'a friend or family member',
  social_media: 'social media',
  google: 'a Google search',
  drove_by: 'driving by',
  other: 'word of mouth',
};

function visitorContextLines(visitor: VisitorContext): string {
  const howHeard = visitor.howHeard ? HOW_HEARD_LABELS[visitor.howHeard] ?? visitor.howHeard : null;
  const service = visitor.servicePreference === 'spanish' ? 'Spanish' : 'English';
  return [
    `Visitor first name: ${visitor.name.split(' ')[0]}`,
    visitor.isReturning ? 'This is a returning visitor (has been before).' : 'This is a first-time visitor.',
    howHeard ? `They found the church through ${howHeard}.` : null,
    `They attended the ${service} service.`,
    visitor.prayerRequest ? `They shared this prayer request: "${visitor.prayerRequest}"` : 'They did not share a prayer request.',
  ].filter(Boolean).join('\n');
}

const DEFAULT_MODEL = 'claude-sonnet-5';

async function callClaude(prompt: string, maxTokens = 512, model: string = DEFAULT_MODEL): Promise<string | null> {
  const apiKey = Deno.env.get('GCC_ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('[grace] no anthropic key');
    return null;
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        // On Sonnet, adaptive thinking is ON by default and would consume the
        // small max_tokens budgets, truncating the JSON. Haiku defaults to no
        // thinking, so only disable it off-Haiku.
        ...(model.startsWith('claude-haiku') ? {} : { thinking: { type: 'disabled' } }),
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) {
      console.error('[grace] claude call failed', res.status, await res.text());
      return null;
    }
    const message = await res.json();
    const text = message?.content?.[0]?.type === 'text' ? message.content[0].text : null;
    return text?.replace(/—/g, '-') ?? null;
  } catch {
    return null;
  }
}

// Follow-up emails 2 & 3

function buildFollowUpPrompt(followUpNumber: 2 | 3, visitor: VisitorContext): string {
  const firstName = visitor.name.split(' ')[0];
  const context = visitorContextLines(visitor);

  if (followUpNumber === 2) {
    return `You are Pastor Danny at Gateway City Church in Las Vegas. Write a warm, personal follow-up to a visitor who came to church 3 days ago. This should feel like a genuine personal message, not a mass email. Do not use em dashes.

Visitor context:
${context}

Write TWO versions:

1. EMAIL BODY: 2-3 short paragraphs in plain HTML <p> tags. Warm and personal. If they shared a prayer request, acknowledge it specifically and warmly, don't be generic. End by inviting them back. Sign off is handled separately, do not include it. Keep it under 100 words total.

2. SMS: A single conversational text message under 160 characters. Warm, casual. If they had a prayer request, briefly acknowledge it. Do NOT include a sign-off or "Pastor Danny", that's added separately.

Respond in this exact JSON format:
{"emailParagraphs": "<p>...</p><p>...</p>", "smsBody": "..."}`;
  }

  return `You are Pastor Danny at Gateway City Church in Las Vegas. Write a warm, personal Sunday invitation to ${firstName} who visited 6 days ago. Tomorrow is Sunday and you want them to come back. This should feel genuinely personal. Do not use em dashes.

Visitor context:
${context}

Write TWO versions:

1. EMAIL BODY: 2-3 short paragraphs in plain HTML <p> tags. Reference something specific about their visit or prayer request if they had one. End with a clear, warm invitation to come back tomorrow. Sign off is handled separately, do not include it. Keep it under 100 words total.

2. SMS: A single conversational text message under 160 characters. Warm, Sunday-invite energy. If they had a prayer request, acknowledge it briefly. Do NOT include a sign-off, that's added separately.

Respond in this exact JSON format:
{"emailParagraphs": "<p>...</p><p>...</p>", "smsBody": "..."}`;
}

export async function generateFollowUp(followUpNumber: 2 | 3, visitor: VisitorContext): Promise<FollowUpContent | null> {
  try {
    const text = await callClaude(buildFollowUpPrompt(followUpNumber, visitor));
    if (!text) return null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.emailParagraphs || !parsed.smsBody) return null;
    return parsed as FollowUpContent;
  } catch {
    return null;
  }
}

// Welcome email personalization (email 1)

export async function generateWelcomeEmail(visitor: VisitorContext): Promise<string | null> {
  const firstName = visitor.name.split(' ')[0];
  const context = visitorContextLines(visitor);

  const prompt = `You are Pastor Danny at Gateway City Church in Las Vegas. Write a warm, personal welcome email to someone who just attended church for the first time today. Do not use em dashes.

Visitor context:
${context}

Write the EMAIL BODY: 2-3 short paragraphs in plain HTML <p> tags. Warm and genuine. If they shared a prayer request, acknowledge it specifically, don't be generic or preachy. Let them know someone from the team will personally reach out if they reply. End warmly. Sign off is handled separately, do not include it. Keep it under 120 words total. Address them as ${firstName}.

Respond with ONLY the HTML paragraphs, no JSON, no extra text.`;

  try {
    const text = await callClaude(prompt);
    if (!text) return null;
    const pTags = text.match(/<p[\s\S]*?<\/p>/g);
    if (!pTags) return null;
    return pTags.join('');
  } catch {
    return null;
  }
}

// AI reply suggestion

export async function generateSuggestedReply(
  visitor: VisitorContext,
  recentMessages: Array<{ direction: 'inbound' | 'outbound'; body: string }>,
  channel: 'sms' | 'email',
): Promise<{ body: string; subject?: string } | null> {
  const firstName = visitor.name.split(' ')[0];
  const context = visitorContextLines(visitor);
  const thread = recentMessages
    .slice(-6)
    .map((m) => `${m.direction === 'inbound' ? firstName : 'Pastor Danny'}: ${m.body}`)
    .join('\n');

  const prompt = channel === 'sms'
    ? `You are Pastor Danny at Gateway City Church in Las Vegas. Draft a reply to this visitor. Do not use em dashes.

Visitor context:
${context}

Recent conversation:
${thread || '(No prior messages)'}

Write a short casual SMS reply (under 160 characters, no sign-off, it's added automatically).

Respond with ONLY the message text, nothing else.`
    : `You are Pastor Danny at Gateway City Church in Las Vegas. Draft an email reply to this visitor. Do not use em dashes.

Visitor context:
${context}

Recent conversation:
${thread || '(No prior messages)'}

Write a warm, personal email (2-3 sentences, conversational, no sign-off). Also write a concise subject line (under 8 words, natural not generic).

Respond in this exact JSON format:
{"subject": "...", "body": "..."}`;

  const text = await callClaude(prompt, 256);
  if (!text) return null;

  if (channel === 'sms') return { body: text.trim() };

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { body: text.trim() };
    const parsed = JSON.parse(jsonMatch[0]);
    return { body: parsed.body ?? text.trim(), subject: parsed.subject };
  } catch {
    return { body: text.trim() };
  }
}

// Visitor insight card

export async function generateVisitorInsight(
  visitor: VisitorContext & { visitCount: number },
  recentSmsContext?: string,
): Promise<string | null> {
  const context = visitorContextLines(visitor);

  const prompt = `You are a ministry assistant helping Pastor Danny understand a visitor at Gateway City Church. Based on the profile below, write a 2-3 sentence pastoral snapshot: who this person seems to be, what might matter to them spiritually, and a suggested approach for outreach. Be warm and insightful, not clinical. Do not use em dashes in your response.

Visitor profile:
${context}
Total visits: ${visitor.visitCount}
${recentSmsContext ? `Recent SMS exchange context: ${recentSmsContext}` : ''}

Respond with ONLY the 2-3 sentence snapshot, nothing else.`;

  const text = await callClaude(prompt, 256);
  return text?.trim().replace(/—/g, '-').replace(/--/g, '-') ?? null;
}

// Prayer request digest

export async function generatePrayerDigest(
  visitors: Array<{ name: string; prayer_request: string; created_at: string; how_heard?: string | null }>,
  churchName: string,
): Promise<string | null> {
  if (visitors.length === 0) return null;

  const list = visitors
    .map((v) => `- ${v.name} (visited ${new Date(v.created_at).toLocaleDateString()}): "${v.prayer_request}"`)
    .join('\n');

  const prompt = `You are a ministry assistant helping Pastor Danny at ${churchName} prepare for his week. Below are prayer requests from visitors this week. Write a brief, organized pastoral summary he can use to pray over and follow up on. Group by urgency or theme if patterns emerge. Keep it under 250 words. Warm, pastoral tone. Do not use em dashes.

Prayer requests:
${list}

Respond with ONLY the summary text (plain text, no HTML).`;

  const text = await callClaude(prompt, 512);
  return text?.trim() ?? null;
}

// Grace: natural language visitor search (text chat + voice search tool)

export async function naturalLanguageSearch(
  query: string,
  visitors: unknown[],
): Promise<{ ids: string[]; explanation: string } | null> {
  const prompt = `You are Grace, an AI assistant for Gateway City Church in Las Vegas. You serve the pastoral staff and have two areas of knowledge:

1. CHURCH DATA: You have visitor records, the church member roster, families, Sunday kids classes, who is checked in today (in the house), and the serve/volunteer team - the greeter and volunteer roles and who has signed up to serve. In the data, the object with "type":"church_roster" holds members_on_file, in_the_house_today, and serve_team (roles and signups); the object with "type":"kids_desk" holds families and kids classes in session.
2. BIBLE KNOWLEDGE: You have complete knowledge of the entire Bible - all 66 books, Old and New Testament. You know every story, passage, character, teaching, and theological theme. You can quote scripture, explain context, suggest verses for pastoral situations, compare passages, and answer questions about biblical content.

A staff member asked: "${query}"

If this is a question about the Bible, scripture, a specific passage, a biblical character, a theological topic, or anything related to God's Word - answer it directly and thoroughly in the explanation field, and return an empty ids array.

If this is a question about visitors, members, families, kids classes, check-in, pickup codes, who is here today, or the serve/volunteer/greeter team - search the data and answer with a SHORT plain English response (1-2 sentences max). Return matching visitor IDs in the ids array only when the answer is about specific visitors; for member, serve-team, or who-is-here answers, put the answer in the explanation and leave ids empty. If the relevant list in the data is empty, say plainly that no one is on it yet rather than saying you lack access. Write like you're talking to a pastor, never mention field names, JSON keys, or technical terms.

If this is a Bible or theological question - answer concisely in 2-3 sentences max. Be warm and pastoral, not academic.

Visitor data:
${JSON.stringify(visitors, null, 1)}

Do not use em dashes. Respond in this exact JSON format:
{"ids": ["id1", "id2"], "explanation": "..."}`;

  try {
    // Haiku on purpose: nlsearch powers the live text chat AND the voice
    // search tool, so it is the one latency-sensitive path.
    const text = await callClaude(prompt, 2048, 'claude-haiku-4-5');
    if (!text) return null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.ids)) return null;
    return parsed as { ids: string[]; explanation: string };
  } catch {
    return null;
  }
}

// Urgency detection for inbound SMS

export type UrgencySeverity = 'emergency' | 'urgent' | 'routine';

export async function analyzeUrgency(
  messageBody: string,
): Promise<{ isUrgent: boolean; severity: UrgencySeverity; reason: string } | null> {
  const prompt = `You are the triage layer for Gateway City Church in Las Vegas. Your one job is to read an inbound text from a visitor and decide whether it needs a pastor's attention TODAY, not at the next routine follow-up. A pastor is alerted the moment you flag it, so a missed real crisis is far worse than a false alarm.

Message: "${messageBody}"

Think privately before you answer, and never show this reasoning:
1. Read the message literally first. What is the person actually saying or asking?
2. Is anyone unsafe, in acute pain, or facing something time-sensitive?
3. Would waiting until the normal weekly follow-up cause real harm or a missed moment of ministry? If yes, it is urgent.

FLAG AS URGENT (needs a same-day pastoral response):
- Any hint of suicide, self-harm, or not wanting to be here ("I can't go on", "what's the point anymore").
- Abuse, violence, or fear of a partner or family member, or feeling unsafe at home.
- A medical emergency, hospitalization, or a death in the family or fresh grief.
- Acute mental-health distress: panic, hopelessness, a breakdown.
- A spiritual or personal crisis where the person is clearly reaching out for help right now, not just sharing.

DO NOT FLAG (normal, handle in routine follow-up):
- Scheduling, service times, directions, giving, or general questions.
- Ordinary life updates, sharing good news, or a routine prayer request with no urgency ("please pray for my job search").
- Everyday venting or stress that is not a crisis.

When you are genuinely unsure whether something crosses the line, flag it as urgent. The cost of a false alarm is small, the cost of missing a real crisis is not.

Set severity:
- "emergency" for immediate danger to life or safety: suicide or self-harm, abuse or violence, or a medical emergency. A pastor needs to be reached right now.
- "urgent" for a same-day pastoral response that is not life-threatening: fresh grief, acute distress, or someone clearly reaching out for help.
- "routine" for anything that can wait for normal follow-up.
isUrgent must be true when severity is "emergency" or "urgent", and false when severity is "routine".

Keep the reason to one plain sentence, no jargon, no em dashes.

Respond in this exact JSON format:
{"isUrgent": true/false, "severity": "emergency" | "urgent" | "routine", "reason": "brief explanation or empty string if routine"}`;

  try {
    const text = await callClaude(prompt, 200);
    if (!text) return null;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (typeof parsed.isUrgent !== 'boolean') return null;
    const severity: UrgencySeverity =
      parsed.severity === 'emergency' || parsed.severity === 'urgent' || parsed.severity === 'routine'
        ? parsed.severity
        : parsed.isUrgent ? 'urgent' : 'routine';
    return {
      isUrgent: parsed.isUrgent,
      severity,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch {
    return null;
  }
}
