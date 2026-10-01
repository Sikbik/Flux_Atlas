import {
  type ComponentPropsWithRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useId,
  useRef,
} from 'react';
import { cx } from '../internal/cx';
import type { Placement } from '../internal/position';
import { AnchoredLayer, type DismissReason } from './AnchoredLayer';
import { focusablesIn } from './focus';
import './Popover.css';
import { useControllableState } from '../internal/useControllable';
import { renderTrigger, type TriggerProp, type TriggerProps, triggerIdOf } from './trigger';

/** The props a Popover injects into its trigger (spread them when `trigger` is a function). */
export type PopoverTriggerProps = TriggerProps<'dialog'>;

/** Props of a Popover: the attributes of its surface (`ref`, `className`, `style`, `data-*`) plus the following. */
export interface PopoverProps
  extends Omit<
    ComponentPropsWithRef<'div'>,
    'content' | 'children' | 'aria-label' | 'role' | 'id' | 'tabIndex' | 'onKeyDown'
  > {
  /** What opens the popover: an element (a `Button`, an `IconButton`) or a function that renders one from the props to spread. */
  trigger: TriggerProp<'dialog'>;
  /** The content. A function receives `close`, which closes the popover and returns focus to the trigger. */
  content: ReactNode | ((api: { close: () => void }) => ReactNode);
  /** Accessible name of the popover (it is a `dialog`). */
  'aria-label': string;
  /** Preferred placement (default `bottom-start`); flips and clamps to stay on screen. */
  placement?: Placement;
  /** Gap between the trigger and the popover in px (default 6). */
  offset?: number;
  /** Open state (controlled). */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called when the popover asks to open or close. */
  onOpenChange?: (open: boolean) => void;
  /** Fixed width (px number or CSS length); default is the content's width, 200 px at least. */
  width?: number | string;
  /** Extra class for the popover surface. */
  className?: string;
  /** Move focus into the popover when it opens (default true). Turn off for popovers that appear on hover. */
  autoFocus?: boolean;
}

/**
 * An anchored panel for small forms and detail (a filter set, a hover card with actions): glass-strong,
 * non-modal, a `dialog` with a required name. Focus moves in when it opens and back to the trigger on
 * Escape or a close; a press outside dismisses it without taking focus. It flips and clamps to the
 * viewport, and nests (a Select or Menu inside it works).
 */
export function Popover({
  trigger,
  content,
  'aria-label': ariaLabel,
  placement = 'bottom-start',
  offset,
  open: openProp,
  defaultOpen,
  onOpenChange,
  width,
  className,
  autoFocus = true,
  ref,
  ...rest
}: PopoverProps) {
  const [open, setOpen] = useControllableState(openProp, defaultOpen ?? false, onOpenChange);
  const baseId = useId();
  const contentId = `${baseId}-content`;
  const triggerId = triggerIdOf(trigger, `${baseId}-trigger`);
  const anchorRef = useRef<HTMLElement | null>(null);

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) anchorRef.current?.focus();
    },
    [setOpen],
  );

  const onDismiss = (reason: DismissReason) => close(reason === 'escape');

  const onPlaced = useCallback(
    (layer: HTMLDivElement) => {
      if (!autoFocus) return;
      (focusablesIn(layer)[0] ?? layer).focus({ preventScroll: true });
    },
    [autoFocus],
  );

  // Tab leaves a non-modal popover: from its last element, on to what follows the trigger; Shift+Tab
  // from its first element, back to the trigger.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const items = focusablesIn(e.currentTarget);
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey) {
      if (!first || e.target === first || e.target === e.currentTarget) {
        e.preventDefault();
        close(true);
      }
    } else if (!last || e.target === last) {
      close(true);
    }
  };

  const triggerProps: PopoverTriggerProps = {
    ref: (node) => {
      anchorRef.current = node;
    },
    id: triggerId,
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? contentId : undefined,
    onClick: () => setOpen(!open),
    onKeyDown: () => {},
  };

  return (
    <>
      {renderTrigger(trigger, triggerProps)}
      <AnchoredLayer
        {...rest}
        layerRef={ref}
        open={open}
        anchor={anchorRef}
        placement={placement}
        offset={offset}
        onDismiss={onDismiss}
        onPlaced={onPlaced}
        width={width}
        id={contentId}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cx('ui-popover', className)}
        onKeyDown={onKeyDown}
      >
        {typeof content === 'function' ? content({ close: () => close(true) }) : content}
      </AnchoredLayer>
    </>
  );
}
