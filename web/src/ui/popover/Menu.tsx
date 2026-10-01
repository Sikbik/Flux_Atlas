import { Check } from 'lucide-react';
import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { KbdCombo } from '../controls/Kbd';
import { cx } from '../internal/cx';
import { navigateIndex, typeaheadIndex } from '../internal/keys';
import type { Placement } from '../internal/position';
import { pressHandlers } from '../internal/press';
import { AnchoredLayer, type DismissReason } from './AnchoredLayer';
import './Menu.css';
import { mergeRefs } from '../internal/refs';
import { useControllableState } from '../internal/useControllable';
import { buildMenu, type MenuItem } from './menu';
import { renderTrigger, type TriggerProp, type TriggerProps, triggerIdOf } from './trigger';
import { isTypeaheadKey, nextTypeahead, type TypeaheadState, typeaheadActive } from './typeahead';

export type {
  MenuAction,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from './menu';

/** The props a Menu injects into its trigger (spread them when `trigger` is a function). */
export type MenuTriggerProps = TriggerProps<'menu'>;

/** Props of a Menu: the attributes of its surface (`ref`, `className`, `style`, `data-*`) plus the following. */
export interface MenuProps
  extends Omit<
    ComponentPropsWithRef<'div'>,
    'children' | 'aria-label' | 'role' | 'id' | 'tabIndex' | 'onKeyDown' | 'onOpenChange'
  > {
  /** What opens the menu: an element (a `Button`, an `IconButton`) or a function that renders one from the props to spread. */
  trigger: TriggerProp<'menu'>;
  /** The rows: actions, `{ type: 'separator' }` and `{ type: 'label', label }`. */
  items: readonly MenuItem[];
  /** Preferred placement (default `bottom-start`); flips and clamps to stay on screen. */
  placement?: Placement;
  /** Accessible name of the menu. Default: the trigger's name. */
  'aria-label'?: string;
  /** Open state (controlled). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when the menu asks to open or close. */
  onOpenChange?: (open: boolean) => void;
  /** Extra class for the menu surface. */
  className?: string;
  /** Move focus into the menu when it opens (default true). */
  autoFocus?: boolean;
}

type OpenMode = 'pointer' | 'first' | 'last';

/**
 * A menu button's menu (design 8.4): actions with icons and key caps, group labels and separators,
 * checkable items and a danger style. Arrow keys, Home and End move between rows, typing jumps to a
 * label, Enter or Space chooses and closes, Escape closes and returns focus to the trigger. Use it for
 * top-bar menus (View, Go, Window) and for row actions behind a kebab `IconButton`.
 */
export function Menu({
  trigger,
  items,
  placement = 'bottom-start',
  'aria-label': ariaLabel,
  open: openProp,
  defaultOpen,
  onOpenChange,
  className,
  autoFocus = true,
  ref,
  ...rest
}: MenuProps) {
  const [open, setOpen] = useControllableState(openProp, defaultOpen ?? false, onOpenChange);
  const baseId = useId();
  const menuId = `${baseId}-menu`;
  const triggerId = triggerIdOf(trigger, `${baseId}-trigger`);
  const model = useMemo(() => buildMenu(items, baseId), [items, baseId]);
  const { actions } = model;
  const hasLead = actions.some((a) => a.icon || a.checked !== undefined);

  const anchorRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openMode = useRef<OpenMode>('pointer');
  const typed = useRef<TypeaheadState>({ buffer: '', at: 0 });
  const [active, setActive] = useState(-1);

  const isDisabled = useCallback((i: number) => !!actions[i]?.disabled, [actions]);
  const rows = useCallback(
    () =>
      menuRef.current ? Array.from(menuRef.current.querySelectorAll<HTMLElement>('[data-menu-row]')) : [],
    [],
  );

  const focusRow = (i: number) => {
    setActive(i);
    rows()[i]?.focus({ preventScroll: true });
  };

  // Keep the highlighted row inside a scrolled menu.
  useLayoutEffect(() => {
    if (!open || active < 0) return;
    rows()[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, rows]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setActive(-1);
    if (returnFocus) anchorRef.current?.focus();
  };

  const openFrom = (mode: OpenMode) => {
    openMode.current = mode;
    setOpen(true);
  };

  const choose = (i: number) => {
    const action = actions[i];
    if (!action || action.disabled) return;
    close(true);
    action.onSelect();
  };

  const onPlaced = useCallback(
    (layer: HTMLDivElement) => {
      if (!autoFocus) return;
      const mode = openMode.current;
      const target =
        mode === 'pointer'
          ? null
          : navigateIndex(mode === 'first' ? 'Home' : 'End', -1, actions.length, { isDisabled });
      if (target === null) layer.focus({ preventScroll: true });
      else {
        setActive(target);
        rows()[target]?.focus({ preventScroll: true });
      }
    },
    [autoFocus, actions.length, isDisabled, rows],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      close(true);
      return;
    }
    const next = navigateIndex(e.key, active, actions.length, { orientation: 'vertical', isDisabled });
    if (next !== null) {
      e.preventDefault();
      focusRow(next);
      return;
    }
    const now = Date.now();
    const midWord = typeaheadActive(typed.current, now);
    if (isTypeaheadKey(e) && (e.key !== ' ' || midWord)) {
      e.preventDefault();
      typed.current = nextTypeahead(typed.current, e.key, now);
      const hit = typeaheadIndex(
        actions.map((a) => a.label),
        typed.current.buffer,
        active,
        isDisabled,
      );
      if (hit !== null) focusRow(hit);
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: (node) => {
      anchorRef.current = node;
    },
    id: triggerId,
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    // A click with no pointer behind it (Enter or Space on the trigger) opens on the first row.
    onClick: (e) => {
      if (open) close(false);
      else openFrom(e.detail === 0 ? 'first' : 'pointer');
    },
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        openFrom('first');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        openFrom('last');
      }
    },
  };

  const onDismiss = (reason: DismissReason) => close(reason === 'escape');

  return (
    <>
      {renderTrigger(trigger, triggerProps)}
      <AnchoredLayer
        {...rest}
        open={open}
        anchor={anchorRef}
        placement={placement}
        onDismiss={onDismiss}
        onPlaced={onPlaced}
        layerRef={mergeRefs<HTMLDivElement>(menuRef, ref)}
        id={menuId}
        role="menu"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabel ? undefined : triggerId}
        tabIndex={-1}
        className={cx('ui-menu', className)}
        data-lead={hasLead || undefined}
        onKeyDown={onKeyDown}
      >
        {model.blocks.map((block) => {
          if (block.kind === 'separator') {
            return <hr key={block.key} className="ui-menu__sep" />;
          }
          const rowsOf = block.entries.map(({ action, index }) => {
            const checkable = action.checked !== undefined;
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                {...(checkable
                  ? { role: 'menuitemcheckbox', 'aria-checked': action.checked }
                  : { role: 'menuitem' })}
                aria-disabled={action.disabled || undefined}
                tabIndex={-1}
                data-menu-row=""
                data-state={checkable ? (action.checked ? 'on' : 'off') : undefined}
                data-active={active === index || undefined}
                data-danger={action.danger || undefined}
                data-disabled={action.disabled || undefined}
                className="ui-menu__item"
                onClick={() => choose(index)}
                onPointerMove={() => {
                  if (active !== index && !action.disabled) focusRow(index);
                }}
                {...pressHandlers<HTMLButtonElement>()}
              >
                {hasLead ? (
                  <span className="ui-menu__lead" aria-hidden="true">
                    {action.checked ? (
                      <Check size={16} strokeWidth={1.5} />
                    ) : Icon ? (
                      <Icon size={16} strokeWidth={1.5} />
                    ) : null}
                  </span>
                ) : null}
                <span className="ui-menu__label">{action.label}</span>
                {action.shortcut && action.shortcut.length > 0 ? (
                  <KbdCombo keys={action.shortcut} className="ui-menu__keys" />
                ) : null}
              </button>
            );
          });
          return block.label ? (
            // biome-ignore lint/a11y/useSemanticElements: a menu group is not a form fieldset
            <div key={block.key} role="group" aria-labelledby={block.label.id} className="ui-menu__group">
              <div id={block.label.id} className="ui-menu__heading">
                {block.label.text}
              </div>
              {rowsOf}
            </div>
          ) : (
            <div key={block.key} role="presentation" className="ui-menu__group">
              {rowsOf}
            </div>
          );
        })}
      </AnchoredLayer>
    </>
  );
}
