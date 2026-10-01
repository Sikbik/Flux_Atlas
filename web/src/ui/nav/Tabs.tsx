import type { LucideIcon } from 'lucide-react';
import {
  type ComponentPropsWithRef,
  type FocusEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { formatCompact } from '../../lib/format';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import { useAnimate } from '../internal/useMotion';
import { type EdgeFade, edgeFade, scrollLeftToReveal } from './scroll';
import './Tabs.css';
import { useRoving } from './useRoving';

export interface TabItem<T extends string = string> {
  /** Stable id: the value `onChange` reports. Use a route-friendly string (`overview`, `inputs-outputs`). */
  id: T;
  /** Visible label (sentence case). Also the tab's accessible name. */
  label: string;
  /** Icon before the label (a lucide icon component). */
  icon?: LucideIcon;
  /** A count or short text after the label. Numbers go through `formatCompact`; never pass 0 for "unknown". */
  badge?: number | string;
  /** Not selectable; arrow keys skip it. */
  disabled?: boolean;
}

type TabsLabel =
  | { 'aria-label': string; 'aria-labelledby'?: undefined }
  | { 'aria-labelledby': string; 'aria-label'?: undefined };

export type TabsProps<T extends string = string> = TabsLabel &
  Omit<ComponentPropsWithRef<'div'>, 'onChange' | 'children' | 'aria-label' | 'aria-labelledby' | 'id'> & {
    /** The tabs, in order. */
    items: readonly TabItem<T>[];
    /** The id of the selected tab (controlled; mirror it in the URL when the tab is shareable). */
    value: T;
    /** Called with the id of the tab the user picked. */
    onChange: (id: T) => void;
    /** `md` is 34 px (page and inspector tabs); `sm` is 32 px with a heavier label (window tabs). */
    size?: 'md' | 'sm';
    /** `auto` selects on arrow keys (default); `manual` only moves focus, Enter or Space selects. */
    activation?: 'auto' | 'manual';
    /**
     * Base for the DOM ids of tabs and panels. Pass the same value as `tabsId` on each `TabPanel` so
     * `aria-controls` and `aria-labelledby` resolve; without it the tabs carry no `aria-controls`.
     */
    id?: string;
  };

/** DOM id of a tab button (`tabsId` is the `id` given to `Tabs`). */
export const tabDomId = (tabsId: string, id: string): string => `${tabsId}-tab-${id}`;
/** DOM id of a tab's panel. */
export const panelDomId = (tabsId: string, id: string): string => `${tabsId}-panel-${id}`;

/** Width the indicator line is drawn at; the line is scaled from it, so it never reflows. */
const INK_BASE = 100;
/** Distance the indicator sits inside the tab's edges (the tab's own padding is 2 px wider). */
const INK_INSET = 10;
/** Clearance kept between a revealed tab and the edge fades. */
const REVEAL_PAD = 28;

function measureInk(list: HTMLElement, ink: HTMLElement, instant: boolean): void {
  const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!tab) {
    delete ink.dataset.placed;
    return;
  }
  if (instant) ink.style.transition = 'none';
  ink.dataset.placed = '';
  ink.style.setProperty('--ui-ink-x', `${tab.offsetLeft + INK_INSET}px`);
  ink.style.setProperty('--ui-ink-sx', String(Math.max(0, tab.offsetWidth - INK_INSET * 2) / INK_BASE));
  if (instant) {
    void ink.offsetWidth;
    ink.style.transition = '';
  }
}

function useEdgeFade(ref: RefObject<HTMLElement | null>): EdgeFade {
  const [fade, setFade] = useState<EdgeFade>(undefined);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setFade(edgeFade(el.scrollLeft, el.clientWidth, el.scrollWidth));
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, [ref]);
  return fade;
}

