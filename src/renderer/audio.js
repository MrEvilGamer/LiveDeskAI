// Audio capture + voice-activity detection.
// 'system' captures Windows loopback audio (everyone else in the call),
// 'mic' captures the user. Utterances are emitted as Float32 chunks.

const VAD_WORKLET = `
// Streaming VAD. Instead of buffering a whole utterance and emitting it after the
// pause, it emits 'start' -> many small 'block's -> 'end' so the renderer can
// transcribe while the person is still talking.
class VADProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.sensitivity = typeof o.sensitivity === 'number' ? o.sensitivity : 0.5;
    const tailMs = typeof o.tailMs === 'number' ? o.tailMs : 420;
    this.tailFrames = Math.max(2, Math.round((tailMs / 1000) * sampleRate / 128));
    this.maxSamples = Math.round(15 * sampleRate);
    this.blockSize = 2048;                      // ~43 ms @ 48 kHz
    // pre-roll ring (0.3 s) so the first syllable is never clipped
    this.ringLen = Math.ceil((0.3 * sampleRate) / 128) * 128;
    this.ring = new Float32Array(this.ringLen);
    this.ringPos = 0;
    this.ringFill = 0;
    this.acc = new Float32Array(this.blockSize + 128);
    this.accLen = 0;
    this.total = 0;
    this.voiced = 0;
    this.speaking = false;
    this.openFrames = 0;
    this.silFrames = 0;
    this.noise = 0.001;
    this.levelT = 0;
  }
  ringWrite(ch) {
    const n = ch.length;
    if (this.ringPos + n > this.ringLen) this.ringPos = 0;
    this.ring.set(ch, this.ringPos);
    this.ringPos += n;
    if (this.ringPos >= this.ringLen) this.ringPos = 0;
    this.ringFill = Math.min(this.ringLen, this.ringFill + n);
  }
  ringRead() {
    const out = new Float32Array(this.ringFill);
    if (this.ringFill < this.ringLen) {
      out.set(this.ring.subarray(0, this.ringFill));
    } else {
      out.set(this.ring.subarray(this.ringPos), 0);
      out.set(this.ring.subarray(0, this.ringPos), this.ringLen - this.ringPos);
    }
    return out;
  }
  push(a) {
    // 'a' can be larger than one block (the pre-roll is), so copy in slices.
    let off = 0;
    this.total += a.length;
    while (off < a.length) {
      const room = this.blockSize - this.accLen;
      const n = Math.min(room, a.length - off);
      this.acc.set(a.subarray(off, off + n), this.accLen);
      this.accLen += n;
      off += n;
      if (this.accLen >= this.blockSize) this.flush();
    }
  }
  flush() {
    if (!this.accLen) return;
    const out = this.acc.slice(0, this.accLen);
    this.accLen = 0;
    this.port.postMessage({ type: 'block', samples: out }, [out.buffer]);
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / ch.length);
    if (!this.speaking) this.noise = this.noise * 0.9985 + rms * 0.0015;
    const mult = 1.7 + (1 - this.sensitivity) * 6;
    const th = Math.max(0.0015, this.noise * mult);
    if (currentTime - this.levelT > 0.05) {
      this.levelT = currentTime;
      this.port.postMessage({ type: 'level', rms });
    }
    if (!this.speaking) {
      if (rms > th) {
        if (++this.openFrames >= 4) {
          this.speaking = true;
          this.silFrames = 0;
          this.total = 0;
          this.voiced = 0;
          this.port.postMessage({ type: 'start' });
          this.push(this.ringRead());
          this.push(ch);
          this.ringFill = 0;
          this.ringPos = 0;
          return true;
        }
      } else {
        this.openFrames = 0;
      }
      this.ringWrite(ch);
    } else {
      this.push(ch);
      if (rms >= th) this.voiced++;
      if (rms < th) {
        if (++this.silFrames >= this.tailFrames) this.finish();
      } else {
        this.silFrames = 0;
      }
      if (this.speaking && this.total >= this.maxSamples) this.finish();
    }
    return true;
  }
  finish() {
    this.flush();
    this.port.postMessage({ type: 'end', total: this.total, voiced: (this.voiced * 128) / sampleRate });
    this.speaking = false;
    this.total = 0;
    this.openFrames = 0;
    this.silFrames = 0;
  }
}
registerProcessor('vad-proc', VADProcessor);
`;

