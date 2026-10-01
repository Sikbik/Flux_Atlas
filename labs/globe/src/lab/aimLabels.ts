// Labels for the pre-aimed next payees: a small city name on the free side of each reticle, joined
// by a hairline dashed leader (design 7.16). The engine draws the reticles; this only places text.

import type { GlobeEngine } from '../engine/GlobeEngine';
import { placeName } from './gazetteer';
import { tierMeter } from './glyphs';

const MAX = 4;

export class AimLabels {
  private readonly els: HTMLElement[] = [];
  private readonly ids: number[] = [];
  enabled = true;

  constructor(
    private readonly engine: GlobeEngine,
    root: HTMLElement,
  ) {
    for (let i = 0; i < MAX; i++) {
      const el = document.createElement('div');
      el.className = 'aim';
      el.innerHTML = '<svg class="leader" width="1" height="1"><line x1="0" y1="0" x2="0" y2="0"/></svg><span class="lab"></span>';
      root.appendChild(el);
      this.els.push(el);
      this.ids.push(-1);
    }
  }

  update(): void {
    const e = this.engine;
    const a = this.enabled ? e.aimAnchors() : { count: 0, list: [] };
    const w = e.viewport.w;
    const range = e.rig.lodRange;
    for (let i = 0; i < MAX; i++) {
      const el = this.els[i];
      if (i >= a.count || !a.list[i].visible || range < 0.05) {
        if (el.style.opacity !== '0') el.style.opacity = '0';
        continue;
      }
      const p = a.list[i];
      if (this.ids[i] !== p.id) {
        this.ids[i] = p.id;
        const s = e.nodes.slotOf(p.id);
        const name = s >= 0 && Number.isFinite(e.nodes.lat[s]) ? placeName(e.nodes.lat[s], e.nodes.lon[s]) : 'Unlocated';
        (el.lastChild as HTMLElement).innerHTML = `${tierMeter(p.tier)}<span>${name}</span>`;
      }
      const side = p.x < w * 0.62 ? 1 : -1;
      const dx = 34 * side;
      const dy = -30;
      const leader = el.firstChild as SVGElement;
      const line = leader.firstChild as SVGLineElement;
      line.setAttribute('x1', String(10 * side));
      line.setAttribute('y1', '-8');
      line.setAttribute('x2', String(dx));
      line.setAttribute('y2', String(dy + 7));
      const lab = el.lastChild as HTMLElement;
      lab.style.transform = `translate(${side > 0 ? dx : dx}px, ${dy}px) ${side > 0 ? '' : 'translateX(-100%)'}`;
      lab.style.position = 'absolute';
      lab.style.left = '0';
      lab.style.top = '0';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
      el.style.opacity = '1';
      el.style.color = `var(--tier-${p.tier === 3 ? 'stratus' : p.tier === 2 ? 'nimbus' : 'cumulus'})`;
    }
  }

  dispose(): void {
    for (const el of this.els) el.remove();
  }
}
