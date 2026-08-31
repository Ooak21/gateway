/* GateWay Prayer & Info companion — self-contained, self-injecting demo widget.
   Include once per page:  <script src="gateway-prayer-chat.js"></script>
   Works from file:// (no backend, no API key). Crisis-safety fires before anything else. */
(function () {
  if (window.__gwChatLoaded) return; window.__gwChatLoaded = true;

  var CHURCH = {
    name: "GateWay City Church", addr: "3630 N. Rancho Dr, Las Vegas", phone: "(702) 881-5623",
    times: "Sundays at 10:00 AM and 1:00 PM (in person and online), and Wednesdays at 7:00 PM",
    pastors: "Pastor Danny, Pastor Paul, and Pastor Fred",
    tracks: "Getting Connected, Freedom &amp; Wholeness, Discovering Your SHAPE, and the Baptism of the Holy Spirit"
  };

  // ---- SAFETY FIRST: crisis detection short-circuits everything else. ----
  var CRISIS = /\b(kill (myself|him|her|them|someone|people)|suicide|suicidal|end (my life|it all)|don'?t want to (live|be here)|want(ing)? to die|wanna die|better off dead|hurt (myself|him|her|them|someone|people)|harm (myself|others|someone)|cut myself|take my (own )?life|no reason to (live|go on)|shoot (up|him|her|them|someone)|stab (him|her|them|someone))\b/i;
  var CRISIS_MSG = "I'm really glad you told me, and I want you to be safe. If you are thinking about harming yourself or someone else, please reach out for help right now, before anything else.<br><br><strong>Call 911</strong> if there is immediate danger.<br><strong>Call or text 988</strong> to reach the Suicide &amp; Crisis Lifeline, any time, day or night.<br><br>You matter, your life matters, and you are not alone. Please reach out to one of these right now. If someone is near you, tell them what you're feeling.";
  var CRISIS_AGAIN = "Please reach out for help right now. Call <strong>911</strong> if you're in danger, or call or text <strong>988</strong> to talk to someone immediately. Are you safe right now?";
  var crisisMode = false;

  var v = function (ref, text) { return "<em>&ldquo;" + text + "&rdquo;</em> &mdash; " + ref; };

  var INTENTS = [
    { re: /\b(marriage|married|spouse|husband|wife|my partner|we fight|divorce|separat)/i,
      r: "Marriage can carry real weight, and God cares deeply about yours. Keep choosing patience and honesty with each other, one day at a time. " + v("1 Corinthians 13:4-7", "Love is patient, love is kind... it always protects, always trusts, always hopes, always perseveres.") + "<br><br>Would you like me to pray for your marriage, or connect you with a pastor?" },
    { re: /\b(friend|friendship|betrayed by|my friend|fell out)/i,
      r: "Friendships can bless us and wound us deeply. Guard the good ones and forgive where you can. " + v("Proverbs 17:17", "A friend loves at all times.") + "<br><br>Want to talk through it or have me pray with you?" },
    { re: /\b(business|my job|career|a decision|decide|should i|work|my boss|opportunity|invest)/i,
      r: "Big decisions are easier when you're not carrying them alone. Bring it to God honestly and seek wise counsel. " + v("Proverbs 3:5-6", "Trust in the Lord with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.") + " And " + v("James 1:5", "If any of you lacks wisdom, you should ask God.") + "<br><br>Would you like prayer for clarity on this decision?" },
    { re: /\b(money|finance|financial|debt|bills|afford|broke|rent|paycheck|provision)/i,
      r: "Money stress is heavy, and God sees it. Take one faithful step at a time and trust him to provide. " + v("Philippians 4:19", "And my God will meet all your needs according to the riches of his glory in Christ Jesus.") + "<br><br>Can I pray with you about this?" },
    { re: /\b(anx|worried|worry|afraid|fear|scared|stress|overwhelm|panic|can'?t sleep|nervous)/i,
      r: "Take a breath. You don't have to carry this alone or figure it all out tonight. " + v("Philippians 4:6-7", "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God, which transcends all understanding, will guard your hearts.") + "<br><br>Would you like me to pray for peace over you right now?" },
    { re: /\b(grief|grieving|died|death|passed away|lost my|mourning|funeral|miss (him|her|them))/i,
      r: "I'm so sorry for your loss. Grief is love with nowhere to go, and God is close to you in it. " + v("Psalm 34:18", "The Lord is close to the brokenhearted and saves those who are crushed in spirit.") + "<br><br>May I pray comfort over you?" },
    { re: /\b(forgive|forgiveness|resentment|bitter|they hurt me|betrayed|can'?t let go)/i,
      r: "Forgiveness is hard, and it's also freedom, mostly for you. You don't have to do it perfectly, just take a step. " + v("Colossians 3:13", "Bear with each other and forgive one another... Forgive as the Lord forgave you.") + "<br><br>Want to pray through this together?" },
    { re: /\b(lonely|alone|isolated|no one|nobody|by myself)/i,
      r: "Feeling alone is painful, and I want you to know you're not, God is with you and this church would love to know you. " + v("Deuteronomy 31:6", "He will never leave you nor forsake you.") + "<br><br>Would you like to get connected with people here? I can tell you about Grow Tracks." },
    { re: /\b(guidance|direction|my purpose|what should i do|feel lost|confused|which way|calling)/i,
      r: "When the path isn't clear, God still is. Stay close to him and the next step will come. " + v("Psalm 32:8", "I will instruct you and teach you in the way you should go; I will counsel you with my loving eye on you.") + "<br><br>Discovering Your SHAPE, one of our Grow Tracks, is built for exactly this. Want to hear about it?" },
    { re: /\b(tempt|addict|addiction|struggle with|keep failing|relapse|can'?t stop|habit)/i,
      r: "Thank you for your honesty, that takes courage. You're not beyond hope, and you don't fight this alone. " + v("1 Corinthians 10:13", "God is faithful; he will not let you be tempted beyond what you can bear. But when you are tempted, he will also provide a way out.") + "<br><br>Our Freedom &amp; Wholeness track walks with people through this. Would you like prayer, too?" },
    { re: /\b(angry|anger|furious|rage|so mad|resent)/i,
      r: "Anger often sits on top of hurt. It's okay to feel it, bring it to God rather than letting it drive you. " + v("Ephesians 4:26", "In your anger do not sin: Do not let the sun go down while you are still angry.") + "<br><br>Want to pray through what's underneath it?" },
    { re: /\b(doubt|don'?t believe|is god real|lost my faith|why does god)/i,
      r: "Doubt isn't the opposite of faith, it's often part of the journey, and honest questions are welcome here. " + v("Mark 9:24", "I do believe; help me overcome my unbelief!") + "<br><br>A pastor would love to talk with you, no pressure. Want me to point you there?" },
    { re: /\b(thankful|grateful|blessed|praise|good news|celebrate|answered prayer)/i,
      r: "That's wonderful, thank you for sharing it. Let's give God thanks together. " + v("1 Thessalonians 5:18", "Give thanks in all circumstances; for this is God's will for you in Christ Jesus.") + "<br><br>Is there anything I can pray with you about as well?" },

    { re: /\b(where|location|address|directions|how do i get|find you|campus|parking)/i,
      r: CHURCH.name + " is at <strong>" + CHURCH.addr + "</strong>, with parking on site. We'd love to have you. Want our service times too?" },
    { re: /\b(service|times|what time|when do you|sunday|wednesday|hours|meet)/i,
      r: "We gather " + CHURCH.times + ". Come as you are." },
    { re: /\b(pastor|who leads|leadership|danny|paul|fred|preacher)/i,
      r: "Our pastors include <strong>" + CHURCH.pastors + "</strong>. They'd love to meet you. Would you like to connect with one of them?" },
    { re: /\b(event|upcoming|happening|calendar|this week|going on|ministr)/i,
      r: "Alongside our Sunday and Wednesday services, we host ministries and gatherings throughout the month. The best way to catch what's coming up is to sign up through Grow Tracks or ask us on a Sunday. Want to hear about Grow Tracks?" },
    { re: /\b(grow track|next step|get involved|discipleship|membership|class|small group|serve)/i,
      r: "Grow Tracks are your next steps at GateWay: <strong>" + CHURCH.tracks + "</strong>. You can sign up on the Grow Tracks page. Want help choosing where to start?" },
    { re: /\b(kid|child|children|nursery|childcare|family|baby)/i,
      r: "Yes, kids are always welcome. There's a safe, fun space for children during services, just come a few minutes early to check them in." },
    { re: /\b(bapti)/i,
      r: "We'd be honored to walk with you toward baptism. It's one of our Grow Tracks, the Baptism of the Holy Spirit, and a pastor can talk it through with you. Want me to point you there?" },
    { re: /\b(give|giving|tithe|donate|offering|support the church)/i,
      r: "Thank you for a generous heart. You can give in person on Sundays or ask about online giving. If you'd like, the team can follow up with you." },
    { re: /\b(contact|phone|call you|email|reach you|talk to someone|get in touch)/i,
      r: "You can reach " + CHURCH.name + " at <strong>" + CHURCH.phone + "</strong>, or fill out the form on the site and the team will reach out. What can I help with?" },
    { re: /\b(first time|what to expect|new here|visit|come to church|what should i wear|never been)/i,
      r: "First time? Wonderful. Come as you are, plan for about an hour, kids are welcome, and someone will help you feel at home. Sundays at 10 AM or 1 PM at " + CHURCH.addr + "." },

    { re: /\b(pray|prayer|pray for me|pray with me|need prayer)/i,
      r: "I'd be honored to pray with you. <em>Father, thank you for the one reading this. You know exactly what they're carrying right now. Give them your peace that guards the heart, wisdom for the next step, and the deep assurance that they are loved by you. Meet them right here. In Jesus' name, amen.</em><br><br>Is there something specific you'd like prayer for?" },
    { re: /\b(hi|hello|hey|good (morning|evening|afternoon)|thanks|thank you)\b/i,
      r: "So glad you're here. You can share whatever's on your heart, a struggle, a decision, worry or grief, or ask about our services, pastors, ministries, or Grow Tracks. How can I pray with you or help today?" }
  ];

  var FALLBACK = "Thank you for sharing that. Whatever you're facing, you're not carrying it alone, and God is near. " + v("Psalm 46:1", "God is our refuge and strength, an ever-present help in trouble.") + "<br><br>Would you like me to pray with you about this, or point you to a pastor or a Grow Track? You can also tell me a bit more and I'll do my best to help.";

  function answer(text) {
    var t = (text || "").toLowerCase();
    if (crisisMode) { if (CRISIS.test(t)) return { crisis: true, html: CRISIS_MSG }; return { crisis: true, html: CRISIS_AGAIN }; }
    if (CRISIS.test(t)) { crisisMode = true; return { crisis: true, html: CRISIS_MSG }; }
    for (var i = 0; i < INTENTS.length; i++) { if (INTENTS[i].re.test(t)) return { html: INTENTS[i].r }; }
    return { html: FALLBACK };
  }

  // ---- inject styles + widget ----
  var CSS = "#gwchat,#gwchat *{box-sizing:border-box;font-family:'Manrope',system-ui,sans-serif}"
    + "#gwchat-btn{position:fixed;right:22px;bottom:22px;z-index:99999;display:inline-flex;align-items:center;gap:9px;background:#1C2430;color:#FAFAF8;border:1px solid #A68B5B;border-radius:999px;padding:13px 20px;font-size:14px;font-weight:600;letter-spacing:.2px;cursor:pointer;box-shadow:0 14px 40px rgba(26,25,23,.28);transition:transform .15s,background .15s}"
    + "#gwchat-btn:hover{background:#121820;transform:translateY(-1px)}#gwchat-btn .dot{width:7px;height:7px;border-radius:50%;background:#C4A974}"
    + "#gwchat-panel{position:fixed;right:22px;bottom:84px;z-index:99999;width:390px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:#FAFAF8;border:1px solid #E6E2DA;border-radius:18px;overflow:hidden;display:none;flex-direction:column;box-shadow:0 30px 70px rgba(26,25,23,.26)}"
    + "#gwchat-panel.open{display:flex}#gwchat-head{background:#1C2430;color:#FAFAF8;padding:18px 20px;position:relative}"
    + "#gwchat-head .t{font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:600;letter-spacing:.3px}#gwchat-head .s{font-size:12.5px;color:#C4A974;margin-top:2px}"
    + "#gwchat-head .x{position:absolute;top:16px;right:18px;background:none;border:none;color:#8A847C;font-size:22px;cursor:pointer}#gwchat-head .x:hover{color:#FAFAF8}"
    + "#gwchat-body{flex:1;overflow-y:auto;padding:16px;background:#F4F2EE}#gwchat-body .row{margin-bottom:11px;display:flex}"
    + "#gwchat-body .bot{background:#fff;border:1px solid #E6E2DA;border-radius:14px 14px 14px 4px;padding:11px 14px;font-size:14px;color:#1A1917;line-height:1.55;max-width:88%;box-shadow:0 1px 2px rgba(26,25,23,.04)}"
    + "#gwchat-body .me{margin-left:auto;background:#1C2430;color:#FAFAF8;border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:14px;max-width:85%}"
    + "#gwchat-body .bot em{color:#6B6560}#gwchat-body .bot.crisis{border-color:#b4443a;background:#fbeeec}"
    + "#gwchat-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}#gwchat-chips button{background:#fff;border:1px solid #D4CFC4;color:#3F3C38;border-radius:999px;padding:7px 12px;font-size:12.5px;cursor:pointer}#gwchat-chips button:hover{border-color:#A68B5B;color:#1A1917}"
    + "#gwchat-foot{border-top:1px solid #E6E2DA;padding:11px;display:flex;gap:8px;background:#FAFAF8}#gwchat-in{flex:1;border:1px solid #D4CFC4;border-radius:12px;padding:10px 13px;font-size:14px;outline:none}#gwchat-in:focus{border-color:#A68B5B}"
    + "#gwchat-send{background:#A68B5B;color:#fff;border:none;border-radius:11px;padding:10px 16px;font-weight:700;font-size:14px;cursor:pointer}#gwchat-send:hover{background:#8f7648}";

  function boot() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var root = document.createElement("div"); root.id = "gwchat";
    root.innerHTML =
      '<button id="gwchat-btn"><span class="dot"></span>Prayer &amp; Info</button>'
      + '<div id="gwchat-panel">'
      + '<div id="gwchat-head"><div class="t">Here to help &amp; pray</div><div class="s">GateWay City Church &middot; Las Vegas</div><button class="x" id="gwchat-x" aria-label="Close">&times;</button></div>'
      + '<div id="gwchat-body"></div>'
      + '<div id="gwchat-foot"><input id="gwchat-in" type="text" placeholder="Share what’s on your heart..." autocomplete="off"><button id="gwchat-send">Send</button></div>'
      + '</div>';
    document.body.appendChild(root);

    var panel = document.getElementById('gwchat-panel'), body = document.getElementById('gwchat-body'),
        input = document.getElementById('gwchat-in'), send = document.getElementById('gwchat-send'),
        btn = document.getElementById('gwchat-btn'), started = false;

    function add(cls, html) { var r = document.createElement('div'); r.className = 'row';
      var b = document.createElement('div'); b.className = cls; b.innerHTML = html; r.appendChild(b); body.appendChild(r); body.scrollTop = body.scrollHeight; }

    function chips() {
      var r = document.createElement('div'); r.className = 'row'; var w = document.createElement('div'); w.id = 'gwchat-chips';
      ['Pray with me', 'Service times', 'Grow Tracks', 'I feel anxious'].forEach(function (q) {
        var c = document.createElement('button'); c.textContent = q; c.onclick = function () { handle(q); }; w.appendChild(c);
      });
      r.appendChild(w); body.appendChild(r);
    }

    function greet() { if (started) return; started = true;
      add('bot', "Hi, I'm here to pray with you and help you find your way at GateWay. You can share what's on your heart, or ask about services, pastors, ministries, or Grow Tracks.");
      chips(); }

    function handle(text) {
      text = (text || '').trim(); if (!text) return;
      add('me', text.replace(/</g, '&lt;'));
      var g = document.getElementById('gwchat-chips'); if (g) g.parentNode.remove();
      var res = answer(text);
      setTimeout(function () { add(res.crisis ? 'bot crisis' : 'bot', res.html); }, 250);
    }

    btn.onclick = function () { panel.classList.toggle('open'); if (panel.classList.contains('open')) { greet(); input.focus(); } };
    document.getElementById('gwchat-x').onclick = function () { panel.classList.remove('open'); };
    send.onclick = function () { var t = input.value; input.value = ''; handle(t); };
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send.onclick(); } });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
