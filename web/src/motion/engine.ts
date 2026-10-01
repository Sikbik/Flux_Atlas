// The engine: the small, always-loaded half of the motion module.
//
//   - the imperative API (`pulse`, `spark`, `current`, `powerOn`, `powerOff`), which loads the effect
//     runners (a separate chunk) on first use or on idle after install;
//   - the delegated input layer: passive document listeners and one MutationObserver that turn the
//     attributes the UI kit writes into effects (see attach.ts for the lists), so a component joins
//     the language without importing anything from this folder.
//
// What it answers:
//   data-pressed appears    Pulse at the press point (or the top centre for a key press)
//   data-state turns on     Spark where the control lit (a switch's knob, a copy glyph), after a real
//                           input, never for a change the app made on its own
//   data-fresh appears      Current along the top edge of a row or card that opted in, on an element that
//                           already exists (see fresh.ts: a view writes the attribute with `useFresh`);
//                           `data-fx-delay` holds it back for a row that follows an arrival with its own light
//   pointer over a button   the edge light follows the pointer (the CSS draws it)
//   data-fx tokens          the same for elements outside the kit: press, toggle, charge, current
//
// Zero cost at rest: no timers, no rAF, no layers until something happens.

import { hasToken, isRuled, ON_STATES, ruled } from './attach';
import type { FxKind, Lease } from './budget';
import type {
  CurrentOptions,
  Edge,
  Fx,
  FxHandle,
  PowerOptions,
  PulseOptions,
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

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

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

export const pulse = (el: HTMLElement, opts?: PulseOptions): FxHandle | null =>
  whenReady((r, f) => r.pulse(f, el, opts));

export const spark = (el: Element, opts?: SparkOptions): FxHandle | null =>
  whenReady((r, f) => r.spark(f, el, opts));

export const current = (host: HTMLElement, opts?: CurrentOptions): FxHandle | null =>
  whenReady((r, f) => r.current(f, host, opts), 400);

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

/** The last pointer press or key press: where it was, what it hit, when. */
interface Input {
  t: number;
  target: EventTarget | null;
  x: number;
  y: number;
  pointer: boolean;
}
let lastInput: Input | null = null;

/** The last input if it landed inside `el` within `within` ms. */
function recent(el: Element, within: number): Input | null {
  if (!lastInput || now() - lastInput.t > within) return null;
  return lastInput.target instanceof Node && el.contains(lastInput.target) ? lastInput : null;
}

/** One effect per element per kind per 100 ms: a control can report one change through two attributes. */
const fired = new WeakMap<Element, Record<string, number>>();
function once(el: Element, kind: string): boolean {
  const t = now();
  const rec = fired.get(el) ?? {};
  if (t - (rec[kind] ?? Number.NEGATIVE_INFINITY) < 100) return false;
  rec[kind] = t;
  fired.set(el, rec);
  return true;
}

function blocked(el: Element): boolean {
  return (
    el.matches(':disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.hasAttribute('data-disabled') ||
    el.closest('[inert]') !== null
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

/** Pulse for a pressed control; the press point comes from the pointer press that just happened. */
function press(el: HTMLElement): void {
  if (blocked(el) || !once(el, 'pulse')) return;
  const input = recent(el, 300);
  pulse(el, input?.pointer ? { point: { x: input.x, y: input.y } } : undefined);
}

/**
 * Where a toggle's spark lands: `data-fx-spark` says (`end` and `start` are the centres of the
 * control's round ends, `icon` its first icon); otherwise a switch's track end, then the first icon,
 * then the centre of the control.
 */
function sparkPoint(el: HTMLElement): { x: number; y: number } | undefined {
  const where = el.getAttribute('data-fx-spark');
  const at = (r: DOMRect, mode: string) => {
    if (mode === 'end') return { x: r.right - r.height / 2, y: r.top + r.height / 2 };
    if (mode === 'start') return { x: r.left + r.height / 2, y: r.top + r.height / 2 };
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  if (where === 'end' || where === 'start') return at(el.getBoundingClientRect(), where);
  const track = el.querySelector('.ui-switch__track');
  if (where === null && track) return at(track.getBoundingClientRect(), 'end');
  if (where === 'icon' || where === null) {
    const i = el.querySelector('svg, [data-fx-icon]')?.getBoundingClientRect();
    if (i && i.width > 0) return at(i, 'icon');
  }
  return undefined;
}

/** How long to wait before the spark lands: a switch's knob is still travelling when the state flips. */
function sparkDelay(el: HTMLElement): number {
  const attr = Number(el.getAttribute('data-fx-delay'));
  if (attr > 0) return attr;
  const knob = el.querySelector('.ui-switch__knob');
  if (!knob) return 0;
  const d = Number.parseFloat(getComputedStyle(knob).transitionDuration) || 0;
  return Math.round(Math.min(160, d * 1000 * 0.65));
}

function toggled(el: HTMLElement, attr: string, before: string | null): void {
  const after = el.getAttribute(attr);
  const turnedOn =
    attr === 'data-state'
      ? after !== null && ON_STATES.has(after) && !(before !== null && ON_STATES.has(before))
      : after === 'true' && before !== 'true';
  if (!turnedOn || !isRuled(el, 'spark') || blocked(el)) return;
  // Only for a change a person just made: an app that restores its settings does not spark.
  if (!recent(el, 900) || !once(el, 'spark')) return;
  spark(el, { at: sparkPoint(el), delay: sparkDelay(el) });
}

function fresh(el: HTMLElement): void {
  if (!isRuled(el, 'fresh') || !once(el, 'current')) return;
  const edge = (el.getAttribute('data-fx-edge') as Edge | null) ?? 'top';
  // Inline: the light is drawn inside the row, so it goes where the row goes while the row slides into place.
  const light = () => current(el, { edge, inline: true });
  // `data-fx-delay` is for a row that is the consequence of an arrival with a light of its own (the payout a
  // block lands with): it is asked for once that light is gone, so the budget never has to refuse it. The timer
  // exists only after an arrival, and the light is dropped if the row went away or stopped being fresh meanwhile.
  const wait = Number(el.getAttribute('data-fx-delay'));
  if (!(wait > 0)) {
    light();
    return;
  }
  if (modeOf(el) === 'off') return; // nothing would be drawn: no timer either
  setTimeout(() => {
    if (el.isConnected && el.hasAttribute('data-fresh')) light();
  }, wait);
}

function onMutations(records: MutationRecord[]): void {
  for (const r of records) {
    const el = r.target;
    if (!(el instanceof HTMLElement) || !r.attributeName) continue;
    switch (r.attributeName) {
      case 'data-pressed':
        if (r.oldValue === null && el.hasAttribute('data-pressed') && isRuled(el, 'press')) press(el);
        break;
      case 'data-fresh':
        if (r.oldValue === null && el.hasAttribute('data-fresh')) fresh(el);
        break;
      default:
        toggled(el, r.attributeName, r.oldValue);
    }
  }
}

function onPointerDown(e: PointerEvent): void {
  lastInput = { t: now(), target: e.target, x: e.clientX, y: e.clientY, pointer: true };
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // Elements outside the kit say `data-fx="press"` and do not write data-pressed themselves.
  const el = tokenTarget(e.target, 'press');
  if (el) press(el);
}

function onKeyDown(e: KeyboardEvent): void {
  lastInput = { t: now(), target: e.target, x: 0, y: 0, pointer: false };
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'Enter' && e.key !== ' ')) return;
  if (isTextEntry(e.target)) return;
  const el = tokenTarget(e.target, 'press');
  if (!el || (e.key === ' ' && el.tagName === 'A')) return;
  press(el);
}

/** The nearest `data-fx` element with `token` (an element outside the kit that opted in itself). */
function tokenTarget(start: EventTarget | null, token: string): HTMLElement | null {
  let el: Element | null = start instanceof Element ? start.closest('[data-fx]') : null;
  while (el) {
    if (hasToken(el, token) && !el.closest('[data-fx~="off"], [data-fx-density="dense"]')) {
      return el as HTMLElement;
    }
    el = el.parentElement?.closest('[data-fx]') ?? null;
  }
  return null;
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
  const el = ruled(e.target, 'charge');
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

const WATCHED = ['data-pressed', 'data-state', 'data-fresh', 'aria-checked', 'aria-pressed', 'aria-selected'];

let installs = 0;
let uninstall: (() => void) | null = null;

/**
 * Starts the delegated input layer and the mode mirror, and loads the runners on idle. Reference
 * counted (StrictMode, several callers); the last release removes every listener and the observer.
 */
export function installEngine(): () => void {
  installs++;
  if (installs === 1 && typeof document !== 'undefined') {
    const releaseMode = installModeSync();
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('pointerdown', onPointerDown, opts);
    document.addEventListener('keydown', onKeyDown, opts);
    document.addEventListener('pointerover', onPointerOver, opts);
    document.addEventListener('pointerout', onPointerOut, opts);
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onMutations);
    observer?.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: WATCHED,
      attributeOldValue: true,
    });
    const idle =
      typeof requestIdleCallback === 'function'
        ? requestIdleCallback(() => void loadRunners(), { timeout: 3000 })
        : (setTimeout(() => void loadRunners(), 800) as unknown as number);
    uninstall = () => {
      document.removeEventListener('pointerdown', onPointerDown, opts);
      document.removeEventListener('keydown', onKeyDown, opts);
      document.removeEventListener('pointerover', onPointerOver, opts);
      document.removeEventListener('pointerout', onPointerOut, opts);
      observer?.disconnect();
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(idle);
      else clearTimeout(idle);
      endHover();
      lastInput = null;
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
