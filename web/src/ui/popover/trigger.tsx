// How Popover and Menu attach themselves to the element that opens them. A trigger is either an
// element (cloned with the ref, aria attributes and handlers merged in) or a render function that
// receives those props to spread. Elements must accept `ref`, `id`, `aria-*`, `onClick` and
// `onKeyDown`, as `Button`, `IconButton` and native elements do.

import {
  cloneElement,
  isValidElement,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
} from 'react';
import { mergeRefs } from './refs';

/** What an overlay injects into its trigger. Spread these onto the element when using a render function. */
export interface TriggerProps<Popup extends string> {
  /** Anchors the layer to the trigger. */
  ref: RefCallback<HTMLElement>;
  id: string;
  'aria-haspopup': Popup;
  'aria-expanded': boolean;
  /** The id of the open layer (absent while closed). */
  'aria-controls': string | undefined;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}

/** A trigger element, or a function that renders one from the props to spread on it. */
export type TriggerProp<Popup extends string> = ReactElement | ((props: TriggerProps<Popup>) => ReactNode);

interface ElementProps {
  id?: string;
  ref?: Ref<HTMLElement>;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
}

/** The id the trigger will carry: its own when it has one, else `fallback`. */
export function triggerIdOf<Popup extends string>(trigger: TriggerProp<Popup>, fallback: string): string {
  if (typeof trigger !== 'function' && isValidElement<ElementProps>(trigger) && trigger.props.id) {
    return trigger.props.id;
  }
  return fallback;
}

/** Renders the trigger with the overlay's props merged in; the element's own handlers run first. */
export function renderTrigger<Popup extends string>(
  trigger: TriggerProp<Popup>,
  props: TriggerProps<Popup>,
): ReactNode {
  if (typeof trigger === 'function') return trigger(props);
  if (!isValidElement<ElementProps>(trigger)) return trigger;
  const own = trigger.props;
  return cloneElement(trigger, {
    ...props,
    id: own.id ?? props.id,
    ref: mergeRefs<HTMLElement>(own.ref, props.ref),
    onClick: (e: MouseEvent<HTMLElement>) => {
      own.onClick?.(e);
      if (!e.defaultPrevented) props.onClick(e);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      own.onKeyDown?.(e);
      if (!e.defaultPrevented) props.onKeyDown(e);
    },
  });
}
