// The toast stack (design 6.4 H, 8.17). The store (app/toasts.ts) is the contract: anyone pushes, this
// renders and owns the look, the timing and the motion. Up to three stack at the top right (one above the
// tab bar on a phone); a payment toast is white-tinted, a warning amber, an achievement chamfered. A toast
// pauses while the pointer or focus is on the stack or the tab is hidden, a click opens its subject, Esc
// closes the one that has focus, and a leaving toast fades before the others close the gap. Every toast
// carries `data-kind` and `data-leaving`. A toast opens and closes with the motion language's Power-on, panel
// variant: it grows out of the edge it sits against with one comet along its top edge. The animation is on the
// toast itself (not a wrapper) because the toast is a pane of glass, and a backdrop blur only sees what is
// behind it when nothing between the pane and the page is fading.

import { Award, CircleCheck, Coins, Info, OctagonAlert, TriangleAlert, X } from 'lucide-react';
import {
  type ComponentPropsWithRef,
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type ToastKind, useToasts } from '../../app/toasts';
import { powerOff, powerOn } from '../../motion';
import { ShellLink } from '../../shell/frame/ShellLink';
import { globeInset } from '../../shell/wm/machine';
import { useWm } from '../../shell/wm/react';
import { cx } from '../../ui';
import { pressHandlers } from '../../ui/internal/press';
import { mergeRefs } from '../../ui/internal/refs';
import { cssValue, play, scaledMs } from './motion';
import {
  type Entry,
  EXIT_MS,
  type Life,
  reconcile,
  removeEntry,
  roleOf,
  STACK_MAX,
  STACK_MAX_PHONE,
  segments,
  tick,
} from './toaststack';
import './toasts.css';

const ICON: Record<ToastKind, ComponentType<{ size?: number }>> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  error: OctagonAlert,
  achievement: Award,
  watch: Coins,
};

/** How often the clocks run; the lifetimes are seconds, so this is a hand on a watch, not an animation. */
const TICK_MS = 250;
const SHIFT_MS = 220;

/**
 * The stack. The root takes a ref, a class and a style like any element; a toast is `.toast` with `data-kind`,
 * `data-state` (`open`, `leaving`) and `data-toast-id`, its link `.toast-main` and its dismiss `.toast-x` carry
 * `data-pressed` while held.
 */
