// Pointer, wheel and touch controls for explore mode. Translates raw input into rig operations and
// emits hover/click/dblclick/wake callbacks. Everything is bound to the canvas and cleaned up in
// dispose().

import type { CameraRig } from './camera';

export interface ControlsHost {
  onHover(x: number, y: number, inside: boolean): void;
  onClick(x: number, y: number): void;
  onDoubleClick(x: number, y: number): void;
  /** Any input that should wake the screensaver; `move` carries the pointer position. */
  onWake(kind: 'move' | 'press' | 'wheel', x: number, y: number): void;
  onInteract(): void;
  /** A double-click with the middle button: back to the home view. */
  onHome?(): void;
  /** A wheel turn or a pinch is about to zoom at (x, y), CSS px: the host picks what the zoom holds still. */
  onZoomAt?(x: number, y: number): void;
}

/** Pitch per CSS pixel of vertical orbit drag, heading per pixel of horizontal drag (radians). */
const TILT_PER_PX = 0.005;
const HEADING_PER_PX = 0.006;

interface Pt {
  id: number;
  x: number;
  y: number;
}

export class Controls {
  enabled = true;
  private readonly pts: Pt[] = [];
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private moved = false;
  private orbiting = false;
  private lastDist = 0;
  private lastAng = 0;
  private lastMidY = 0;
  private lastClickT = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private lastMiddleT = 0;
  private middle = false;
  private bound = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly rig: CameraRig,
    private readonly host: ControlsHost,
  ) {
    this.bind();
  }

  private bind(): void {
    if (this.bound) return;
    this.bound = true;
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('pointerleave', this.onLeave);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onContext);
    c.addEventListener('mousedown', this.onMouseDown);
    c.style.touchAction = 'none';
  }

  dispose(): void {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.onDown);
    c.removeEventListener('pointermove', this.onMove);
    c.removeEventListener('pointerup', this.onUp);
    c.removeEventListener('pointercancel', this.onUp);
    c.removeEventListener('pointerleave', this.onLeave);
    c.removeEventListener('wheel', this.onWheel);
    c.removeEventListener('contextmenu', this.onContext);
    c.removeEventListener('mousedown', this.onMouseDown);
    this.bound = false;
  }

  private local(e: PointerEvent | WheelEvent): { x: number; y: number; w: number; h: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  private ndc(x: number, y: number, w: number, h: number, out: [number, number]): void {
    out[0] = (x / w) * 2 - 1;
    out[1] = -((y / h) * 2 - 1);
  }
  private readonly tmp: [number, number] = [0, 0];

  private readonly onContext = (e: Event): void => {
    e.preventDefault();
  };

  /** The middle button orbits: no autoscroll. */
  private readonly onMouseDown = (e: MouseEvent): void => {
    if (e.button === 1 && this.enabled) e.preventDefault();
  };

  private readonly onDown = (e: PointerEvent): void => {
    const p = this.local(e);
    this.host.onWake('press', p.x, p.y);
    if (!this.enabled) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pts.push({ id: e.pointerId, x: p.x, y: p.y });
    this.host.onInteract();
    if (this.pts.length === 1) {
      this.downX = p.x;
      this.downY = p.y;
      this.downT = performance.now();
      this.moved = false;
      this.middle = e.button === 1;
      this.orbiting = e.button === 2 || e.shiftKey || e.ctrlKey || e.button === 1;
      if (this.orbiting) {
        this.rig.orbitStart(performance.now());
      } else {
        this.ndc(p.x, p.y, p.w, p.h, this.tmp);
        this.rig.grabStart(this.tmp[0], this.tmp[1], performance.now());
      }
    } else if (this.pts.length === 2) {
      // Second finger: switch from grab to pinch, twist and two-finger tilt.
      this.rig.grabEnd();
      this.rig.orbitStart(performance.now());
      this.orbiting = false;
      this.middle = false;
      this.lastDist = Math.hypot(this.pts[0]!.x - this.pts[1]!.x, this.pts[0]!.y - this.pts[1]!.y);
      this.lastAng = Math.atan2(this.pts[1]!.y - this.pts[0]!.y, this.pts[1]!.x - this.pts[0]!.x);
      this.lastMidY = (this.pts[0]!.y + this.pts[1]!.y) / 2;
      this.moved = true;
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    const idx = this.pts.findIndex((q) => q.id === e.pointerId);
    if (idx === -1) {
      // Hover (no buttons down).
      this.host.onWake('move', p.x, p.y);
      this.host.onHover(p.x, p.y, true);
      return;
    }
    if (!this.enabled) return;
    const prev = this.pts[idx]!;
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    prev.x = p.x;
    prev.y = p.y;
    if (Math.hypot(p.x - this.downX, p.y - this.downY) > 4) this.moved = true;
    if (this.pts.length === 1) {
      if (this.orbiting) {
        this.rig.orbitBy(dx * HEADING_PER_PX, dy * TILT_PER_PX, performance.now());
      } else if (this.moved) {
        this.ndc(p.x, p.y, p.w, p.h, this.tmp);
        this.rig.grabMove(this.tmp[0], this.tmp[1], performance.now());
      }
      this.host.onInteract();
    } else if (this.pts.length === 2) {
      const a = this.pts[0]!;
      const b = this.pts[1]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (this.lastDist > 0) {
        this.host.onZoomAt?.((a.x + b.x) / 2, (a.y + b.y) / 2);
        this.rig.zoomBy(this.lastDist / Math.max(1, dist));
      }
      let dAng = ang - this.lastAng;
      if (dAng > Math.PI) dAng -= Math.PI * 2;
      if (dAng < -Math.PI) dAng += Math.PI * 2;
      // Two fingers moving together vertically tilt; a pinch moves the midpoint far less than the
      // spread, so it does not.
      const midY = (a.y + b.y) / 2;
      const dMid = midY - this.lastMidY;
      const dTilt = Math.abs(dMid) > Math.abs(dist - this.lastDist) ? dMid * TILT_PER_PX : 0;
      this.rig.orbitBy(dAng, dTilt, performance.now());
      this.lastDist = dist;
      this.lastAng = ang;
      this.lastMidY = midY;
      this.host.onInteract();
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    const idx = this.pts.findIndex((q) => q.id === e.pointerId);
    if (idx === -1) return;
    const p = this.local(e);
    this.pts.splice(idx, 1);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (this.pts.length === 0) {
      this.rig.grabEnd();
      this.rig.orbitEnd(performance.now());
      const dt = performance.now() - this.downT;
      if (this.middle) {
        // The middle button: a double-click goes home; single clicks do nothing. Event time, so a
        // long frame between the two clicks does not split them.
        const now = e.timeStamp;
        if (!this.moved && dt < 450 && e.type === 'pointerup') {
          if (now - this.lastMiddleT < 450) {
            this.lastMiddleT = 0;
            this.host.onHome?.();
          } else this.lastMiddleT = now;
        }
        this.middle = false;
      } else if (!this.moved && dt < 450 && e.type === 'pointerup') {
        const now = performance.now();
        if (now - this.lastClickT < 340 && Math.hypot(p.x - this.lastClickX, p.y - this.lastClickY) < 10) {
          this.host.onDoubleClick(p.x, p.y);
          this.lastClickT = 0;
        } else {
          this.host.onClick(p.x, p.y);
          this.lastClickT = now;
          this.lastClickX = p.x;
          this.lastClickY = p.y;
        }
      }
      this.orbiting = false;
    } else if (this.pts.length === 1) {
      // Continue as a grab from the remaining finger.
      this.rig.orbitEnd(performance.now());
      const q = this.pts[0]!;
      const r = this.canvas.getBoundingClientRect();
      this.ndc(q.x, q.y, r.width, r.height, this.tmp);
      this.rig.grabStart(this.tmp[0], this.tmp[1], performance.now());
      this.downX = q.x;
      this.downY = q.y;
    }
  };

  private readonly onLeave = (): void => {
    if (this.pts.length === 0) this.host.onHover(-1, -1, false);
  };

  private readonly onWheel = (e: WheelEvent): void => {
    this.host.onWake('wheel', 0, 0);
    if (!this.enabled) return;
    e.preventDefault();
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 32;
    else if (e.deltaMode === 2) d *= 320;
    d = Math.max(-240, Math.min(240, d));
    const p = this.local(e);
    this.host.onZoomAt?.(p.x, p.y);
    this.rig.zoomBy(Math.exp(d * 0.0016));
    this.host.onInteract();
  };
}
