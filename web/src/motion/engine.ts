// The engine: the small, always-loaded half of the motion module.
//
//   - the imperative API (`pulse`, `spark`, `current`, `powerOn`, `powerOff`, `settle`), which loads
//     the effect runners (a separate chunk) on first use or on idle after install;
//   - the delegated input layer: one set of passive document listeners that turn `data-fx`
//     attributes into behaviour, so a control needs no ref and no hook to join the language.
//
// data-fx tokens (space separated):
//   press    Pulse on pointer press and on Enter / Space
//   charge   hover and focus light on the control's edge (CSS, plus pointer tracking here)
//   toggle   Spark when the control turns on (aria-checked, aria-pressed, aria-selected, checked)
//   focus    the energised focus outline without the hover light
//
// Zero cost at rest: no timers, no rAF, no layers until something happens.

import type { FxKind, Lease } from './budget';
import type {
  CurrentOptions,
  Fx,
  FxHandle,
  PowerOptions,
  PulseOptions,
  SettleOptions,
  SparkOptions,
} from './fxRunners';
import { installModeSync, modeOf } from './mode';

type Runners = typeof import('./fxRunners');

let runners: Runners | null = null;
let fx: Fx | null = null;
let loading: Promise<Runners> | null = null;

/** Loads the effect runners (once). Safe to call early; installing the engine does it on idle. */
export function loadRunners(): Promise<Runners> {
  loading ??= import('./fxRunners').then((m) => {
    runners = m;
    fx = new m.Fx();
    return m;
  });
  return loading;
}

/**
 * Runs `use` now when the runners are loaded. Otherwise it starts the load and runs `use` when it
 * arrives, but only if that is still within `staleMs` of the call: feedback that lands late is noise.
 */
function whenReady<T>(use: (r: Runners, fx: Fx) => T, staleMs = 160): T | null {
  if (runners && fx) return use(runners, fx);
  const t0 = now();
  void loadRunners().then((r) => {
    if (fx && now() - t0 <= staleMs) use(r, fx);
  });
  return null;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const pulse = (el: HTMLElement, opts?: PulseOptions): FxHandle | null =>
  whenReady((r, f) => r.pulse(f, el, opts));

export const spark = (el: Element, opts?: SparkOptions): FxHandle | null =>
  whenReady((r, f) => r.spark(f, el, opts));

export const current = (host: HTMLElement, opts?: CurrentOptions): FxHandle | null =>
  whenReady((r, f) => r.current(f, host, opts), 400);

export const settle = (el: HTMLElement, opts?: SettleOptions): FxHandle | null =>
  whenReady((r, f) => r.settle(f, el, opts), 400);

export const powerOn = (el: HTMLElement, opts?: PowerOptions): FxHandle | null =>
  whenReady((r, f) => r.powerOn(f, el, opts), 60);

/**
 * Plays the closing animation. `done` resolves when it ends, and at once when there is nothing to
 * play (effects off, runners not loaded yet): closing never waits on decoration. `cancel` also
 * removes the animation's end state, so a window that is re-opened mid-close comes back visible.
 */
export function powerOff(el: HTMLElement, opts?: PowerOptions): FxHandle {
  if (!runners || !fx) {
    void loadRunners();
    return NOTHING;
  }
  return runners.powerOff(fx, el, opts) ?? NOTHING;
}

const NOTHING: FxHandle = { done: Promise.resolve(), cancel() {} };

/** A budget lease for effects the core draws itself (the tab indicator); null until the runners load. */
export function lease(kind: FxKind, key: unknown, onPreempt?: () => void): Lease | null {
  return fx?.budget.acquire(kind, key, onPreempt) ?? null;
}

/** Budget numbers for diagnostics (the gallery shows them); null until the runners load. */
export function stats() {
  return fx?.budget.stats() ?? null;
}

// ---- delegated input ---------------------------------------------------------------------------

function hasToken(el: Element, token: string): boolean {
  const v = el.getAttribute('data-fx');
  if (!v) return false;
  for (const t of v.split(/\s+/)) if (t === token) return true;
  return false;
}

/** The nearest element at or above `start` whose data-fx has `token`. */
function findToken(start: EventTarget | null, token: string): HTMLElement | null {
  let el: Element | null = start instanceof Element ? start.closest('[data-fx]') : null;
  while (el) {
    if (hasToken(el, token)) return el as HTMLElement;
    el = el.parentElement?.closest('[data-fx]') ?? null;
  }
  return null;
}

function blocked(el: Element): boolean {
  return (
    el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]') !== null
  );
}

const BUTTON_INPUTS = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file']);

function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (t instanceof HTMLInputElement) return !BUTTON_INPUTS.has(t.type);
  return (
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement ||
    t.closest('[contenteditable]:not([contenteditable="false"])') !== null
  );
}

function isOn(el: Element): boolean {
  const v =
    el.getAttribute('aria-checked') ?? el.getAttribute('aria-pressed') ?? el.getAttribute('aria-selected');
  if (v !== null) return v === 'true';
  return el instanceof HTMLInputElement ? el.checked : false;
}

const toggleBefore = new WeakMap<Element, boolean>();

function rememberToggle(target: EventTarget | null): void {
  const el = findToken(target, 'toggle');
  if (el) toggleBefore.set(el, isOn(el));
}

