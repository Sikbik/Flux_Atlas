// "Skip to content": the first stop of the tab order. The chrome (the top bar's menus and omnibox, the dock's
// launchers, the rail's cards) stands in front of a window or a page in the reading order, so a keyboard user would
// otherwise tab through two dozen controls to reach the first one of the thing they opened. The link goes to what is
// open: the focused window's body (past its title bar's controls), else the topmost window's, else the page panel,
// else the globe's stage.

import { visibleWindows } from '../wm/machine';
import type { WmState } from '../wm/types';

export type SkipTarget = { kind: 'window'; id: string } | { kind: 'page' } | { kind: 'stage' };

/** Where the link goes. `hasPage` is whether the stage's page slot has anything in it. */
export function skipTarget(s: WmState, hasPage: boolean): SkipTarget {
  // On the phone only the sheet is visible, and it is the one to go to.
  const wins = visibleWindows(s);
  const win = (s.focused ? wins.find((w) => w.id === s.focused) : undefined) ?? wins[wins.length - 1];
  if (win) return { kind: 'window', id: win.id };
  return hasPage ? { kind: 'page' } : { kind: 'stage' };
}

interface Finder {
  querySelector(selector: string): Element | null;
}

/** The element for a target: a window's body, the page slot or the stage. */
export function skipElement(root: Finder, target: SkipTarget): HTMLElement | null {
  const el =
    target.kind === 'window'
      ? root.querySelector(`[data-window-id="${cssEscape(target.id)}"] .wm-body`)
      : root.querySelector(target.kind === 'page' ? '.shell-page' : '#shell-stage');
  return el as HTMLElement | null;
}

const cssEscape = (v: string): string =>
  typeof CSS !== 'undefined' ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');

/**
 * Moves focus to what is open. The container takes focus without joining the tab order (`tabindex="-1"`, which also
 * lets the arrow keys scroll it), and the next Tab lands on its first control. Returns whether focus moved.
 */
export function focusContent(s: WmState, doc: Document = document): boolean {
  const page = doc.querySelector('.shell-page');
  const el = skipElement(doc, skipTarget(s, !!page && page.childNodes.length > 0));
  if (!el) return false;
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus();
  return doc.activeElement === el;
}
