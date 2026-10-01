// Generative sound for the ambient mode. Muted by default; it only makes a noise after the host
// calls `setEnabled(true)` from a user gesture (browsers refuse audio before that).
//
// The score is the network itself. A low drone holds two open fifths under a slowly breathing
// filter. A block landing is a soft bell (its pitch walks a pentatonic scale with the height) over
// a low thump for the producer's flare. Each payout is a short pluck, pitched by tier (Cumulus,
// Nimbus, Stratus climb a pentatonic ladder) and panned to where the payee sits on screen. A
// pre-aimed payee gets a faint lock tick. Everything runs through a synthesized room reverb.
//
// Only the drone is continuous; every other voice is created on an event and dies on its own.

import type { GlobeEngine } from '../GlobeEngine';

// A minor pentatonic, in Hz, two octaves.
const SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0];

export class AmbientSound {
  volume = 0.6;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private dry: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private stopDrone: (() => void) | null = null;
  private on = false;
  private readonly off: (() => void)[] = [];
  private lastTick = 0;
  private readonly onVis = (): void => {
    if (!this.ctx) return;
    if (document.hidden) void this.ctx.suspend();
    else if (this.on) void this.ctx.resume();
  };

  constructor(private readonly engine: GlobeEngine) {
    this.off.push(
      engine.on('block', (b) => this.block(b.height)),
      engine.on('seal', (b) => this.seal(b.height)),
      engine.on('payout', (p) => this.payout(p.tier, p.x)),
      engine.on('aim', (a) => this.aim(a.payees.length)),
      engine.on('egg', () => this.clink()),
      engine.on('caption', (c) => this.scene(c.kind)),
    );
    document.addEventListener('visibilitychange', this.onVis);
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Turns the sound on or off. Call it from a click or key handler the first time. */
  setEnabled(on: boolean): void {
    this.on = on;
    if (on) {
      this.ensure();
      const ctx = this.ctx;
      if (!ctx || !this.master) return;
      void ctx.resume();
      const t = ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(this.volume * 0.85, t + 1.4);
    } else if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setValueAtTime(this.master.gain.value, t);
      this.master.gain.linearRampToValueAtTime(0, t + 0.5);
      const ctx = this.ctx;
      window.setTimeout(() => {
        if (!this.on) void ctx.suspend();
      }, 700);
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.on && this.ctx && this.master)
      this.master.gain.linearRampToValueAtTime(this.volume * 0.85, this.ctx.currentTime + 0.2);
  }

  dispose(): void {
    for (const f of this.off) f();
    document.removeEventListener('visibilitychange', this.onVis);
    this.stopDrone?.();
    this.stopDrone = null;
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }

  // ---- graph ------------------------------------------------------------------------------

