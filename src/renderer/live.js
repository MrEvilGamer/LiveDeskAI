// Live (streaming) transcription for one audio source.
//
// The VAD worklet streams speech blocks while somebody is talking. SpeechStream:
//   * every ~450 ms sends the audio-so-far to the STT server as an INTERIM request
//     (at most one in flight; the server also drops interims while a final runs),
//     so words show up on screen while the sentence is still being spoken;
//   * the moment the VAD sees the pause it sends the full utterance as the FINAL
//     request — no waiting for a queue, no second VAD pass;
//   * finals are always emitted in speech order even if requests finish out of order.

// Whisper invents these on near-silence / noise. Never show them.
const HALLUCINATIONS = /^(thanks?( you)?( for (watching|listening))?|thank you\.?|you|bye\.?|\.+|…|subtitles? by .*|please subscribe.*|\[?(music|applause|silence|noise)\]?)[.!\s]*$/i;

function isHallucination(text) {
  const t = (text || '').trim();
  return !t || t.length < 2 || HALLUCINATIONS.test(t);
}

class SpeechStream {
  constructor(opts) {
    this.kind = opts.kind;
    this.transcribe = opts.transcribe;         // (wavBytes, { interim }) => Promise<{ text }>
    this.onInterim = opts.onInterim || (() => {});
    this.onFinal = opts.onFinal || (() => {});
    this.onDiscard = opts.onDiscard || (() => {});
    this.onError = opts.onError || (() => {});
    this.every = opts.interimEveryMs || 450;
    this.interimEnabled = opts.interim !== false;
    this.minAudio = 0.5;                       // seconds of speech before the first interim

    this.id = 0;
    this.active = false;
    this.parts = [];
    this.len = 0;
    this.rate = 48000;
    this.busy = false;
    this.lastLen = 0;
    this.lastAt = 0;
    this.emitChain = Promise.resolve();
    this.generation = 0;
  }

  setInterim(on) { this.interimEnabled = !!on; }

  start(rate) {
    this.id++;
    this.active = true;
    this.parts = [];
    this.len = 0;
    this.rate = rate;
    this.busy = false;
    this.lastLen = 0;
    this.lastAt = 0;
  }

  push(samples) {
    if (!this.active) return;
    this.parts.push(samples);
    this.len += samples.length;
    if (!this.interimEnabled || this.busy) return;
    if (this.len / this.rate < this.minAudio || this.len === this.lastLen) return;
    const now = performance.now();
    if (now - this.lastAt < this.every) return;
    this._interim(now);
  }

  _snapshot() {
    const all = new Float32Array(this.len);
    let off = 0;
    for (const p of this.parts) { all.set(p, off); off += p.length; }
    return new Uint8Array(toWav16k(all, this.rate));
  }

  _interim(now) {
    const id = this.id;
    this.busy = true;
    this.lastAt = now;
    this.lastLen = this.len;
    const wav = this._snapshot();
    const t0 = performance.now();
    this.transcribe(wav, { interim: true })
      .then((r) => {
        if (id !== this.id || !this.active) return;   // utterance already ended / replaced
        const text = ((r && r.text) || '').trim();
        if (r && r.skipped) return;
        if (text && (!isHallucination(text) || r.speechVerified)) this.onInterim(text, id, Math.round(performance.now() - t0));
      })
      .catch(() => { /* interim failures are silent; the final decides */ })
      .finally(() => { if (id === this.id) this.busy = false; });
  }

  end(total, voiced) {
    const id = this.id;
    const generation = this.generation;
    if (!this.active) return;
    this.active = false;
    if ((voiced !== undefined && voiced < 0.08) || this.len < 0.25 * this.rate) {
      this.parts = []; this.len = 0;
      this.onDiscard(id);
      return;
    }
    const wav = this._snapshot();
    this.parts = [];
    this.len = 0;
    const t0 = performance.now();
    const run = () => this.transcribe(wav, { interim: false });
    // one fast retry for transient socket hiccups
    const p = run()
      .catch(() => new Promise((r) => setTimeout(r, 120)).then(run))
      .then((r) => ({ text: ((r && r.text) || '').trim(), speechVerified: !!r.speechVerified, ms: Math.round(performance.now() - t0) }))
      .catch((error) => ({ error }));
    this.emitChain = this.emitChain.then(() => p).then((res) => {
      if (generation !== this.generation) return;
      if (res.error) this.onError(res.error, id);
      else if (isHallucination(res.text) && !res.speechVerified) this.onDiscard(id);
      else this.onFinal(res.text, id, res.ms);
    });
  }

  reset() {
    this.generation++;
    this.emitChain = Promise.resolve();
    this.id++;
    this.active = false;
    this.parts = [];
    this.len = 0;
    this.busy = false;
  }
}
