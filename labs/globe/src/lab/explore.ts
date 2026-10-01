// Explore-mode overlays: hub labels that follow the spires, a hover tooltip and a selection card.
// Plain DOM, one element per label, positioned with transforms (no layout thrash, no allocation).

import type { GlobeEngine, ScreenPoint } from '../engine/GlobeEngine';
import type { PickInfo } from '../engine/types';
import { NodeFlag } from '../engine/types';
import type { LabData } from './data';
import { placeName } from './gazetteer';

const TIER_NAME = ['Unknown', 'Cumulus', 'Nimbus', 'Stratus'];
const TIER_VAR = ['var(--ink-3)', 'var(--cumulus)', 'var(--nimbus)', 'var(--stratus)'];
const STATUS_NAME = ['Unknown', 'Confirmed', 'Started', 'At risk'];

/** Pool of label elements; at most `limit` are shown, the rest are candidates that replace culled ones. */
const MAX_LABELS = 20;

export class ExploreOverlay {
  private readonly root: HTMLElement;
  private readonly hubEls: HTMLElement[] = [];
  private readonly tip: HTMLElement;
  private readonly card: HTMLElement;
  private readonly moonTip: HTMLElement;
  private readonly toast: HTMLElement;
  private moonOn = false;
  private moonT = 0;
  private toastT = 0;
  /** The host's chain clock for the moon's tooltip (block height and seconds to the next block). */
  chain: (() => { height: number; nextIn: number }) | null = null;
  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false, depth: 0 };
  private hubs: ReturnType<GlobeEngine['getHubs']> = [];
  private hubT = 0;
  /** Label boxes already placed this frame (x, y, w per label) for collision culling, and cached text widths. */
  private readonly placed = new Float32Array((MAX_LABELS + 4) * 3);
  private readonly widths = new Float32Array(MAX_LABELS);
  private data: LabData | null = null;
  private hover: PickInfo | null = null;
  private selected: PickInfo | null = null;
  enabled = true;
  labels = true;
  private idToIdx = new Map<number, number>();
  private readonly off: (() => void)[] = [];

  constructor(
    private readonly engine: GlobeEngine,
    root: HTMLElement,
  ) {
    this.root = root;
    for (let i = 0; i < MAX_LABELS; i++) {
      const el = document.createElement('div');
      el.className = 'hub';
      el.style.opacity = '0';
      el.innerHTML = '<span></span><em></em>';
      root.appendChild(el);
      this.hubEls.push(el);
    }
    this.tip = document.createElement('div');
    this.tip.className = 'tip';
    root.appendChild(this.tip);
    this.card = document.createElement('div');
    this.card.className = 'card';
    root.appendChild(this.card);
    this.moonTip = document.createElement('div');
    this.moonTip.className = 'tip moon';
    root.appendChild(this.moonTip);
    this.toast = document.createElement('div');
    this.toast.className = 'toast';
    root.appendChild(this.toast);
    this.card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).dataset.act === 'close') engine.select(null);
    });
    this.off.push(
      engine.on('moonhover', (m) => {
        this.moonOn = m.hovered && this.enabled;
        this.moonT = 0;
        this.renderMoon();
      }),
      engine.on('moon', () => {
        // The app opens its About Flux window here; the lab just says so.
        this.toast.textContent = 'The app opens About Flux here';
        this.toast.classList.add('on');
        this.toastT = 2.6;
        this.moonTip.classList.remove('on');
      }),
      engine.on('devfund', (d) => this.fundChip(d.x, d.y)),
      engine.on('hover', (p) => {
        this.hover = p;
        this.renderTip();
      }),
      engine.on('select', (p) => {
        if (p && p.isCluster) {
          this.selected = null;
        } else {
          this.selected = p;
        }
        this.renderCard();
      }),
    );
  }

  setData(d: LabData): void {
    this.data = d;
    this.idToIdx.clear();
    for (let i = 0; i < d.cols.ids.length; i++) this.idToIdx.set(d.cols.ids[i], i);
  }

  private describe(p: PickInfo): { title: string; sub: string } {
    const place = Number.isFinite(p.lat) ? placeName(p.lat, p.lon) : 'Unlocated';
    const d = this.data;
    const idx = this.idToIdx.get(p.id);
    let org = '';
    if (d?.orgs && d.orgIdx && idx !== undefined) org = d.orgs[d.orgIdx[idx]] ?? '';
    return { title: p.isCluster ? `${place}` : `${TIER_NAME[p.tier]} node`, sub: p.isCluster ? `${p.clusterSize.toLocaleString('en-US')} nodes at this site` : org ? `${org} / ${place}` : place };
  }

  private renderTip(): void {
    const p = this.hover;
    if (!p || !this.enabled) {
      this.tip.classList.remove('on');
      return;
    }
    const d = this.describe(p);
    this.tip.innerHTML = `<b><span class="chip" style="background:${TIER_VAR[p.tier]};box-shadow:0 0 8px ${TIER_VAR[p.tier]}"></span>${d.title}</b>${d.sub}${p.isCluster ? '<br><span style="color:var(--ink-3)">click to unfurl</span>' : ''}`;
    this.tip.classList.add('on');
    this.tip.style.transform = `translate(${Math.round(p.x + 16)}px, ${Math.round(p.y + 14)}px)`;
  }

  /** The moon's hover card (design 6.4 P): the mark, the chain's height, the countdown, the network's size and the way in. */
  private renderMoon(): void {
    if (!this.moonOn) {
      this.moonTip.classList.remove('on');
      return;
    }
    const s = this.engine.nodes;
    const info = this.chain?.() ?? { height: 0, nextIn: 0 };
    const n = (v: number): string => v.toLocaleString('en-US');
    this.moonTip.innerHTML = `
      <b><img src="${import.meta.env.BASE_URL}brand/Flux_symbol-mark_blue.svg" alt="" width="12" height="14">Flux chain</b>
      <div class="row"><span>Block</span><em>${n(info.height)}</em></div>
      <div class="row"><span>Next block in</span><em>${Math.max(0, Math.round(info.nextIn))} s</em></div>
      <div class="row"><span>Network</span><em>${n(s.live)} nodes</em></div>
      <div class="hint">Click for About Flux <kbd>M</kbd></div>`;
    this.moonTip.classList.add('on');
  }

  /** The dev-fund chip: starts 26 px right of the bar and drifts 18 px right and 10 px up over 2.3 s (design 7.10.5); mirrored near the right edge. */
  private fundChip(x: number, y: number): void {
    const el = document.createElement('div');
    el.className = 'fund';
    el.innerHTML = '<i></i>+0.50 dev fund';
    this.root.appendChild(el);
    const w = el.offsetWidth || 110;
    const flip = x + 26 + 18 + w > this.engine.viewport.w - 8;
    const x0 = Math.round(flip ? x - 26 - w : x + 26);
    const y0 = Math.round(y);
    const dx = flip ? -18 : 18;
    // Reduced motion: the chip appears where it starts and fades, without the drift.
    const still = this.engine.reduced;
    const anim = el.animate(
      [
        { transform: `translate(${x0}px, ${y0}px) translateY(-50%)`, opacity: 0, offset: 0 },
        { opacity: 1, offset: still ? 0.06 : 0.12 },
        { opacity: 1, offset: 0.55 },
        { transform: `translate(${still ? x0 : x0 + dx}px, ${still ? y0 : y0 - 10}px) translateY(-50%)`, opacity: 0, offset: 1 },
      ],
      { duration: still ? 1600 : 2300, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'forwards' },
    );
    anim.onfinish = () => el.remove();
  }

  private renderCard(): void {
    const p = this.selected;
    if (!p) {
      this.card.classList.remove('on');
      return;
    }
    const e = this.engine;
    const slot = e.nodes.slotOf(p.id);
    e.mesh.buildAdjacency(e.nodes);
    const peers = slot >= 0 ? e.mesh.degree(slot) : 0;
    const d = this.describe(p);
    const flags: string[] = [];
    if (p.flags & NodeFlag.HasApps) flags.push('apps');
    if (p.flags & NodeFlag.Arcane) flags.push('ArcaneOS');
    if (p.flags & NodeFlag.New24h) flags.push('new');
    this.card.innerHTML = `
      <h3><span style="color:${TIER_VAR[p.tier]}">${TIER_NAME[p.tier]}</span> node #${p.id}</h3>
      <p>${d.sub}</p>
      <dl>
        <dt>Status</dt><dd>${STATUS_NAME[p.status] ?? 'Unknown'}</dd>
        <dt>Peers</dt><dd>${peers}</dd>
        <dt>Co-located</dt><dd>${p.clusterSize.toLocaleString('en-US')}</dd>
        <dt>Flags</dt><dd>${flags.join(', ') || 'none'}</dd>
        <dt>Position</dt><dd>${Number.isFinite(p.lat) ? `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}` : 'unlocated'}</dd>
      </dl>
      <button data-act="close">Clear selection</button>`;
    this.card.classList.add('on');
  }

  update(dt: number): void {
    const e = this.engine;
    if (this.moonOn) {
      const m = e.moonScreen();
      this.moonT -= dt;
      if (this.moonT <= 0) {
        this.moonT = 1;
        this.renderMoon();
      }
      // 8 px to the moon's left, flipped to its right when that would run off the screen; never above the top bar.
      const w = this.moonTip.offsetWidth || 210;
      const h = this.moonTip.offsetHeight || 110;
      const left = m.x - m.r - 8 - w;
      const x = left > 12 ? left : m.x + m.r + 8;
      const y = Math.max(60, Math.min(e.viewport.h - h - 12, m.y - h / 2));
      this.moonTip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.toast.classList.remove('on');
    }
    this.hubT -= dt;
    if (this.hubT <= 0) {
      this.hubT = 1.2;
      this.hubs = e.getHubs(MAX_LABELS).slice();
    }
    const range = e.rig.lodRange;
    const show = this.enabled && this.labels && e.mode === 'explore' && range > 0.55;
    const s = e.nodes;
    // Busiest hubs first; a label that would overlap one already placed stays hidden, and a phone
    // gets fewer of them.
    const limit = window.innerWidth < 720 ? 5 : 12;
    const placed = this.placed;
    let np = 0;
    let reserved = 0;
    // The next payees' city labels take priority over hub names: reserve their boxes first.
    if (show) {
      const aim = e.aimAnchors();
      const vw = e.viewport.w;
      for (let k = 0; k < aim.count && k < 4; k++) {
        const p = aim.list[k];
        if (!p.visible) continue;
        const side = p.x < vw * 0.62 ? 1 : -1;
        placed[reserved * 3] = side > 0 ? p.x + 30 : p.x - 140;
        placed[reserved * 3 + 1] = p.y - 30;
        placed[reserved * 3 + 2] = 110;
        reserved++;
      }
      np = reserved;
    }
    const mn = e.moonScreen();
    for (let i = 0; i < MAX_LABELS; i++) {
      const el = this.hubEls[i];
      const h = this.hubs[i];
      if (!h || !show || np - reserved >= limit) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        continue;
      }
      const cH = s.cHeight[h.cluster] * (1 - Math.min(1, Math.max(0, (e.u.uFan.value - 0.225) / 0.55)));
      const ok = e.project(h.lat, h.lon, 1.0012 + cH + 0.01, this.sp);
      if (!ok) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        continue;
      }
      if (el.dataset.c !== String(h.cluster)) {
        el.dataset.c = String(h.cluster);
        const name = placeName(h.lat, h.lon);
        const count = h.count.toLocaleString('en-US');
        (el.firstChild as HTMLElement).textContent = name;
        (el.lastChild as HTMLElement).textContent = count;
        this.widths[i] = 14 + (name.length + count.length) * 6.6;
      }
      const x = Math.round(this.sp.x + 6);
      const y = Math.round(this.sp.y - 8);
      const w = this.widths[i];
      // A label never sits on the moon.
      let clash = false;
      if (mn.visible) {
        const cx = Math.max(x, Math.min(mn.x, x + w));
        const cy = Math.max(y - 8, Math.min(mn.y, y + 8));
        if ((cx - mn.x) * (cx - mn.x) + (cy - mn.y) * (cy - mn.y) < mn.r * mn.r * 1.7) clash = true;
      }
      for (let k = 0; k < np && !clash; k++) {
        const px = placed[k * 3];
        const py = placed[k * 3 + 1];
        const pw = placed[k * 3 + 2];
        if (x < px + pw + 6 && x + w + 6 > px && Math.abs(y - py) < 15) {
          clash = true;
          break;
        }
      }
      if (clash) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        continue;
      }
      placed[np * 3] = x;
      placed[np * 3 + 1] = y;
      placed[np * 3 + 2] = w;
      np++;
      el.style.transform = `translate(${x}px, ${y}px)`;
      const fade = Math.min(1, (range - 0.55) / 0.5);
      el.style.opacity = String(Math.max(0, fade) * (e.u.uFocus.value > 0.4 ? 0.25 : 1));
    }
  }

  dispose(): void {
    for (const f of this.off) f();
    this.root.replaceChildren();
  }
}
