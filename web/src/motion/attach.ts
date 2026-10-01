// What the interaction language attaches to. Attribute-driven: the engine watches the data
// attributes the UI kit already writes (web/src/ui/README.md, "Attach points") and answers them, so a
// component joins the language by being on a list here, not by importing anything from this folder.
//
//   data-pressed   appears while a pointer button or Space/Enter is held   -> Pulse   (rules.press)
//   data-state     turns `on`, `copied` or `selected`                       -> Spark   (rules.spark)
//   data-fresh     appears on a row or card that just arrived               -> Current (rules.fresh)
//   hover, focus   the edge of the control lights                           -> Charge  (rules.charge, and the CSS)
//
// A rule is a CSS selector for the element that carries the attribute. Anything outside the
// lists can opt in with `data-fx` tokens (`press`, `toggle`, `charge`, `current`) and opt out with
// `data-fx="off"` or `data-fx-density="dense"` on itself or an ancestor. `data-flash` and `data-enter`
// are answered by the kit's own stylesheets (a wash that decays, rows that fade in): the language does
// not draw a second one on top.
//
// The default lists are deliberately short: the buttons and the small toggles. Everything else in the
// kit (tabs, menu rows, table rows, fields, sliders, cards) keeps its own plain hover and press.
// One effect per interaction: a control that toggles answers with a Spark when it turns on and is
// not on the press list (a toggle chip, a switch, the copy button); a button that does something
// answers with a Pulse.

export type AttachKind = 'press' | 'spark' | 'fresh' | 'charge';

export const rules: Record<AttachKind, string[]> = {
  /** Pulse: the controls a person presses to do something. */
  press: ['.ui-button', '[data-fx~="press"]'],
  /** Spark: controls that turn on (Switch, a toggle chip, CopyButton), and any `data-fx="toggle"`. */
  spark: ['.ui-switch', 'button.ui-chip', '.ui-copy', '[data-fx~="toggle"]'],
  /** Current: a live arrival, along the top edge of the row or card that carries `data-fresh`. */
  fresh: ['[data-fx~="current"]'],
  /** Charge: the edge light on hover. Must match the selectors in motion.css (a test checks it). */
  charge: ['.ui-button', '[data-fx~="charge"]'],
};

/** `data-state` values that count as turning on. */
export const ON_STATES: ReadonlySet<string> = new Set(['on', 'copied', 'selected']);

/**
 * Where the language stays quiet: an element or ancestor that opts out, and dense views (a table, or
 * anything marked `data-fx-density="dense"`). A Spark is a confirmation of something the person just
 * did and is tiny, so it is only silenced by an explicit opt-out.
 */
export const QUIET = '[data-fx~="off"], [data-fx-density="dense"], .ui-table';
const OPT_OUT = '[data-fx~="off"]';

const quiet = (kind: AttachKind): string => (kind === 'spark' ? OPT_OUT : QUIET);

const joined = new Map<AttachKind, string>();

function selector(kind: AttachKind): string {
  let s = joined.get(kind);
  if (s === undefined) {
    s = rules[kind].join(', ');
    joined.set(kind, s);
  }
  return s;
}

/**
 * Adds selectors to a list at runtime (the app does this once, at the integration seam, for its own
 * components). Returns a function that removes them again. Charge also needs its selector in
 * motion.css (it is a stylesheet rule): for a one-off use `data-fx="charge"`.
 */
export function attach(kind: AttachKind, ...selectors: string[]): () => void {
  const added = selectors.filter((s) => !rules[kind].includes(s));
  rules[kind].push(...added);
  joined.delete(kind);
  return () => {
    for (const s of added) {
      const i = rules[kind].indexOf(s);
      if (i >= 0) rules[kind].splice(i, 1);
    }
    joined.delete(kind);
  };
}

/** The nearest element at or above `start` that a rule list names, unless it sits in a quiet zone. */
export function ruled(start: EventTarget | Element | null, kind: AttachKind): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const el = start.closest<HTMLElement>(selector(kind));
  return el && !el.closest(quiet(kind)) ? el : null;
}

/** True when `el` itself is named by the rule list (and not in a quiet zone). */
export function isRuled(el: Element, kind: AttachKind): boolean {
  return el.matches(selector(kind)) && !el.closest(quiet(kind));
}

/** True when the element's `data-fx` (space separated tokens) has `token`. */
export function hasToken(el: Element, token: string): boolean {
  const v = el.getAttribute('data-fx');
  if (!v) return false;
  for (const t of v.split(/\s+/)) if (t === token) return true;
  return false;
}