/**
 * Underline tabs (design 8.9 and 8.3). Controlled: pass `value` and `onChange`, with a plain string id
 * per tab so it maps to a route param. Roving tabindex with arrow keys, Home and End; the selected
 * tab carries a glowing underline in the window accent that glides on a transform. Overflowing tab
 * sets scroll horizontally with an edge fade, and keyboard focus keeps the focused tab in view.
 */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  size = 'md',
  activation = 'auto',
  id,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ...rest
}: TabsProps<T>) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const animate = useAnimate();
  const fade = useEdgeFade(scrollRef);
  const firstRun = useRef(true);
  const itemsKey = items.map((i) => i.id).join('\u0000');

  const roving = useRoving({
    ref: listRef,
    items,
    selectedId: value,
    itemSelector: '[role="tab"]',
    orientation: 'horizontal',
    onNavigate: (item) => {
      if (activation === 'auto') onChange(item.id);
    },
  });

  const reveal = (tab: HTMLElement, smooth: boolean) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const left = scrollLeftToReveal(
      { scrollLeft: scroller.scrollLeft, width: scroller.clientWidth },
      { left: tab.offsetLeft, width: tab.offsetWidth },
      REVEAL_PAD,
    );
    if (left !== scroller.scrollLeft) scroller.scrollTo?.({ left, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Place the indicator before paint; the first placement and size changes are instant, a change of
  // selection glides (the transition lives in CSS on the indicator's transform).
  useLayoutEffect(() => {
    const list = listRef.current;
    const ink = inkRef.current;
    if (!list || !ink) return;
    measureInk(list, ink, firstRun.current);
  }, [value, itemsKey, size]);

  // Tab widths change without a render here (webfont swap, a ticking badge): re-place instantly.
  useEffect(() => {
    const list = listRef.current;
    const ink = inkRef.current;
    if (!list || !ink || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measureInk(list, ink, true));
    for (const tab of list.querySelectorAll('[role="tab"]')) ro.observe(tab);
    return () => ro.disconnect();
  }, [itemsKey]);

  // Keep the selected tab in view when the value changes from outside (a URL, another control).
  useEffect(() => {
    const tab = listRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (tab) reveal(tab, animate && !firstRun.current);
    firstRun.current = false;
  }, [value, itemsKey]);

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab) reveal(tab, animate);
    roving.handlers.onFocus(e);
  };

  return (
    <div {...rest} className={cx('ui-tabs', className)} data-size={size}>
      <div ref={scrollRef} className="ui-tabs__scroll" data-fade={fade}>
        <div
          ref={listRef}
          role="tablist"
          className="ui-tabs__list"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          onKeyDown={roving.handlers.onKeyDown}
          onFocus={onFocus}
          onBlur={roving.handlers.onBlur}
        >
          {items.map((item) => {
            const selected = item.id === value;
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={tabDomId(baseId, item.id)}
                className="ui-tabs__tab"
                data-state={selected ? 'selected' : 'idle'}
                aria-selected={selected}
                aria-controls={id === undefined ? undefined : panelDomId(baseId, item.id)}
                tabIndex={roving.tabIndexFor(item.id)}
                disabled={item.disabled}
                onClick={() => {
                  if (!selected) onChange(item.id);
                }}
                {...pressHandlers<HTMLButtonElement>()}
              >
                {Icon ? (
                  <Icon className="ui-tabs__icon" size={14} strokeWidth={1.5} aria-hidden="true" />
                ) : null}
                <span className="ui-tabs__label">{item.label}</span>
                {item.badge !== undefined ? (
                  <span className="ui-tabs__badge">
                    {typeof item.badge === 'number' ? formatCompact(item.badge) : item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
          <span ref={inkRef} className="ui-tabs__ink" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

export interface TabPanelProps extends Omit<ComponentPropsWithRef<'div'>, 'id'> {
  /** The id of the tab this panel belongs to (a `TabItem` id). */
  id: string;
  /** The current tab value; the panel shows only while it equals `id`. */
  value: string;
  /** The `id` given to `Tabs`, so `aria-controls` and `aria-labelledby` resolve. */
  tabsId: string;
  /** Keep the content mounted while hidden (default: unmounted, so hidden tabs cost nothing). */
  keepMounted?: boolean;
  children?: ReactNode;
}

/** The panel a tab controls. Renders its element always (so `aria-controls` resolves) and its content only while active. */
export function TabPanel({ id, value, tabsId, keepMounted, className, children, ...rest }: TabPanelProps) {
  const active = id === value;
  return (
    <div
      role="tabpanel"
      id={panelDomId(tabsId, id)}
      aria-labelledby={tabDomId(tabsId, id)}
      className={cx('ui-tabpanel', className)}
      data-state={active ? 'open' : 'closed'}
      hidden={!active}
      tabIndex={active ? 0 : undefined}
      {...rest}
    >
      {active || keepMounted ? children : null}
    </div>
  );
}
