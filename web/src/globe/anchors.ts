// The anchor system: HTML labels, tooltips and window tethers that follow the globe, positioned from
// ONE loop. It runs on the engine's `frame` event (after the frame is rendered, in the same
// animation frame), so a label never lags the planet by a frame, and writes the DOM directly
// (`transform`, `visibility`, an SVG path's `d`): no React state, no re-render per frame.
//
// Anchors:
//   { kind: 'world', lat, lon, alt? }   a surface point, projected by the engine (`labelAnchors`),
//                                        occlusion-culled behind the planet
//   { kind: 'node', id }                 a node's display position (store id; rides stacks and fans)
//   { kind: 'moon', at? }                the Flux moon: its centre, or `tether`, the point just
//                                        outside its hexagon ring at the upper right (design 6.4 A)
//   { kind: 'element', el, fx?, fy?, dx?, dy? }   a point on a DOM element's box (a window header)
//   { kind: 'point', x, y }              a fixed viewport point
//
// Placements (`place`) move an element to an anchor; tethers (`tether`) route an SVG path from one
// anchor to another with one 45 degree elbow. Labels in a `group` are collision-culled in priority
// order and kept out of the moon's clearance circle (design 7.7).

import type { LabelAnchor, LabelAnchorInput, ScreenPoint } from './engine/GlobeEngine';
import type { MoonState } from './engine/moon/moon';

export type Anchor =
  | { kind: 'world'; lat: number; lon: number; alt?: number }
  | { kind: 'node'; id: number }
  | { kind: 'moon'; at?: 'center' | 'tether' }
  | { kind: 'element'; el: Element | null; fx?: number; fy?: number; dx?: number; dy?: number }
  | { kind: 'point'; x: number; y: number };

/** The engine calls the anchor system needs (a subset of `GlobeEngine`). */
export interface AnchorEngine {
  setLabelAnchors(list: readonly LabelAnchorInput[]): void;
  labelAnchors(): readonly LabelAnchor[];
  projectNode(id: number, out: ScreenPoint): boolean;
  moonState(): MoonState;
  on(type: 'frame', cb: () => void): () => void;
}

/** A resolved anchor for this frame (viewport CSS pixels). */
export interface AnchorPoint {
  x: number;
  y: number;
  visible: boolean;
  /** 1 facing the camera, 0 at the limb (world and node anchors; 1 otherwise). */
  facing: number;
}

export interface PlaceOptions {
  /** Pixel offset applied after the anchor (for example to sit above a node). */
  dx?: number;
  dy?: number;
  /** Labels with the same group are collision-culled together, lower `priority` first wins. */
  group?: string;
  priority?: number;
  /** Keep out of the moon's clearance circle (labels; default true when `group` is set). */
  avoidMoon?: boolean;
  /** Fade with the facing angle near the limb (default true for world anchors). */
  fade?: boolean;
  /** Called after each update with the resolved point (for custom drawing). */
  onUpdate?: (p: AnchorPoint) => void;
}

export interface Handle {
  set(anchor: Anchor): void;
  remove(): void;
}

interface Placement {
  el: HTMLElement;
  anchor: Anchor;
  opts: PlaceOptions;
  worldIndex: number;
  w: number;
  h: number;
  lastX: number;
  lastY: number;
  lastShown: boolean;
  lastOpacity: number;
  p: AnchorPoint;
}

interface Tether {
  path: SVGPathElement;
  from: Anchor;
  to: Anchor;
  fromWorld: number;
  toWorld: number;
  lastD: string;
}

const node = (): AnchorPoint => ({ x: 0, y: 0, visible: false, facing: 1 });

export class AnchorSystem {
  private engine: AnchorEngine | null = null;
  private offFrame: (() => void) | null = null;
  private readonly placements = new Set<Placement>();
  private readonly tethers = new Set<Tether>();
  private worldDirty = true;
  private canvasLeft = 0;
  private canvasTop = 0;
  private readonly sp: ScreenPoint = { x: 0, y: 0, visible: false, depth: 0 };
  private readonly boxes: number[] = [];
  /** Frames run (for tests and diagnostics). */
  frames = 0;

  /** Connects to an engine (or detaches with null). The loop runs on the engine's frame event. */
  attach(engine: AnchorEngine | null, canvas?: HTMLElement | null): void {
    this.offFrame?.();
    this.offFrame = null;
    this.engine = engine;
    this.worldDirty = true;
    if (canvas) {
      const r = canvas.getBoundingClientRect();
      this.canvasLeft = r.left;
      this.canvasTop = r.top;
    }
    if (engine) this.offFrame = engine.on('frame', () => this.update());
    else this.hideAll();
  }

