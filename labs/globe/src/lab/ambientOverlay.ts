// The ambient overlay: minimal typography over the globe while the screensaver runs.
//
//   top left      the Atlas mark, the UTC clock
//   bottom left   the block height as an odometer, the countdown to the next block
//   bottom right  what the director is showing (a site, an app, the route of the latest block)
//   top right     the network's counters, only while the director dwells on them
//   floating      payout amounts rising from each payee; labels on the pre-aimed reticles
//   bottom        "asleep. move the mouse." (the stache.beer way of saying it is a screensaver)
//
// Everything is plain DOM with transforms and opacity. Text is sentence case, set in the design
// system's faces, and the whole layer drifts a few pixels per minute so a TV never burns in.

import { MOUSTACHE_SVG_PATH } from '../engine/ambient/egg';
import type { GlobeEngine } from '../engine/GlobeEngine';
import type { AmbientCaption } from '../engine/types';
import type { LabData } from './data';
import { ARROW, ATLAS_MARK, tierMeter } from './glyphs';

const BLOCK_SECONDS = 30;
const CIRC = 2 * Math.PI * 9;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** A tabular odometer: only the digits that changed roll, last digit first, 40 ms apart. */
class Odometer {
  readonly el = h('div', 'odo');
  private cols: { col: HTMLElement; strip: HTMLElement; pos: number; digit: number }[] = [];
  private text = '';
  private tintTimer = 0;
  reduced = false;

  set(value: number, animate = true): void {
    const s = Math.round(value).toLocaleString('en-US');
    if (s.length !== this.text.length) {
      this.build(s);
      return;
    }
    const prev = Number(this.text.replace(/,/g, ''));
    const rising = Number(s.replace(/,/g, '')) >= prev;
    let order = 0;
    let n = 0;
    for (let i = 0; i < s.length; i++) if (s[i] !== ',' && s[i] !== this.text[i]) n++;
    for (let i = s.length - 1; i >= 0; i--) {
      if (s[i] === ',' || s[i] === this.text[i]) continue;
      const c = this.cols[i];
      const d = Number(s[i]);
      const step = (d - c.digit + 10) % 10;
      c.digit = d;
      c.pos += step;
      const delay = animate && !this.reduced ? order * 40 : 0;
      c.strip.style.transitionDuration = animate && !this.reduced ? '' : '0ms';
      c.strip.style.transitionDelay = `${delay}ms`;
      c.strip.style.transform = `translateY(${-c.pos}em)`;
      c.col.classList.add('changed');
      order++;
      const done = (): void => {
        if (c.pos >= 10) {
          c.pos -= 10;
          c.strip.style.transition = 'none';
          c.strip.style.transform = `translateY(${-c.pos}em)`;
          void c.strip.offsetHeight;
          c.strip.style.transition = '';
        }
      };
      window.setTimeout(done, (animate ? 440 + delay : 0) + 30);
    }
    if (n > 0) {
      this.el.classList.toggle('rise', rising);
      this.el.classList.toggle('fall', !rising);
      window.clearTimeout(this.tintTimer);
      this.tintTimer = window.setTimeout(() => {
        this.el.classList.remove('rise', 'fall');
        for (const c of this.cols) c.col.classList.remove('changed');
      }, 640);
    }
    this.text = s;
  }

  private build(s: string): void {
    this.el.replaceChildren();
    this.cols = [];
    for (const ch of s) {
      if (ch === ',') {
        const sep = h('span', 'sep', ',');
        this.el.append(sep);
        this.cols.push({ col: sep, strip: sep, pos: 0, digit: 0 });
        continue;
      }
      const col = h('span', 'col');
      const strip = h('span', 'strip');
      for (let k = 0; k < 20; k++) strip.append(h('span', undefined, String(k % 10)));
      const d = Number(ch);
      strip.style.transitionDuration = '0ms';
      strip.style.transform = `translateY(${-d}em)`;
      col.append(strip);
      this.el.append(col);
      this.cols.push({ col, strip, pos: d, digit: d });
    }
    this.text = s;
  }
}

export class AmbientOverlay {
  private readonly root: HTMLElement;
  private readonly wrap = h('div', 'amb');
  private readonly drift = h('div', 'amb-drift');
  private readonly clock = h('div', 'amb-clock');
  private readonly odo = new Odometer();
  private readonly next = h('div', 'amb-next');
  private readonly nextText = h('span');
  private readonly ring: SVGCircleElement;
  private readonly scene = h('div', 'amb-scene amb-item');
  private readonly route = h('div', 'amb-scene amb-item');
  private readonly stats = h('div', 'amb-scene amb-item');
  private readonly asleep = h('div', 'amb-asleep', 'asleep. move the mouse.');
  private readonly egg = h('div', 'egg');
  private readonly floaters: HTMLElement[] = [];
  private floatIdx = 0;
  private active = false;
  private enteredAt = 0;
  private nextAt = 0;
  private lastBlockAt = 0;
  private clockT = 0;
  private sceneTimer = 0;
  private routeTimer = 0;
  private statsTimer = 0;
  private asleepTimer = 0;
  private eggTimer = 0;
  private paid = new Map<number, HTMLElement>();
  private readonly off: (() => void)[] = [];
  private reduced = false;