export function Toasts({ ref, className, style: given, ...rest }: ComponentPropsWithRef<'div'>) {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const phone = useWm((s) => s.layout === 'phone', Object.is);
  // A docked window owns the right edge: the stack steps in to sit beside it (design 6.4 H).
  const dockedRight = useWm((s) => (s.layout === 'phone' ? 0 : globeInset(s).right), Object.is);
  const max = phone ? STACK_MAX_PHONE : STACK_MAX;
  const rootRef = useRef<HTMLDivElement>(null);
  const setRoot = useMemo(() => mergeRefs<HTMLDivElement>(rootRef, ref), [ref]);

  const [entries, setEntries] = useState<Entry[]>(() => reconcile([], toasts, max));
  const [synced, setSynced] = useState({ toasts, max });
  if (synced.toasts !== toasts || synced.max !== max) {
    setSynced({ toasts, max });
    setEntries((e) => reconcile(e, toasts, max));
  }
  const maxRef = useRef(max);
  maxRef.current = max;

  // A toast that left the store fades for EXIT_MS, then the stack closes the gap and the next one steps in.
  const exits = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    for (const e of entries) {
      const id = e.toast.id;
      if (!e.leaving || exits.current.has(id)) continue;
      exits.current.set(
        id,
        setTimeout(() => {
          exits.current.delete(id);
          setEntries((cur) => reconcile(removeEntry(cur, id), useToasts.getState().toasts, maxRef.current));
        }, scaledMs(EXIT_MS)),
      );
    }
  }, [entries]);
  useEffect(
    () => () => {
      for (const h of exits.current.values()) clearTimeout(h);
      exits.current.clear();
    },
    [],
  );

  // The clocks: one timer for the whole stack, running only while something is on screen. The stack is
  // paused by the pointer or focus on it, and by a hidden tab (a toast should be seen before it goes).
  const lives = useRef(new Map<number, Life>());
  const live = entries.some((e) => !e.leaving);
  useEffect(() => {
    if (!live) return;
    let last = performance.now();
    const h = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      const el = rootRef.current;
      const paused =
        document.hidden || (el !== null && (el.matches(':hover') || el.matches(':focus-within')));
      for (const id of tick(lives.current, entries, dt, paused)) dismiss(id);
    }, TICK_MS);
    return () => clearInterval(h);
  }, [live, entries, dismiss]);

  // FLIP: when a toast leaves, the ones below it slide up to close the gap instead of jumping.
  const tops = useRef(new Map<number, number>());
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const next = new Map<number, number>();
    const ease = cssValue('--ease-out', 'cubic-bezier(0.22, 1, 0.36, 1)');
    for (const el of root.querySelectorAll<HTMLElement>('[data-toast-id]')) {
      const id = Number(el.dataset.toastId);
      const top = el.offsetTop;
      next.set(id, top);
      const was = tops.current.get(id);
      if (was !== undefined && was !== top) {
        play(el, [{ transform: `translateY(${was - top}px)` }, { transform: 'none' }], {
          duration: SHIFT_MS,
          easing: ease,
        });
      }
    }
    tops.current = next;
  });

  const style = { ...given, '--toast-shift': `${Math.max(0, dockedRight - 24)}px` } as CSSProperties;
  return (
    <div
      {...rest}
      className={cx('toasts', className)}
      ref={setRoot}
      style={style}
      data-docked={dockedRight > 0 || undefined}
    >
      {entries.map((e) => (
        <ToastItem key={e.toast.id} entry={e} phone={phone} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  entry,
  phone,
  onDismiss,
}: {
  entry: Entry;
  phone: boolean;
  onDismiss: (id: number) => void;
}) {
  const { toast, leaving } = entry;
  const Icon = toast.icon ?? ICON[toast.kind];
  const ref = useRef<HTMLDivElement>(null);
  // Out of the edge it sits against: the middle of the right edge on a desktop, the foot of the screen on a phone.
  const origin = useRef({ fx: 0.5, fy: 1 });
  origin.current = phone ? { fx: 0.5, fy: 1 } : { fx: 1, fy: 0.5 };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = powerOn(el, { variant: 'panel', origin: origin.current });
    return () => h?.cancel();
  }, []);
  // The exit stays on the element until the stack removes it (EXIT_MS); a toast that comes back cancels it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!leaving || !el) return;
    const h = powerOff(el, { variant: 'panel', origin: origin.current });
    return () => h.cancel();
  }, [leaving]);
  const close = () => onDismiss(toast.id);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    close();
  };
  const body = (
    <>
      <span className="toast-ti">
        <Icon size={18} />
      </span>
      <span className="toast-text">
        <b>{toast.title}</b>
        {toast.body ? <Sentence text={toast.body} /> : null}
      </span>
    </>
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape on a toast that has focus closes it
    <div
      ref={ref}
      className="toast"
      role={roleOf(toast.kind)}
      data-toast-id={toast.id}
      data-kind={toast.kind}
      data-state={leaving ? 'leaving' : 'open'}
      data-leaving={leaving || undefined}
      onKeyDown={onKey}
    >
      {toast.to ? (
        <ShellLink
          to={toast.to}
          className="toast-main"
          {...pressHandlers<HTMLAnchorElement>()}
          onClick={close}
        >
          {body}
        </ShellLink>
      ) : (
        <div className="toast-main">{body}</div>
      )}
      <button
        type="button"
        className="toast-x"
        aria-label="Dismiss"
        {...pressHandlers<HTMLButtonElement>()}
        onClick={close}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** A sentence with its addresses and hashes set in the mono face. */
function Sentence({ text }: { text: string }) {
  let at = 0;
  return (
    <span className="toast-body">
      {segments(text).map((s) => {
        const key = at;
        at += s.text.length;
        return s.mono ? (
          <span key={key} className="mono">
            {s.text}
          </span>
        ) : (
          s.text
        );
      })}
    </span>
  );
}