  /** Positions `el` at `anchor` every frame. `el` should be `position: absolute; left: 0; top: 0`. */
  place(el: HTMLElement, anchor: Anchor, opts: PlaceOptions = {}): Handle {
    const p: Placement = {
      el,
      anchor,
      opts,
      worldIndex: -1,
      w: 0,
      h: 0,
      lastX: Number.NaN,
      lastY: Number.NaN,
      lastShown: true,
      lastOpacity: 1,
      p: node(),
    };
    this.placements.add(p);
    if (anchor.kind === 'world') this.worldDirty = true;
    el.style.visibility = 'hidden';
    p.lastShown = false;
    return {
      set: (a) => {
        if (a.kind === 'world' || p.anchor.kind === 'world') this.worldDirty = true;
        p.anchor = a;
        p.w = 0;
      },
      remove: () => {
        this.placements.delete(p);
        if (p.anchor.kind === 'world') this.worldDirty = true;
      },
    };
  }

  /** Routes `path` from one anchor to another every frame (hidden when either end is hidden). */
  tether(path: SVGPathElement, from: Anchor, to: Anchor): Handle & { setTo(a: Anchor): void } {
    const t: Tether = { path, from, to, fromWorld: -1, toWorld: -1, lastD: '' };
    this.tethers.add(t);
    this.worldDirty = true;
    path.setAttribute('d', '');
    return {
      set: (a) => {
        t.from = a;
        this.worldDirty = true;
      },
      setTo: (a) => {
        t.to = a;
        this.worldDirty = true;
      },
      remove: () => {
        this.tethers.delete(t);
        this.worldDirty = true;
      },
    };
  }

  /** Resolves one anchor right now (the last frame's projections for world anchors). */
  resolve(anchor: Anchor, out: AnchorPoint = node()): AnchorPoint {
    return this.resolveInto(anchor, -1, out);
  }

  /** Runs one update (the engine's frame event calls this; tests may call it directly). */
  update(): void {
    const e = this.engine;
    if (!e) return;
    this.frames++;
    if (this.worldDirty) this.syncWorld();
    // Reads first (rects), then writes, so the browser lays out at most once.
    for (const p of this.placements) {
      this.resolveInto(p.anchor, p.worldIndex, p.p);
      if (p.opts.group && p.w === 0) {
        // Measured once (visibility: hidden keeps layout); `set` re-measures.
        p.w = p.el.offsetWidth;
        p.h = p.el.offsetHeight;
      }
    }
    this.cull();
    for (const p of this.placements) this.write(p);
    for (const t of this.tethers) this.route(t);
  }

  dispose(): void {
    this.attach(null);
    this.placements.clear();
    this.tethers.clear();
  }

  // ---- internals ----------------------------------------------------------------------------

  private syncWorld(): void {
    const e = this.engine;
    if (!e) return;
    const list: LabelAnchorInput[] = [];
    const add = (a: Anchor): number => {
      if (a.kind !== 'world') return -1;
      list.push({ id: String(list.length), lat: a.lat, lon: a.lon, alt: a.alt ?? 0.01 });
      return list.length - 1;
    };
    for (const p of this.placements) p.worldIndex = add(p.anchor);
    for (const t of this.tethers) {
      t.fromWorld = add(t.from);
      t.toWorld = add(t.to);
    }
    e.setLabelAnchors(list);
    this.worldDirty = false;
  }

  private resolveInto(a: Anchor, worldIndex: number, out: AnchorPoint): AnchorPoint {
    const e = this.engine;
    out.facing = 1;
    if (!e) {
      out.visible = false;
      return out;
    }
    switch (a.kind) {
      case 'world': {
        const la = worldIndex >= 0 ? e.labelAnchors()[worldIndex] : undefined;
        if (!la) {
          out.visible = false;
          return out;
        }
        out.x = la.x + this.canvasLeft;
        out.y = la.y + this.canvasTop;
        out.visible = la.visible && la.facing > 0;
        out.facing = la.facing;
        return out;
      }
      case 'node': {
        const ok = e.projectNode(a.id + 1, this.sp);
        out.x = this.sp.x + this.canvasLeft;
        out.y = this.sp.y + this.canvasTop;
        out.visible = ok && this.sp.visible;
        return out;
      }
      case 'moon': {
        const m = e.moonState();
        out.visible = m.visible;
        if (a.at === 'tether') {
          // Just outside the hexagon ring at its upper right: 0.54 of the size up and right of the
          // centre, pulled in 13 px along the diagonal (design 6.4 A).
          const k = 0.54 * m.s - 13 / Math.SQRT2;
          out.x = m.x + k + this.canvasLeft;
          out.y = m.y - k + this.canvasTop;
        } else {
          out.x = m.x + this.canvasLeft;
          out.y = m.y + this.canvasTop;
        }
        return out;
      }
      case 'element': {
        const el = a.el;
        if (!el?.isConnected) {
          out.visible = false;
          return out;
        }
        const r = el.getBoundingClientRect();
        out.x = r.left + r.width * (a.fx ?? 0.5) + (a.dx ?? 0);
        out.y = r.top + r.height * (a.fy ?? 0.5) + (a.dy ?? 0);
        out.visible = r.width > 0 || r.height > 0;
        return out;
      }
      case 'point':
        out.x = a.x;
        out.y = a.y;
        out.visible = true;
        return out;
    }
  }

