// The lab's dev HUD: live stats and every switch the brief asks for (art direction, effects,
// ambient mode, event speed) plus the data source, quality, filters and app constellations.

import type { GlobeEngine } from '../engine/GlobeEngine';
import type { ArtDirection, EffectToggles, QualityLevel } from '../engine/types';
import type { LabData } from './data';
import type { Feed } from './feed';

export interface HudHandlers {
  setData(kind: 'real' | 'synth15' | 'synth30'): void;
  setAmbient(on: boolean): void;
  showApp(index: number): void;
  clearApp(): void;
  onSound(on: boolean): void;
  /** Plays the boot sequence (the symbol assembles, lifts off and becomes the moon). */
  boot(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Hud {
  readonly root = el('div', 'hud');
  private readonly statEls: Record<string, HTMLElement> = {};
  private readonly logEl = el('div', 'hud-log');
  private readonly lines: string[] = [];
  private t = 0;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private appSelect: HTMLSelectElement | null = null;

  constructor(
    private readonly engine: GlobeEngine,
    private readonly feed: () => Feed | null,
    handlers: HudHandlers,
    parent: HTMLElement,
  ) {
    const head = el('div', 'hud-head');
    const title = el('div', 'hud-title');
    title.innerHTML = '<i></i>Globe lab';
    const collapse = el('button', undefined, '_');
    collapse.title = 'Collapse (H)';
    collapse.addEventListener('click', () => this.root.classList.toggle('collapsed'));
    head.append(title, collapse);
    this.root.append(head);
    // On a phone the panel would cover the globe, so it starts collapsed there.
    if (typeof window !== 'undefined' && window.innerWidth < 720) this.root.classList.add('collapsed');

    const stats = el('div', 'hud-stats');
    for (const [k, label] of [
      ['fps', 'fps'],
      ['ms', 'frame ms'],
      ['cpu', 'cpu ms'],
      ['draws', 'draws'],
      ['nodes', 'nodes'],
      ['clusters', 'hubs'],
      ['packets', 'packets'],
      ['queue', 'queued'],
    ]) {
      const s = el('div', 'hud-stat');
      const b = el('b', undefined, '-');
      const sp = el('span', undefined, label);
      s.append(b, sp);
      stats.append(s);
      this.statEls[k] = b;
    }
    this.root.append(stats);

    this.group('Art direction');
    const art = el('div', 'hud-row');
    (['dotmatrix', 'marble', 'neon'] as ArtDirection[]).forEach((a) => {
      art.append(this.button(`art:${a}`, a === 'dotmatrix' ? 'Dot matrix' : a === 'marble' ? 'Marble' : 'Neon', engine.artDirection === a, () => {
        engine.setArtDirection(a);
        this.refresh();
      }));
    });
    this.root.append(art);

    this.group('Mesh');
    const mesh = el('div', 'hud-row');
    for (const m of ['off', 'selection', 'flow'] as const) {
      mesh.append(this.button(`mesh:${m}`, m === 'off' ? 'Off' : m === 'selection' ? 'Selection' : 'Flow', engine.meshMode === m, () => {
        engine.setMeshMode(m);
        this.refresh();
      }));
    }
    this.root.append(mesh);

    this.group('Mode');
    const mode = el('div', 'hud-row');
    mode.append(
      this.button('mode:explore', 'Explore', engine.mode === 'explore', () => {
        handlers.setAmbient(false);
        this.refresh();
      }),
      this.button('mode:ambient', 'Ambient (A)', engine.mode === 'ambient', () => {
        handlers.setAmbient(true);
        this.refresh();
      }),
      this.button('mode:next', 'Next scene', false, () => engine.ambient.next()),
      this.button('mode:egg', 'Egg', false, () => engine.ambient.egg()),
    );
    this.root.append(mode);

    this.group('Flux moon');
    const moon = el('div', 'hud-row');
    moon.append(
      this.button('moon:on', 'Moon', engine.moon.enabled, () => {
        const on = !engine.moon.enabled;
        engine.setMoon({ enabled: on });
        this.buttons.get('moon:on')?.setAttribute('aria-pressed', String(on));
      }),
      this.button('moon:guides', 'Guides', engine.moon.opts.guides, () => {
        const on = !engine.moon.opts.guides;
        engine.setMoon({ guides: on });
        this.buttons.get('moon:guides')?.setAttribute('aria-pressed', String(on));
      }),
      this.button('moon:chain', 'Chain', engine.moon.opts.chain, () => {
        const on = !engine.moon.opts.chain;
        engine.setMoon({ chain: on });
        this.buttons.get('moon:chain')?.setAttribute('aria-pressed', String(on));
      }),
    );
    this.root.append(moon);
    // Placement mode (design 7.10.12): the shell's companion, the sky orbit, or automatic (companion in explore, orbit in ambient).
    const mm = el('div', 'hud-row');
    for (const k of ['auto', 'companion', 'orbit'] as const) {
      mm.append(this.button(`moonmode:${k}`, k, k === 'auto', () => {
        engine.setMoon({ mode: k });
        for (const kk of ['auto', 'companion', 'orbit']) this.buttons.get(`moonmode:${kk}`)?.setAttribute('aria-pressed', String(kk === k));
      }));
    }
    mm.append(
      this.button('moon:reduced', 'reduced', engine.reduced, () => {
        const on = !engine.reduced;
        engine.setReduced(on);
        engine.setMoon({});
        this.buttons.get('moon:reduced')?.setAttribute('aria-pressed', String(on));
      }),
    );
    this.root.append(mm);
    const mv = el('div', 'hud-row');
    for (const k of ['portrait', 'earthrise', 'eclipse', 'follow'] as const) {
      mv.append(this.button(`moonview:${k}`, k, false, () => {
        if (engine.mode === 'ambient') handlers.setAmbient(false);
        const cost = engine.viewMoon(k);
        if (k === 'eclipse' && cost > 1.2) this.log(`eclipse framing is loose right now (cost ${cost.toFixed(1)})`);
      }));
    }
    mv.append(this.button('moonview:release', 'release', false, () => engine.releaseCamera()), this.button('moon:boot', 'boot', false, () => handlers.boot()));
    this.root.append(mv);
    const mp = el('div', 'hud-row slider');
    const mps = document.createElement('input');
    mps.type = 'range';
    mps.min = '0';
    mps.max = '360';
    mps.step = '1';
    mps.value = '0';
    const mpv = el('span', undefined, 'live');
    mps.addEventListener('input', () => {
      const v = Number(mps.value);
      engine.setMoon({ phase: v === 0 ? null : v });
      mpv.textContent = v === 0 ? 'live' : `${v}\u00b0`;
    });
    mp.append(el('span', undefined, 'phase'), mps, mpv);
    this.root.append(mp);

    this.group('Data');
    const data = el('div', 'hud-row');
    for (const [k, label] of [
      ['real', 'Real 6.7k'],
      ['synth15', 'Synth 15k'],
      ['synth30', 'Synth 30k'],
    ] as const) {
      data.append(this.button(`data:${k}`, label, k === 'real', () => {
        handlers.setData(k);
        for (const kk of ['real', 'synth15', 'synth30']) this.buttons.get(`data:${kk}`)?.setAttribute('aria-pressed', String(kk === k));
      }));
    }
    this.root.append(data);

    this.group('Events');
    const ev = el('div', 'hud-row slider');
    const sl = document.createElement('input');
    sl.type = 'range';
    sl.min = '0';
    sl.max = '3';
    sl.step = '0.02';
    sl.value = '0';
    const sv = el('span', undefined, '1x');
    sl.addEventListener('input', () => {
      const v = Math.pow(10, Number(sl.value) * 0.6);
      sv.textContent = `${v < 10 ? v.toFixed(1) : Math.round(v)}x`;
      this.feed()?.setSpeed(v);
    });
    ev.append(el('span', undefined, 'speed'), sl, sv);
    this.root.append(ev);
    const evb = el('div', 'hud-row');
    evb.append(
      this.button('feed', 'Feed on', true, () => {
        const f = this.feed();
        if (!f) return;
        const on = this.buttons.get('feed')?.getAttribute('aria-pressed') !== 'true';
        if (on) f.start();
        else f.stop();
        this.buttons.get('feed')?.setAttribute('aria-pressed', String(on));
      }),
      this.button('block', 'Block now', false, () => this.feed()?.blockNow()),
    );
    this.root.append(evb);

    this.group('Time');
    const sun = el('div', 'hud-row slider');
    const ss = document.createElement('input');
    ss.type = 'range';
    ss.min = '0';
    ss.max = '2000';
    ss.step = '1';
    ss.value = '0';
    const sv2 = el('span', undefined, 'live');
    ss.addEventListener('input', () => {
      const v = Number(ss.value);
      const rate = v === 0 ? 1 : v * 30;
      engine.setSunRate(rate);
      sv2.textContent = v === 0 ? 'live' : `${Math.round(rate)}x`;
    });
    sun.append(el('span', undefined, 'sun'), ss, sv2);
    this.root.append(sun);

    this.group('Effects');
    const fx = el('div', 'hud-row');
    const keys: (keyof EffectToggles)[] = ['bloom', 'chromatic', 'grain', 'vignette', 'atmosphere', 'stars', 'clouds', 'nightLights', 'terminator', 'mesh', 'spires', 'labels'];
    for (const k of keys) {
      fx.append(this.button(`fx:${k}`, k === 'nightLights' ? 'lights' : k === 'chromatic' ? 'chroma' : k, engine.effects[k], () => {
        const on = !engine.effects[k];
        engine.setEffects({ [k]: on });
        this.buttons.get(`fx:${k}`)?.setAttribute('aria-pressed', String(on));
      }));
    }
    this.root.append(fx);

    this.group('Quality');
    const q = el('div', 'hud-row');
    for (const lv of ['auto', 'high', 'medium', 'low'] as QualityLevel[]) {
      q.append(this.button(`q:${lv}`, lv, engine.qualityLevel === lv, () => {
        engine.setQuality(lv);
        for (const l2 of ['auto', 'high', 'medium', 'low']) this.buttons.get(`q:${l2}`)?.setAttribute('aria-pressed', String(l2 === lv));
      }));
    }
    this.root.append(q);

    this.group('Filter');
    const fl = el('div', 'hud-row');
    let tiers = 0b1110;
    const apply = (): void => {
      engine.setFilter(tiers === 0b1110 && !this.onlyApps && !this.onlyArcane ? null : {
        tiers,
        requireFlags: (this.onlyApps ? 1 : 0) | (this.onlyArcane ? 16 : 0),
      });
    };
    for (const [bit, name] of [[1, 'cumulus'], [2, 'nimbus'], [3, 'stratus']] as const) {
      fl.append(this.button(`t:${name}`, name, true, () => {
        tiers ^= 1 << bit;
        this.buttons.get(`t:${name}`)?.setAttribute('aria-pressed', String((tiers & (1 << bit)) !== 0));
        apply();
      }));
    }
    fl.append(
      this.button('apps', 'has apps', false, () => {
        this.onlyApps = !this.onlyApps;
        this.buttons.get('apps')?.setAttribute('aria-pressed', String(this.onlyApps));
        apply();
      }),
      this.button('arcane', 'ArcaneOS', false, () => {
        this.onlyArcane = !this.onlyArcane;
        this.buttons.get('arcane')?.setAttribute('aria-pressed', String(this.onlyArcane));
        apply();
      }),
    );
    this.root.append(fl);

    this.group('App constellation');
    const ap = el('div', 'hud-row');
    this.appSelect = document.createElement('select');
    ap.append(
      this.appSelect,
      this.button('showapp', 'Show', false, () => handlers.showApp(Number(this.appSelect?.value ?? 0))),
      this.button('clearapp', 'Clear', false, () => handlers.clearApp()),
    );
    this.root.append(ap);

    this.group('Sound');
    const snd = el('div', 'hud-row');
    snd.append(this.button('sound', 'Generative sound', false, () => {
      const on = this.buttons.get('sound')?.getAttribute('aria-pressed') !== 'true';
      this.buttons.get('sound')?.setAttribute('aria-pressed', String(on));
      handlers.onSound(on);
    }));
    this.root.append(snd);

    this.root.append(this.logEl);
    parent.append(this.root);
  }

  private onlyApps = false;
  private onlyArcane = false;

  setApps(data: LabData): void {
    if (!this.appSelect) return;
    this.appSelect.replaceChildren();
    const top = data.apps.names
      .map((n, i) => ({ n, i, c: data.apps.offsets[i + 1] - data.apps.offsets[i] }))
      .sort((a, b) => b.c - a.c)
      .slice(0, 40);
    for (const a of top) {
      const o = document.createElement('option');
      o.value = String(a.i);
      o.textContent = `${a.n} (${a.c})`;
      this.appSelect.append(o);
    }
  }

  private group(label: string): void {
    this.root.append(el('div', 'hud-group', label));
  }

  private button(key: string, label: string, pressed: boolean, fn: () => void): HTMLButtonElement {
    const b = el('button', undefined, label);
    b.setAttribute('aria-pressed', String(pressed));
    b.addEventListener('click', fn);
    this.buttons.set(key, b);
    return b;
  }

  refresh(): void {
    const e = this.engine;
    for (const a of ['dotmatrix', 'marble', 'neon']) this.buttons.get(`art:${a}`)?.setAttribute('aria-pressed', String(e.artDirection === a));
    for (const m of ['explore', 'ambient']) this.buttons.get(`mode:${m}`)?.setAttribute('aria-pressed', String(e.mode === m));
    for (const m of ['off', 'selection', 'flow']) this.buttons.get(`mesh:${m}`)?.setAttribute('aria-pressed', String(e.meshMode === m));
  }

  log(line: string): void {
    const t = new Date().toISOString().slice(11, 19);
    this.lines.push(`${t} ${line}`);
    if (this.lines.length > 5) this.lines.shift();
    this.logEl.textContent = this.lines.join('\n');
  }

  update(dt: number): void {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    const s = this.engine.stats;
    this.statEls.fps.textContent = s.fps.toFixed(0);
    this.statEls.ms.textContent = s.frameMs.toFixed(1);
    this.statEls.cpu.textContent = s.cpuMs.toFixed(1);
    this.statEls.draws.textContent = String(s.drawCalls);
    this.statEls.nodes.textContent = s.nodes.toLocaleString('en-US');
    this.statEls.clusters.textContent = String(s.clusters);
    this.statEls.packets.textContent = String(s.packets);
    this.statEls.queue.textContent = String(s.queued);
  }
}
