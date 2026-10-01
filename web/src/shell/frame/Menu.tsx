// A menu bar and its popovers (design 2.7, 8.4): three text buttons (View, Go, Window), each opening a
// glass popover whose items show their keys. It follows the menu button pattern: Enter, Space or Down
// opens and focuses the first item, arrows move, Home and End jump, Esc closes and returns focus to the
// button, Left and Right move between menus, and hovering a neighbouring menu while one is open
// switches to it. Popovers render in a portal so their glass blurs the globe, not the top bar.

import {
  createContext,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import './menu.css';

export type MenuItemDef =
  | {
      kind: 'item';
      id: string;
      label: string;
      icon?: ReactNode;
      keys?: readonly string[];
      /** A small tag after the label ("minimized", "2 open"). */
      hint?: string;
      onSelect(): void;
      disabled?: boolean;
      /** Makes the item a checkbox (`checked`) or a radio (`radio`) in the menu's group. */
      checked?: boolean;
      radio?: boolean;
      /** Keep the menu open after selecting (toggles). */
      keepOpen?: boolean;
    }
  | { kind: 'heading'; id: string; label: string }
  | { kind: 'separator'; id: string };

interface BarState {
  openId: string | null;
  setOpen(id: string | null): void;
  order: string[];
  register(id: string): () => void;
}

const BarContext = createContext<BarState | null>(null);

/** Groups menus so one is open at a time and Left and Right walk between them. */
export function MenuBar({ children, label }: { children: ReactNode; label: string }) {
  const [openId, setOpen] = useState<string | null>(null);
  const order = useRef<string[]>([]);
  const value = useMemo<BarState>(
    () => ({
      openId,
      setOpen,
      get order() {
        return order.current;
      },
      register(id) {
        order.current.push(id);
        return () => {
          order.current = order.current.filter((x) => x !== id);
        };
      },
    }),
    [openId],
  );
  return (
    <BarContext.Provider value={value}>
      <nav className="menubar" aria-label={label}>
        {children}
      </nav>
    </BarContext.Provider>
  );
}

const NO_ITEMS: readonly MenuItemDef[] = [];

const selectable = (it: MenuItemDef): it is Extract<MenuItemDef, { kind: 'item' }> =>
  it.kind === 'item' && !it.disabled;

/** One menu: a button and its popover. `items` is read when the popover is open. */
export function MenuButton({
  label,
  items,
  align = 'start',
  className,
  children,
  title,
}: {
  label: string;
  /** The items, or a function that builds them (called only while the menu is open). */
  items: readonly MenuItemDef[] | (() => readonly MenuItemDef[]);
  align?: 'start' | 'end';
  className?: string;
  /** Replaces the text label (an icon button); `label` stays the accessible name. */
  children?: ReactNode;
  title?: string;
}) {
  const bar = useContext(BarContext);
  const uid = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const open = bar ? bar.openId === uid : localOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (bar) bar.setOpen(v ? uid : null);
      else setLocalOpen(v);
    },
    [bar, uid],
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const list = open ? (typeof items === 'function' ? items() : items) : NO_ITEMS;
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [focusStart, setFocusStart] = useState<'first' | 'last'>('first');

  const register = bar?.register;
  useEffect(() => (register ? register(uid) : undefined), [register, uid]);

  // Anchor under the button (clamped to the viewport) when it opens.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const w = panelRef.current?.offsetWidth ?? 260;
    const left = align === 'end' ? r.right - w : r.left;
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - w - 8)), top: r.bottom + 6 });
  }, [open, align]);

  // Focus the first or last item once the panel is placed.
  useEffect(() => {
    if (!open || !pos) return;
    const els = panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled])');
    if (!els || els.length === 0) return;
    (focusStart === 'last' ? els[els.length - 1] : els[0])?.focus({ preventScroll: true });
  }, [open, pos, focusStart]);

  // Outside pointer and Escape close it; scrolling or resizing closes it too (it is anchored in place).
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('resize', resize);
    };
  }, [open, setOpen]);

  const toNeighbour = (dir: 1 | -1) => {
    if (!bar) return;
    const order = bar.order;
    const i = order.indexOf(uid);
    const next = order[(i + dir + order.length) % order.length];
    if (next && next !== uid) {
      setFocusStart('first');
      bar.setOpen(next);
    }
  };

  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusStart(e.key === 'ArrowUp' ? 'last' : 'first');
      setOpen(true);
    }
  };

  const onPanelKey = (e: ReactKeyboardEvent) => {
    const els = [
      ...(panelRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled])') ?? []),
    ];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const focusAt = (k: number) => els[(k + els.length) % els.length]?.focus({ preventScroll: false });
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(i + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(i < 0 ? -1 : i - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        break;
      case 'End':
        e.preventDefault();
        focusAt(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        toNeighbour(1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        toNeighbour(-1);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  };

  const select = (it: Extract<MenuItemDef, { kind: 'item' }>) => {
    it.onSelect();
    if (!it.keepOpen) {
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className ?? 'menu-trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={children ? label : undefined}
        title={title}
        id={`${uid}-trigger`}
        data-open={open || undefined}
        onClick={() => {
          setFocusStart('first');
          setOpen(!open);
        }}
        onPointerEnter={() => {
          if (bar && bar.openId !== null && bar.openId !== uid) {
            setFocusStart('first');
            bar.setOpen(uid);
          }
        }}
        onKeyDown={onTriggerKey}
      >
        {children ?? label}
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="menu-panel"
              role="menu"
              aria-labelledby={`${uid}-trigger`}
              style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
              onKeyDown={onPanelKey}
            >
              {list.map((it) => {
                if (it.kind === 'separator') return <hr key={it.id} className="menu-sep" />;
                if (it.kind === 'heading')
                  return (
                    <div key={it.id} className="menu-heading" role="presentation">
                      {it.label}
                    </div>
                  );
                const role = it.radio
                  ? 'menuitemradio'
                  : it.checked !== undefined
                    ? 'menuitemcheckbox'
                    : 'menuitem';
                return (
                  <button
                    key={it.id}
                    type="button"
                    role={role}
                    className="menu-item"
                    tabIndex={-1}
                    {...(it.checked === undefined ? {} : { 'aria-checked': it.checked })}
                    aria-disabled={it.disabled || undefined}
                    data-checked={it.checked || undefined}
                    onClick={() => selectable(it) && select(it)}
                  >
                    <span className="menu-item-lead" aria-hidden="true">
                      {it.checked !== undefined ? (
                        <span
                          className={it.radio ? 'menu-radio' : 'menu-check'}
                          data-on={it.checked || undefined}
                        />
                      ) : (
                        it.icon
                      )}
                    </span>
                    <span className="menu-item-label">{it.label}</span>
                    {it.hint ? <span className="menu-item-hint">{it.hint}</span> : null}
                    {it.keys && it.keys.length > 0 ? (
                      <span className="menu-item-keys" aria-hidden="true">
                        {it.keys.map((k) => (
                          <kbd key={k} className="kbd">
                            {k}
                          </kbd>
                        ))}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