class AudioEngine {
  constructor(handlers) {
    this.h = handlers || {};
    this.sources = []; // { kind, stream, ctx }
  }

  async addSource(kind, sensitivity) {
    let stream;
    if (kind === 'system') {
      // Handler in main.js resolves this to the loopback system-audio device.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      stream.getVideoTracks().forEach((t) => t.stop());
    } else {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    }
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error('No audio track was captured. Check the Windows output device and audio permissions.');
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    try {
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const url = URL.createObjectURL(new Blob([VAD_WORKLET], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'vad-proc', {
      numberOfOutputs: 0,
      processorOptions: { sensitivity, tailMs: kind === 'mic' ? 700 : 650 }
    });
    // Per-source utterance accumulator, only used to keep the legacy onChunk()
    // callback (whole utterance on end) working for scripts/test-audio.
    let legacy = null;
    node.port.onmessage = (e) => {
      const m = e.data;
      const h = this.h;
      if (m.type === 'level') {
        if (h.onLevel) h.onLevel(kind, m.rms);
      } else if (m.type === 'start') {
        legacy = h.onChunk ? [] : null;
        if (h.onSpeechStart) h.onSpeechStart(kind, ctx.sampleRate);
      } else if (m.type === 'block') {
        if (legacy) legacy.push(m.samples);
        if (h.onSpeechBlock) h.onSpeechBlock(kind, m.samples, ctx.sampleRate);
      } else if (m.type === 'end') {
        if (h.onSpeechEnd) h.onSpeechEnd(kind, m.total, ctx.sampleRate, m.voiced);
        if (legacy && h.onChunk && m.total >= 0.25 * ctx.sampleRate && m.voiced >= 0.08) {
          const out = new Float32Array(m.total);
          let off = 0;
          for (const a of legacy) { out.set(a, off); off += a.length; }
          h.onChunk(kind, out, ctx.sampleRate);
        }
        legacy = null;
      }
    };
    src.connect(node);
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
      if (this.h.onEnded) this.h.onEnded(kind);
    }));
    this.sources.push({ kind, stream, ctx });
    return stream;
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      await ctx.close().catch(() => {});
      throw e;
    }
  }

  dropSource(kind) {
    this.sources.filter((s) => s.kind === kind).forEach((s) => {
      try { s.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { s.ctx.close(); } catch (_) {}
    });
    this.sources = this.sources.filter((s) => s.kind !== kind);
  }

  stopAll() {
    for (const s of this.sources) {
      try { s.stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      try { s.ctx.close(); } catch (_) {}
    }
    this.sources = [];
  }

  has(kind) {
    return this.sources.some((s) => s.kind === kind && s.stream.getAudioTracks().some((t) => t.readyState === 'live'));
  }
}

// Downsample to 16 kHz mono and encode a 16-bit PCM WAV (what STT servers expect).
function toWav16k(f32, srcRate) {
  const ratio = srcRate / 16000;
  const n = Math.max(1, Math.floor(f32.length / ratio));
  const out = new Float32Array(n);
  const weights = [];
  if (ratio > 1) {
    const cutoff = 0.45 / ratio;
    let sum = 0;
    for (let k = -12; k <= 12; k++) {
      const sinc = k === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * k) / (Math.PI * k);
      const weight = sinc * (0.54 + 0.46 * Math.cos(Math.PI * k / 12));
      weights.push(weight); sum += weight;
    }
    for (let i = 0; i < weights.length; i++) weights[i] /= sum;
  }
  for (let i = 0; i < n; i++) {
    const s = i * ratio;
    const i0 = Math.floor(s);
    const frac = s - i0;
    const a = f32[i0] || 0;
    const b = f32[i0 + 1] !== undefined ? f32[i0 + 1] : a;
    if (!weights.length) out[i] = a + (b - a) * frac;
    else {
      let value = 0;
      for (let k = -12; k <= 12; k++) {
        const index = Math.max(0, Math.min(f32.length - 1, i0 + k));
        const next = Math.min(f32.length - 1, index + 1);
        value += ((f32[index] || 0) * (1 - frac) + (f32[next] || 0) * frac) * weights[k + 12];
      }
      out[i] = value;
    }
  }
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ws = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, out[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
