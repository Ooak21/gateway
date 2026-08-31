// Grace staff voice. Tries xAI realtime (Ara) via gcc-grace-voice;
// if the function is not deployed, typed search still works through GCCOps.
(function () {
  const C = window.GCC;
  const PROMPT = 'You are Grace at GateWay Las Vegas. Keep answers short.';

  function sendWs(ws, o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  }

  const api = {
    active: false,
    state: null,
    token: null,
    onState: null,
    onTurn: null,
    ws: null,
    ctx: null,
    mic: null,
    proc: null,

    async ask(query) {
      // Full Grace brain first (visitors + families + Bible); keyword search
      // through GCCOps stays as the offline/preview fallback.
      const Vis = window.GCCVisitors;
      if (Vis) {
        try {
          const r = await Vis.nlsearch(query);
          if (r && r.explanation) return r.explanation;
        } catch { /* fall through */ }
      }
      const Ops = window.GCCOps;
      const data = await Ops.search(query);
      return (data && data.spoken) || 'I did not find that.';
    },

    async start() {
      const Ops = window.GCCOps;
      const headers = { 'Content-Type': 'application/json', apikey: C.SUPABASE_ANON_KEY };
      headers.Authorization = 'Bearer ' + (Ops.token || C.SUPABASE_ANON_KEY);
      let tok;
      try {
        const r = await fetch(C.GRACE_VOICE_URL, {
          method: 'POST', headers, body: JSON.stringify({ action: 'token' })
        });
        if (!r.ok) throw new Error('token');
        tok = await r.json();
      } catch {
        return 'Voice is not live yet. Type to Grace in the box. She can still look up families and kids classes.';
      }
      let mic;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        return 'Allow microphone access, or type to Grace instead.';
      }
      this.mic = mic;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC({ sampleRate: 24000 });
      this.ctx = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(mic);
      const proc = ctx.createScriptProcessor(2048, 1, 1);
      const mute = ctx.createGain(); mute.gain.value = 0;
      const inRate = ctx.sampleRate;
      const self = this;
      proc.onaudioprocess = (ev) => {
        if (!self.active) return;
        const inp = ev.inputBuffer.getChannelData(0);
        const ratio = inRate / 24000;
        const outLen = Math.max(1, Math.floor(inp.length / ratio));
        const out = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const v = Math.max(-1, Math.min(1, inp[Math.floor(i * ratio)] || 0));
          out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        const b = new Uint8Array(out.buffer);
        let bin = '';
        for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
        sendWs(self.ws, { type: 'input_audio_buffer.append', audio: btoa(bin) });
      };
      src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
      this.proc = proc;

      const ws = new WebSocket('wss://api.x.ai/v1/realtime?model=grok-voice-latest', ['xai-client-secret.' + tok.token]);
      this.ws = ws;
      this.active = true;
      this.state = 'thinking';
      if (this.onState) this.onState('thinking');
      const playHead = { t: ctx.currentTime };
      ws.onmessage = async (m) => {
        let e; try { e = JSON.parse(m.data); } catch { return; }
        if (e.type === 'session.created') {
          sendWs(ws, {
            type: 'session.update',
            session: {
              voice: tok.voice || 'Ara',
              instructions: tok.instructions || PROMPT,
              turn_detection: { type: 'server_vad', threshold: 0.65, prefix_padding_ms: 300, silence_duration_ms: 500 },
              audio: {
                input: { format: { type: 'audio/pcm', rate: 24000 } },
                output: { format: { type: 'audio/pcm', rate: 24000 } }
              },
              tools: [{
                type: 'function',
                name: 'search_church',
                description: 'Look up families, kids classes, check-ins, pickup codes, and who is here.',
                parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
              }]
            }
          });
        }
        if (e.type === 'session.updated') {
          sendWs(ws, { type: 'response.create', response: { instructions: 'Greet the staff member in one short sentence and ask what they need.' } });
        }
        if (e.type === 'input_audio_buffer.speech_started') { self.state = 'listening'; if (self.onState) self.onState('listening'); }
        if (e.type === 'response.created') { self.state = 'speaking'; if (self.onState) self.onState('speaking'); }
        if (e.type === 'response.function_call_arguments.done' && e.name === 'search_church') {
          let q = '';
          try { q = JSON.parse(e.arguments || '{}').query || ''; } catch {}
          const spoken = await self.ask(q);
          if (self.onTurn) self.onTurn({ role: 'grace', content: spoken });
          sendWs(ws, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: e.call_id, output: JSON.stringify({ answer: spoken }) } });
          sendWs(ws, { type: 'response.create' });
        }
        if (e.type === 'response.output_audio.delta' && e.delta) {
          try {
            const bin = atob(e.delta);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const pcm = new Int16Array(bytes.buffer);
            const f32 = new Float32Array(pcm.length);
            for (let i = 0; i < pcm.length; i++) f32[i] = pcm[i] / 32768;
            const buf = ctx.createBuffer(1, f32.length, 24000);
            buf.getChannelData(0).set(f32);
            const srcNode = ctx.createBufferSource();
            srcNode.buffer = buf;
            srcNode.connect(ctx.destination);
            const now = ctx.currentTime;
            if (playHead.t < now + 0.02) playHead.t = now + 0.02;
            srcNode.start(playHead.t);
            playHead.t += buf.duration;
          } catch {}
        }
        if (e.type === 'response.done') { self.state = 'listening'; if (self.onState) self.onState('listening'); }
      };
      ws.onclose = () => { if (self.active) self.stop(); };
      return null;
    },

    stop() {
      this.active = false;
      this.state = null;
      if (this.proc) { try { this.proc.disconnect(); } catch {} this.proc = null; }
      if (this.mic) { this.mic.getTracks().forEach((t) => t.stop()); this.mic = null; }
      if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
      if (this.ctx) { try { this.ctx.close(); } catch {} this.ctx = null; }
      if (this.onState) this.onState(null);
    }
  };

  window.GCCGrace = api;
})();
