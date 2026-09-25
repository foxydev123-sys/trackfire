/* Lightweight procedural audio (Web Audio API, no sound files to load):
   cannon, reload, impact, explosion, engine + tracks, UI clicks, and a
   soft ambient music pad. Master / music / SFX volumes + mute. */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class GameAudio {
  constructor() { this.ctx = null; this.vol = { master: 0.8, music: 0.45, sfx: 0.9, mute: false }; this.listener = { x: 0, z: 0 }; this.musicOn = false; }
  // Browsers only allow audio after a user gesture — call this from a click/tap.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master);
      this.music = c.createGain(); this.music.connect(this.master);
      const len = c.sampleRate; const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = b;
      this.apply();
      this.startEngine();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  setVolumes(v) { Object.assign(this.vol, v); this.apply(); }
  apply() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.mute ? 0 : this.vol.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
    this.music.gain.setTargetAtTime(this.vol.music * 0.5, t, 0.2);
  }
  // Distance attenuation + stereo pan relative to the listener (your tank).
  spatial(pos) {
    const c = this.ctx;
    const g = c.createGain(); let out = g;
    if (pos) {
      const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z, d = Math.hypot(dx, dz);
      g.gain.value = clamp(1 / (1 + d / 14), 0, 1) * (d > 90 ? 0 : 1);
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(dx / 30, -0.8, 0.8); g.connect(p); p.connect(this.sfx); return g; }
    }
    out.connect(this.sfx); return g;
  }
  noiseSrc(dur) { const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(this.ctx.currentTime, Math.random() * 0.5); s.stop(this.ctx.currentTime + dur + 0.05); return s; }
  env(node, t0, peak, attack, decay) { node.gain.setValueAtTime(0.0001, t0); node.gain.exponentialRampToValueAtTime(peak, t0 + attack); node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay); }
  play(name, pos = null, vol = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime, out = this.spatial(pos);
    const osc = (type, f0, f1, dur, peak, att = 0.005) => {
      const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      this.env(g, t, peak * vol, att, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + att + 0.05);
    };
    const nz = (type, f0, f1, dur, peak, q = 0.8, att = 0.004) => {
      const s = this.noiseSrc(dur + att), f = c.createBiquadFilter(), g = c.createGain(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      this.env(g, t, peak * vol, att, dur); s.connect(f); f.connect(g); g.connect(out);
    };
    switch (name) {
      case 'cannon': osc('sine', 110, 38, 0.35, 0.9); nz('lowpass', 2400, 300, 0.45, 0.7); nz('highpass', 3000, 1500, 0.08, 0.25); break;
      case 'reload': { const d = c.createGain(); d.connect(out);
        for (const dt of [0, 0.09]) { const s = this.noiseSrc(0.05), f = c.createBiquadFilter(), g = c.createGain(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 4;
          g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.35 * vol, t + dt + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.04); s.connect(f); f.connect(g); g.connect(d); } break; }
      case 'impact': nz('lowpass', 1400, 200, 0.35, 0.6); osc('sine', 80, 40, 0.2, 0.5); break;
      case 'explosion': nz('lowpass', 1800, 120, 1.3, 0.95, 0.7, 0.01); osc('sine', 60, 28, 0.9, 0.9, 0.01); break;
      case 'deflect': osc('sine', 1300, 2400, 0.14, 0.25); break;
      case 'hitmark': osc('square', 1800, 1600, 0.05, 0.12); break;
      case 'hurt': osc('sawtooth', 140, 60, 0.25, 0.25); nz('lowpass', 900, 200, 0.25, 0.4); break;
      case 'click': osc('triangle', 900, 700, 0.05, 0.2); break;
      case 'spawn': osc('sine', 400, 900, 0.3, 0.2, 0.05); break;
    }
  }
  startEngine() {
    const c = this.ctx;
    this.eng = c.createOscillator(); this.eng.type = 'sawtooth'; this.eng.frequency.value = 42;
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 260;
    this.engG = c.createGain(); this.engG.gain.value = 0;
    this.eng.connect(this.engF); this.engF.connect(this.engG); this.engG.connect(this.sfx); this.eng.start();
    this.trk = c.createBufferSource(); this.trk.buffer = this.noise; this.trk.loop = true;
    this.trkF = c.createBiquadFilter(); this.trkF.type = 'bandpass'; this.trkF.frequency.value = 500; this.trkF.Q.value = 1.4;
    this.trkG = c.createGain(); this.trkG.gain.value = 0;
    this.trk.connect(this.trkF); this.trkF.connect(this.trkG); this.trkG.connect(this.sfx); this.trk.start();
  }
  engine(speed01, on) {
    if (!this.ctx || !this.eng) return; const t = this.ctx.currentTime; const s = on ? clamp(speed01, 0, 1) : 0;
    this.eng.frequency.setTargetAtTime(38 + s * 42, t, 0.1);
    this.engF.frequency.setTargetAtTime(220 + s * 500, t, 0.1);
    this.engG.gain.setTargetAtTime(on ? 0.05 + s * 0.08 : 0, t, 0.15);
    this.trkF.frequency.setTargetAtTime(380 + s * 600, t, 0.1);
    this.trkG.gain.setTargetAtTime(on ? s * 0.09 : 0, t, 0.1);
  }
  // Soft generative pad: slow chord changes, very cheap.
  startMusic() {
    if (!this.ctx || this.musicOn) return; this.musicOn = true;
    const c = this.ctx; const chords = [[110, 164.8, 220, 277.2], [98, 146.8, 196, 246.9], [87.3, 130.8, 174.6, 220], [98, 146.8, 196, 293.7]];
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(this.music);
    let i = 0;
    const next = () => {
      if (!this.musicOn) return;
      const t = c.currentTime; const ch = chords[i++ % chords.length];
      for (const f of ch) {
        for (const det of [-4, 4]) {
          const o = c.createOscillator(), g = c.createGain(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
          g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 6.5);
          o.connect(g); g.connect(lp); o.start(t); o.stop(t + 6.6);
        }
      }
      this.musicTimer = setTimeout(next, 5200);
    };
    next();
  }
  stopMusic() { this.musicOn = false; clearTimeout(this.musicTimer); }
}