function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  rememberToggle(e.target);
  const el = findToken(e.target, 'press');
  if (!el || blocked(el)) return;
  pulse(el, { point: { x: e.clientX, y: e.clientY } });
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'Enter' && e.key !== ' ')) return;
  if (isTextEntry(e.target)) return;
  rememberToggle(e.target);
  const el = findToken(e.target, 'press');
  if (!el || blocked(el)) return;
  if (e.key === ' ' && el.tagName === 'A') return;
  pulse(el);
}

/**
 * Where a toggle's spark lands, from `data-fx-spark`: `end` and `start` are the centres of the
 * control's round ends (a switch's knob), `icon` is its first icon, anything else its centre.
 */
function sparkPoint(el: HTMLElement): { x: number; y: number } | undefined {
  const where = el.getAttribute('data-fx-spark');
  const r = el.getBoundingClientRect();
  if (where === 'end') return { x: r.right - r.height / 2, y: r.top + r.height / 2 };
  if (where === 'start') return { x: r.left + r.height / 2, y: r.top + r.height / 2 };
  if (where === 'icon') {
    const i = el.querySelector('svg, [data-fx-icon]')?.getBoundingClientRect();
    if (i) return { x: i.left + i.width / 2, y: i.top + i.height / 2 };
  }
  return undefined;
}

function onClick(e: MouseEvent): void {
  const el = findToken(e.target, 'toggle');
  if (!el || blocked(el)) return;
  const was = toggleBefore.get(el);
  toggleBefore.delete(el);
  if (was !== false) return; // only a control that was off and is now on commits
  requestAnimationFrame(() => {
    if (!el.isConnected || !isOn(el)) return;
    const delay = Number(el.getAttribute('data-fx-delay')) || 0;
    spark(el, { at: sparkPoint(el), delay });
  });
}

// Charge: the CSS draws the ring; here the pointer position is handed to it while the pointer moves.
let hover: HTMLElement | null = null;
let hoverEvent: PointerEvent | null = null;
let hoverFrame = 0;

function flushHover(): void {
  hoverFrame = 0;
  if (!hover || !hoverEvent) return;
  const r = hover.getBoundingClientRect();
  hover.style.setProperty('--fx-x', `${(hoverEvent.clientX - r.left).toFixed(1)}px`);
  hover.style.setProperty('--fx-y', `${(hoverEvent.clientY - r.top).toFixed(1)}px`);
}

function onHoverMove(e: PointerEvent): void {
  hoverEvent = e;
  if (!hoverFrame) hoverFrame = requestAnimationFrame(flushHover);
}

function endHover(): void {
  hover?.removeEventListener('pointermove', onHoverMove);
  if (hoverFrame) cancelAnimationFrame(hoverFrame);
  hoverFrame = 0;
  hover = null;
  hoverEvent = null;
}

function onPointerOver(e: PointerEvent): void {
  if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
  const el = findToken(e.target, 'charge');
  if (el === hover) return;
  endHover();
  if (!el || blocked(el) || modeOf(el) !== 'full') return;
  hover = el;
  hoverEvent = e;
  // The light's reach scales with the control: local on a 32 px icon button, wide on a long one.
  const r = el.getBoundingClientRect();
  el.style.setProperty(
    '--fx-reach',
    `${Math.round(Math.min(120, Math.max(38, Math.max(r.width, r.height) * 0.7)))}px`,
  );
  flushHover();
  el.addEventListener('pointermove', onHoverMove, { passive: true });
}

function onPointerOut(e: PointerEvent): void {
  if (hover && !(e.relatedTarget instanceof Node && hover.contains(e.relatedTarget))) endHover();
}

let installs = 0;
let uninstall: (() => void) | null = null;

/**
 * Starts the delegated input layer and the mode mirror, and loads the runners on idle. Reference
 * counted (StrictMode, several callers); the last release removes every listener.
 */
export function installEngine(): () => void {
  installs++;
  if (installs === 1 && typeof document !== 'undefined') {
    const releaseMode = installModeSync();
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('keydown', onKeyDown, opts);
    document.addEventListener('click', onClick, opts);
    document.addEventListener('pointerover', onPointerOver, opts);
    document.addEventListener('pointerout', onPointerOut, opts);
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => void loadRunners(), { timeout: 3000 })
        : (setTimeout(() => void loadRunners(), 800) as unknown as number);
    uninstall = () => {
      document.removeEventListener('pointerdown', onPointerDown, opts);
      document.removeEventListener('keydown', onKeyDown, opts);
      document.removeEventListener('click', onClick, opts);
      document.removeEventListener('pointerover', onPointerOver, opts);
      document.removeEventListener('pointerout', onPointerOut, opts);
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
      else clearTimeout(idle);
      endHover();
      releaseMode();
    };
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    installs--;
    if (installs === 0) {
      uninstall?.();
      uninstall = null;
    }
  };
}

/** Test hook: drops the loaded runners and the effect host, ending every running effect. */
export function resetEngine(): void {
  fx?.dispose();
  fx = null;
  runners = null;
  loading = null;
}

/** Test hook: installs a prepared effect host (a fake animation driver) instead of loading one. */
export async function useHost(make: (r: Runners) => Fx): Promise<Fx> {
  const r = await loadRunners();
  fx?.dispose();
  fx = make(r);
  return fx;
}

export function installCount(): number {
  return installs;
}
