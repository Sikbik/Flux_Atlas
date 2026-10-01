// Waking from ambient mode: any input leaves, by the same rules as the engine's own screensaver (design
// 9.6). A pointer must travel 8 px, and a press, a wheel turn, a touch or a key leaves at once. Browser
// chords and bare modifiers are not "input": Ctrl+R, F11 or Alt+Tab must not throw a kiosk out of ambient
// mode, and they are never swallowed.
//
// The listeners sit on the window in the capture phase, so they run before anything else. While ambient
// mode is up they swallow every input they see, which keeps the engine's own wake (it would navigate to
// `/`, not to where the visitor was) and any click-through away from whatever sits under the planet.
// Nothing leaves for the first moment after entering (the same grace the engine keeps), and once the
// wake has fired the rest of the gesture is swallowed too.

export const WAKE_TRAVEL_PX = 8;
/** The engine ignores input for 900 ms after `setMode('ambient')`; this is swallowed for as long. */
export const WAKE_GRACE_MS = 900;
/** A pause this long between pointer events starts the travel count again: a jittering sensor is not a wake. */
const TRAVEL_GAP_MS = 400;

export type WakeKind = 'move' | 'press' | 'wheel' | 'key';

const NOT_INPUT = /^(F\d{1,2}|Audio|Media|Brightness|Volume|Launch|Browser)/;
const MODIFIERS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'FnLock',
  'PrintScreen',
  'Unidentified',
  'Dead',
  'Process',
]);

/** True for a key that should wake: not a bare modifier, a function or media key, or a browser chord. */
export function keyWakes(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return !MODIFIERS.has(e.key) && !NOT_INPUT.test(e.key);
}

/** Counts how far the pointer has travelled in one continuous movement. */
export class PointerTravel {
  private x = Number.NaN;
  private y = Number.NaN;
  private t = Number.NEGATIVE_INFINITY;
  private total = 0;

  constructor(private readonly threshold: number = WAKE_TRAVEL_PX) {}

  /** Adds a pointer position at time `t` (ms); true once the movement has gone far enough. */
  move(x: number, y: number, t: number): boolean {
    if (t - this.t > TRAVEL_GAP_MS || Number.isNaN(this.x)) this.total = 0;
    else this.total += Math.hypot(x - this.x, y - this.y);
    this.x = x;
    this.y = y;
    this.t = t;
    return this.total >= this.threshold;
  }
}

export interface WakeOptions {
  /** Called once, with what woke it. */
  onWake: (kind: WakeKind) => void;
  graceMs?: number;
  now?: () => number;
  target?: Window;
}

/** Starts listening; returns the function that stops. */
export function installWake({
  onWake,
  graceMs = WAKE_GRACE_MS,
  now = () => performance.now(),
  target = window,
}: WakeOptions): () => void {
  const startedAt = now();
  const travel = new PointerTravel();
  let woke = false;

  const settled = () => now() - startedAt >= graceMs;
  const fire = (kind: WakeKind) => {
    if (woke) return;
    woke = true;
    onWake(kind);
  };

  const onMove = (e: PointerEvent) => {
    e.stopImmediatePropagation();
    if (woke || !settled()) return;
    if (travel.move(e.clientX, e.clientY, e.timeStamp)) fire('move');
  };
  const onPress = (e: Event) => {
    e.stopImmediatePropagation();
    if (settled()) fire('press');
  };
  const onWheel = (e: Event) => {
    e.stopImmediatePropagation();
    if (settled()) fire('wheel');
  };
  const onKey = (e: KeyboardEvent) => {
    if (!keyWakes(e)) return;
    e.stopImmediatePropagation();
    // A key must not also scroll the page, open quick find or press a button under the planet.
    e.preventDefault();
    if (settled()) fire('key');
  };

  const cap = { capture: true } as const;
  target.addEventListener('pointermove', onMove, cap);
  target.addEventListener('pointerdown', onPress, cap);
  target.addEventListener('touchstart', onPress, { capture: true, passive: true });
  target.addEventListener('wheel', onWheel, { capture: true, passive: true });
  target.addEventListener('keydown', onKey, cap);
  return () => {
    target.removeEventListener('pointermove', onMove, cap);
    target.removeEventListener('pointerdown', onPress, cap);
    target.removeEventListener('touchstart', onPress, cap);
    target.removeEventListener('wheel', onWheel, cap);
    target.removeEventListener('keydown', onKey, cap);
  };
}