  constructor(
    private readonly engine: GlobeEngine,
    root: HTMLElement,
    private readonly data: () => LabData,
    private readonly height: () => number,
  ) {
    this.root = root;
    const tl = h('div', 'amb-tl');
    tl.innerHTML = `<div class="amb-mark">${ATLAS_MARK}<span>Flux Atlas</span></div>`;
    tl.append(this.clock);
    const bl = h('div', 'amb-bl');
    bl.append(h('div', 'amb-label', 'Block height'), this.odo.el);
    const beat = `<svg class="beat" viewBox="0 0 22 22" aria-hidden="true"><defs><linearGradient id="beat-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--accent-500)"/><stop offset="1" stop-color="var(--hot)"/></linearGradient></defs><circle class="track" cx="11" cy="11" r="9"/><circle class="prog" cx="11" cy="11" r="9" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/></svg>`;
    this.next.innerHTML = beat;
    this.next.append(this.nextText);
    bl.append(this.next);
    this.ring = this.next.querySelector('.prog') as SVGCircleElement;
    const br = h('div', 'amb-br');
    br.append(this.scene, this.route);
    const tr = h('div', 'amb-tr');
    tr.append(this.stats);
    this.egg.innerHTML = `<svg viewBox="0 0 200 60" aria-hidden="true"><path pathLength="1" d="${MOUSTACHE_SVG_PATH}" transform="translate(0,-2)"/></svg><span>stache.beer</span><small>brewed, not hosted</small>`;
    this.drift.append(tl, bl, br, tr, this.asleep, this.egg);
    this.wrap.append(this.drift);
    for (let i = 0; i < 8; i++) {
      const f = h('div', 'payout');
      this.wrap.append(f);
      this.floaters.push(f);
    }
    root.append(this.wrap);

    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.reduced = !!mql?.matches;
    this.odo.reduced = this.reduced;

    this.odo.set(this.height(), false);
    this.off.push(
      engine.on('block', (b) => this.onBlock(b.height)),
      engine.on('aim', (a) => {
        this.nextAt = performance.now() + a.eta;
      }),
      engine.on('caption', (c) => this.onCaption(c)),
      engine.on('payout', (p) => this.onPayout(p.id, p.tier, p.amount, p.x, p.y)),
      engine.on('egg', () => this.onEgg()),
    );
  }

  setActive(on: boolean): void {
    this.active = on;
    document.body.classList.toggle('ambient', on);
    if (on) {
      this.enteredAt = performance.now();
      this.odo.set(this.height(), false);
      this.nextAt = this.nextAt > performance.now() ? this.nextAt : performance.now() + BLOCK_SECONDS * 1000;
      this.lastBlockAt = this.nextAt - BLOCK_SECONDS * 1000;
      this.asleep.classList.add('on');
      window.clearTimeout(this.asleepTimer);
      this.asleepTimer = window.setTimeout(() => this.asleep.classList.remove('on'), 7000);
    } else {
      window.clearTimeout(this.asleepTimer);
      this.asleep.classList.remove('on');
      this.scene.classList.remove('on');
      this.route.classList.remove('on');
      this.stats.classList.remove('on');
      this.egg.classList.remove('on');
    }
  }

  /** Pointer movement and keys wake the screensaver, but not in the first instant after entering. */
  canWake(): boolean {
    return performance.now() - this.enteredAt > 900;
  }

  // ---- events -----------------------------------------------------------------------------

  private onBlock(height: number): void {
    this.odo.set(height, true);
    this.lastBlockAt = performance.now();
    this.nextAt = this.lastBlockAt + BLOCK_SECONDS * 1000;
    this.paid.clear();
  }

  private swap(el: HTMLElement, html: string, seconds: number, timerKey: 'sceneTimer' | 'routeTimer' | 'statsTimer'): void {
    window.clearTimeout(this[timerKey]);
    const show = (): void => {
      el.innerHTML = html;
      el.classList.add('on');
    };
    if (el.classList.contains('on')) {
      el.classList.remove('on');
      window.setTimeout(show, 420);
    } else show();
    this[timerKey] = window.setTimeout(() => el.classList.remove('on'), Math.max(2, seconds) * 1000 + 420);
  }

