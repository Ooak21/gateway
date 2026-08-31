// Visitor email templates, ported unchanged from GroundworkHQ lib/emails.tsx.

export function welcomeEmail(visitorName: string, churchName: string, churchAddress: string, customBody?: string) {
  const firstName = visitorName.split(' ')[0];
  const bodyContent = customBody
    ? customBody.replace(/<p>/g, '<p class="message">').replace(/<p class="message message">/g, '<p class="message">')
    : `<p class="message">We are so glad you joined us today. It means a lot that you chose to spend part of your Sunday with us.</p>
    <p class="message">If you have any questions, need prayer, or just want to connect, reply to this email and someone from our team will get back to you personally.</p>
    <p class="message">We hope to see you again soon.</p>`;
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:#0D1B2A; font-family: 'Lora', Georgia, serif; }
  .wrap { max-width: 520px; margin: 60px auto; background: #0D1B2A; border-radius: 4px; overflow: hidden; }
  .header { background: #0D1B2A; padding: 28px 48px; text-align: center; border-bottom: 1px solid rgba(184,131,42,0.2); }
  .cross { font-size: 22px; color: #B8832A; margin-bottom: 6px; }
  .church-name { color: #B8832A; font-family: 'Lora', Georgia, serif; font-size: 17px; font-weight: normal; margin: 0; letter-spacing: 0.06em; }
  .body { padding: 52px 48px 44px; color: #e8e0d0; }
  .greeting { font-size: 20px; color: #B8832A; margin: 0 0 28px; font-weight: normal; }
  .message { font-size: 15px; line-height: 2; color: rgba(255,255,255,0.7); margin: 0 0 24px; }
  .signature { font-size: 14px; color: rgba(255,255,255,0.4); margin-top: 8px; font-style: italic; }
  .footer { padding: 24px 48px 32px; text-align: center; font-size: 11px; color: rgba(255,255,255,0.2); border-top: 1px solid rgba(255,255,255,0.06); }
  .footer a { color: #B8832A; text-decoration: none; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="cross">✝</div>
    <p class="church-name">${churchName.toUpperCase()}</p>
  </div>
  <div class="body">
    <h2 class="greeting">Welcome, ${firstName}!</h2>
    ${bodyContent}
    <p class="signature">Pastor Danny &amp; the ${churchName} Family</p>
  </div>
  <div class="footer">
    <p style="margin:0;">${churchName} &bull; ${churchAddress}</p>
    <p style="margin:8px 0 0;"><a href="#">Unsubscribe</a></p>
  </div>
</div>
</body>
</html>`;
}

function followUpShell(greeting: string, bodyContent: string, churchName: string, churchAddress: string) {
  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
<style>
  body { margin:0; padding:0; background:#f4f1ea; font-family: 'Lora', Georgia, serif; }
  .wrap { max-width: 520px; margin: 60px auto; background: #fff; border-radius: 4px; overflow: hidden; }
  .header { background: #0D1B2A; padding: 28px 48px; text-align: center; }
  .cross { font-size: 22px; color: #B8832A; margin-bottom: 6px; }
  .church-name { color: #B8832A; font-family: 'Lora', Georgia, serif; font-size: 17px; font-weight: normal; margin: 0; letter-spacing: 0.06em; }
  .body { padding: 52px 48px 44px; color: #2C2C2A; }
  .greeting { font-size: 20px; color: #0D1B2A; margin: 0 0 28px; font-weight: normal; }
  .message { font-size: 15px; line-height: 2; color: #555; margin: 0 0 24px; }
  .footer { padding: 24px 48px 32px; text-align: center; font-size: 11px; color: #bbb; border-top: 1px solid #f0ece3; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="cross">✝</div>
    <p class="church-name">${churchName.toUpperCase()}</p>
  </div>
  <div class="body">
    <h2 class="greeting">${greeting}</h2>
    ${bodyContent}
    <p class="message" style="color:#0D1B2A; font-style: italic; margin-top: 8px;">
      Pastor Danny &amp; the ${churchName} Family
    </p>
  </div>
  <div class="footer">
    <p style="margin:0;">${churchName} &bull; ${churchAddress}</p>
    <p style="margin:8px 0 0;"><a href="#" style="color:#B8832A; text-decoration:none;">Unsubscribe</a></p>
  </div>
</div>
</body>
</html>`;
}

export function followUp2Email(visitorName: string, churchName: string, churchAddress: string, customBody?: string) {
  const firstName = visitorName.split(' ')[0];
  const bodyContent = customBody ?? `
    <p class="message">It has been a few days since you joined us, and we wanted to check in. We hope you left feeling encouraged and that the message stayed with you.</p>
    <p class="message">If you are still exploring faith or looking for a church home, we would love to be that place for you. Our doors are open every Sunday and our team is always available to talk.</p>
    <p class="message">We would love to see you again this Sunday.</p>
  `;
  return followUpShell(`Still thinking about you, ${firstName}`, bodyContent, churchName, churchAddress);
}

export function followUp3Email(visitorName: string, churchName: string, churchAddress: string, customBody?: string) {
  const firstName = visitorName.split(' ')[0];
  const bodyContent = customBody ?? `
    <p class="message">Tomorrow is Sunday and we would love to see your face again. Whether last week was your first time or you have been thinking about coming back, know that there is a seat waiting for you.</p>
    <p class="message">Service starts at 10:00 AM. Come as you are. No dress code, no pressure, just a community that is genuinely glad you are there.</p>
    <p class="message">If you have any questions before tomorrow or just want to talk, reply to this message. We are here.</p>
  `;
  return followUpShell(`See you tomorrow, ${firstName}?`, bodyContent, churchName, churchAddress);
}

export function manualEmail(body: string, churchName: string, churchAddress: string) {
  return `<div style="font-family:Georgia,serif;max-width:560px;margin:40px auto;background:#0D1B2A;border-radius:8px;overflow:hidden;">
      <div style="padding:28px 36px;border-bottom:1px solid rgba(201,150,58,0.2);text-align:center;">
        <div style="font-size:24px;color:#B8832A;">✝</div>
        <p style="color:#B8832A;font-size:18px;margin:4px 0;">${churchName}</p>
      </div>
      <div style="padding:32px 36px;color:rgba(255,255,255,0.85);font-size:15px;line-height:1.8;">
        ${body.split('\n').map((line: string) => `<p style="margin:0 0 16px;">${line}</p>`).join('')}
      </div>
      <div style="padding:16px 36px;text-align:center;font-size:11px;color:rgba(255,255,255,0.25);border-top:1px solid rgba(255,255,255,0.05);">
        ${churchName} &bull; ${churchAddress}
      </div>
    </div>`;
}