  private ensure(): void {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const dry = ctx.createGain();
    dry.gain.value = 0.8;
    dry.connect(master);
    this.dry = dry;
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(ctx, 3.2, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    conv.connect(wet).connect(master);
    this.send = conv;

    this.startDrone(ctx);
  }

  private send: ConvolverNode | null = null;

  /** Exponentially decaying stereo noise: a dark, wide room. */
  private impulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const n = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, n, rate);
    let seed = 0x1badb002;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
        const r = (seed >>> 8) / 8388608 - 1;
        // One-pole low-pass that closes over time so the tail gets darker as it fades.
        const k = 0.65 - 0.5 * (i / n);
        lp += (r - lp) * k;
        d[i] = lp * (1 - i / n) ** decay;
      }
    }
    return buf;
  }

  private startDrone(ctx: AudioContext): void {
    const out = ctx.createGain();
    out.gain.value = 0.0;
    out.gain.linearRampToValueAtTime(0.055, ctx.currentTime + 3);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 0.6;
    filter.connect(out);
    out.connect(this.dry as GainNode);
    out.connect(this.send as ConvolverNode);
    this.droneFilter = filter;

    const oscs: OscillatorNode[] = [];
    const mk = (type: OscillatorType, f: number, g: number, detune = 0): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      const gg = ctx.createGain();
      gg.gain.value = g;
      o.connect(gg).connect(filter);
      o.start();
      oscs.push(o);
    };
    mk('sine', 55, 1.0);
    mk('sine', 82.41, 0.55);
    mk('triangle', 110.0, 0.32, 6);
    mk('triangle', 164.81, 0.14, -8);
    // The filter breathes: one slow LFO, about 20 s per cycle.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.05;
    const lg = ctx.createGain();
    lg.gain.value = 120;
    lfo.connect(lg).connect(filter.frequency);
    lfo.start();
    oscs.push(lfo);
    this.stopDrone = (): void => {
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      }
    };
  }

  // ---- voices -----------------------------------------------------------------------------

  private voice(
    freq: number,
    partials: number[],
    gains: number[],
    attack: number,
    decay: number,
    vol: number,
    pan = 0,
    when = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    const t = ctx.currentTime + when;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(vol, t + attack);
    out.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-0.85, Math.min(0.85, pan));
    out.connect(panner);
    panner.connect(this.dry as GainNode);
    panner.connect(this.send as ConvolverNode);
    const end = t + attack + decay + 0.1;
    for (let i = 0; i < partials.length; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * partials[i]!;
      const g = ctx.createGain();
      g.gain.value = gains[i]!;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(end);
    }
  }

  /** The glass bell: its pitch walks the scale with the block height. */
  private bell(height: number): void {
    const f = SCALE[(Math.abs(height) * 7 + 3) % SCALE.length]! * 1;
    this.voice(f, [1, 2.76, 5.4], [1, 0.32, 0.12], 0.006, 2.8, 0.2, 0);
    this.voice(f / 2, [1, 2.01], [1, 0.25], 0.01, 3.4, 0.1, 0, 0.02);
  }

  /** The moon sealed the block: the bell rings when the producer's beam arrives. */
  private seal(height: number): void {
    if (!this.ctx || !this.on) return;
    this.bell(height);
  }

  private block(height: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    // A low thump marks the producer's flare. With the moon on, the bell waits for the seal.
    if (!this.engine.moon.enabled) this.bell(height);
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.connect(g);
    g.connect(this.dry as GainNode);
    g.connect(this.send as ConvolverNode);
    o.start(t);
    o.stop(t + 0.8);
  }

  private payout(tier: number, x: number): void {
    // Cumulus, Nimbus, Stratus climb the ladder. Pan follows the payee's screen position.
    const rung = tier === 3 ? 9 : tier === 2 ? 7 : 4;
    const w = this.engine.viewport.w || 1;
    const pan = (x / w) * 2 - 1;
    this.voice(SCALE[rung]!, [1, 2, 3.01], [1, 0.22, 0.08], 0.004, 1.1, 0.13, pan);
  }

  private aim(n: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.on || n === 0) return;
    // Three faint lock ticks, a third apart, high and dry.
    for (let i = 0; i < Math.min(3, n); i++)
      this.voice(1760 + i * 220, [1], [1], 0.002, 0.16, 0.025, (i - 1) * 0.5, 0.6 + i * 0.14);
  }

  private scene(kind: string): void {
    const ctx = this.ctx;
    if (!ctx || !this.on || !this.droneFilter) return;
    // Busier scenes open the drone's filter a little.
    const open = kind === 'block' ? 520 : kind === 'app' || kind === 'region' ? 420 : 320;
    this.droneFilter.frequency.cancelScheduledValues(ctx.currentTime);
    this.droneFilter.frequency.linearRampToValueAtTime(open, ctx.currentTime + 2.5);
  }

  private clink(): void {
    const ctx = this.ctx;
    if (!ctx || !this.on) return;
    // Two glasses: a bright clink and its answer.
    this.voice(1568, [1, 2.4, 4.1], [1, 0.4, 0.15], 0.002, 0.9, 0.12, -0.3);
    this.voice(2093, [1, 2.4, 4.1], [1, 0.4, 0.15], 0.002, 1.1, 0.1, 0.3, 0.09);
  }

  /** Reserved for a future mempool whisper; kept quiet and rate-limited. */
  tick(): void {
    const now = performance.now();
    if (now - this.lastTick < 400) return;
    this.lastTick = now;
    this.voice(3136, [1], [1], 0.001, 0.05, 0.015, (Math.random() - 0.5) * 1.4);
  }
}