  private onCaption(c: AmbientCaption): void {
    if (!this.active) return;
    if (c.kind === 'block') {
      // The route of the latest block: producer, arrow, payees (amounts appear as they land).
      this.paid.clear();
      const to = (c.payees ?? [])
        .map((p, i) => `<span class="to" data-i="${i}">${tierMeter(p.tier)}<span>${p.name}</span><em></em></span>`)
        .join('');
      const html = `<div class="s" style="margin:0 0 10px">Block ${(c.height ?? 0).toLocaleString('en-US')}</div><div class="route"><span class="from">${c.producerName ?? ''}</span>${ARROW}${to}</div>`;
      this.scene.classList.remove('on');
      this.swap(this.route, html, c.duration, 'routeTimer');
      // Re-index payees by node id as payouts arrive (see onPayout).
      window.setTimeout(() => {
        const els = this.route.querySelectorAll('.to');
        els.forEach((el, i) => {
          const p = c.payees?.[i];
          if (p) (el as HTMLElement).dataset.tier = String(p.tier);
        });
      }, 500);
      return;
    }
    if (c.kind === 'stats') {
      const d = this.data();
      this.route.classList.remove('on');
      const nodes = this.engine.nodes.live;
      const hosts = d.hosts;
      const apps = d.apps.names.length;
      this.swap(this.stats, `<div class="amb-stats"><div data-n="${nodes}">0<small>nodes</small></div><div data-n="${hosts}">0<small>hosts</small></div><div data-n="${apps}">0<small>apps</small></div></div>`, c.duration, 'statsTimer');
      window.setTimeout(() => this.countUp(), 480);
      return;
    }
    if (c.kind === 'egg') return;
    // A site, an app, a region, the mesh: the director's current shot.
    this.route.classList.remove('on');
    this.stats.classList.remove('on');
    const sub = c.subtitle ? `<div class="s">${c.subtitle}</div>` : '';
    this.swap(this.scene, `<div class="t">${c.title}</div>${sub}`, c.duration, 'sceneTimer');
  }

  private countUp(): void {
    const els = this.stats.querySelectorAll<HTMLElement>('[data-n]');
    const t0 = performance.now();
    const step = (): void => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      const e = 1 - Math.pow(2, -10 * k);
      els.forEach((el) => {
        const n = Number(el.dataset.n);
        const small = el.querySelector('small');
        el.firstChild!.textContent = Math.round(n * e).toLocaleString('en-US');
        if (small && el.lastChild !== small) el.append(small);
      });
      if (k < 1 && this.stats.classList.contains('on')) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private onPayout(id: number, tier: number, amount: number, x: number, y: number): void {
    if (!this.active) return;
    // The route line gets the amount next to the payee of that tier.
    const els = this.route.querySelectorAll<HTMLElement>('.to');
    for (const el of Array.from(els)) {
      if (Number(el.dataset.tier) === tier && !el.classList.contains('paid')) {
        const em = el.querySelector('em');
        if (em) em.textContent = amount ? `+${amount.toFixed(2)}` : '';
        el.classList.add('paid');
        break;
      }
    }
    void id;
    // A floating amount rising from the payee (design: rises 14 px and fades over 2.4 s).
    const f = this.floaters[this.floatIdx++ % this.floaters.length];
    f.textContent = amount ? `+${amount.toFixed(2)}` : '+';
    f.style.color = `var(--tier-${tier === 3 ? 'stratus' : tier === 2 ? 'nimbus' : 'cumulus'})`;
    f.style.left = `${Math.round(x + 14)}px`;
    f.style.top = `${Math.round(y - 8)}px`;
    f.getAnimations().forEach((a) => a.cancel());
    f.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)', offset: 0.12 },
        { opacity: 1, transform: 'translateY(-8px)', offset: 0.55 },
        { opacity: 0, transform: 'translateY(-14px)' },
      ],
      { duration: this.reduced ? 1200 : 2400, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    );
  }

  private onEgg(): void {
    this.egg.classList.remove('on');
    void this.egg.getBoundingClientRect();
    this.egg.classList.add('on');
    window.clearTimeout(this.eggTimer);
    this.eggTimer = window.setTimeout(() => this.egg.classList.remove('on'), 6500);
  }

  // ---- per frame --------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.active) return;
    this.clockT -= dt;
    if (this.clockT <= 0) {
      this.clockT = 0.5;
      const d = new Date();
      this.clock.textContent = `${d.toISOString().slice(11, 19)} UTC`;
      this.updateNext();
    }
  }

  private updateNext(): void {
    const now = performance.now();
    const since = (now - this.lastBlockAt) / 1000;
    const left = (this.nextAt - now) / 1000;
    this.next.classList.remove('late', 'soon');
    if (left <= -5) {
      this.next.classList.add('late');
      this.nextText.textContent = `Block late ${Math.round(since)} s`;
    } else {
      const secs = Math.max(0, Math.ceil(left));
      if (secs <= 5) this.next.classList.add('soon');
      this.nextText.innerHTML = `Next block in <b>${secs} s</b>`;
    }
    const p = Math.min(1, Math.max(0, since / BLOCK_SECONDS));
    this.ring.setAttribute('stroke-dashoffset', String(CIRC * (1 - p)));
  }

  dispose(): void {
    for (const f of this.off) f();
    window.clearTimeout(this.sceneTimer);
    window.clearTimeout(this.routeTimer);
    window.clearTimeout(this.statsTimer);
    window.clearTimeout(this.asleepTimer);
    window.clearTimeout(this.eggTimer);
    this.wrap.remove();
    document.body.classList.remove('ambient');
    void this.root;
  }
}