  /** Collision culling per group, in priority order; the moon's clearance circle is a cull region. */
  private cull(): void {
    const groups = new Map<string, Placement[]>();
    for (const p of this.placements) {
      const g = p.opts.group;
      if (!g || !p.p.visible) continue;
      let list = groups.get(g);
      if (!list) {
        list = [];
        groups.set(g, list);
      }
      list.push(p);
    }
    if (groups.size === 0) return;
    const m = this.engine?.moonState();
    const mx = m ? m.x + this.canvasLeft : 0;
    const my = m ? m.y + this.canvasTop : 0;
    const mr = m?.visible ? m.r + 8 : -1;
    for (const list of groups.values()) {
      list.sort((a, b) => (a.opts.priority ?? 0) - (b.opts.priority ?? 0));
      const boxes = this.boxes;
      boxes.length = 0;
      for (const p of list) {
        const x = p.p.x + (p.opts.dx ?? 0);
        const y = p.p.y + (p.opts.dy ?? 0);
        const w = p.w || 60;
        const h = p.h || 16;
        if (p.opts.avoidMoon !== false && mr > 0) {
          const cx = Math.max(x, Math.min(mx, x + w));
          const cy = Math.max(y, Math.min(my, y + h));
          if ((cx - mx) ** 2 + (cy - my) ** 2 < mr * mr) {
            p.p.visible = false;
            continue;
          }
        }
        let hit = false;
        for (let k = 0; k < boxes.length; k += 4) {
          if (x < boxes[k + 2]! && x + w > boxes[k]! && y < boxes[k + 3]! && y + h > boxes[k + 1]!) {
            hit = true;
            break;
          }
        }
        if (hit) {
          p.p.visible = false;
          continue;
        }
        boxes.push(x - 4, y - 2, x + w + 4, y + h + 2);
      }
    }
  }

  private write(p: Placement): void {
    const pt = p.p;
    const show = pt.visible;
    if (show !== p.lastShown) {
      p.el.style.visibility = show ? '' : 'hidden';
      p.lastShown = show;
    }
    if (show) {
      const x = Math.round((pt.x + (p.opts.dx ?? 0)) * 2) / 2;
      const y = Math.round((pt.y + (p.opts.dy ?? 0)) * 2) / 2;
      if (x !== p.lastX || y !== p.lastY) {
        p.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        p.lastX = x;
        p.lastY = y;
      }
      if (p.opts.fade ?? p.anchor.kind === 'world') {
        const o = Math.round(Math.min(1, Math.max(0, pt.facing / 0.25)) * 20) / 20;
        if (o !== p.lastOpacity) {
          p.el.style.opacity = String(o);
          p.lastOpacity = o;
        }
      }
    }
    p.opts.onUpdate?.(pt);
  }

  private readonly ta = node();
  private readonly tb = node();

  /** A tether: from the anchor, one 45 degree elbow, then straight to the target. */
  private route(t: Tether): void {
    const a = this.resolveInto(t.from, t.fromWorld, this.ta);
    const b = this.resolveInto(t.to, t.toWorld, this.tb);
    let d = '';
    if (a.visible && b.visible) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const run = Math.min(Math.abs(dx), Math.abs(dy));
      const ex = a.x + Math.sign(dx) * run;
      const ey = a.y + Math.sign(dy) * run;
      d = `M${a.x.toFixed(1)} ${a.y.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    if (d !== t.lastD) {
      t.path.setAttribute('d', d);
      t.lastD = d;
    }
  }

  private hideAll(): void {
    for (const p of this.placements) {
      p.el.style.visibility = 'hidden';
      p.lastShown = false;
    }
    for (const t of this.tethers) {
      t.path.setAttribute('d', '');
      t.lastD = '';
    }
  }
}
