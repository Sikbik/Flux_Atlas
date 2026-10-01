// Keyboard camera controls (design 7.2, 10.3, 10.4), as pure logic: which key does what, and when the
// globe may take a key at all. GlobeCanvas binds it to the window and calls the engine.
//
//   Arrow keys        orbit (turn the globe a step; Shift turns the heading and the pitch)
//   + and -           zoom a step (the selection holds still while it is on screen)
//   Home              the home view
//   F                 fly to the selection
//
// The globe takes a key only when nothing else is listening for it: never while text is typed, while
// the palette is open, while a menu, a listbox, a tab list, a slider or a dialog has focus, or while a
// window (docked or floating) has focus. A modifier (Ctrl, Cmd, Alt) always belongs to someone else.

export type CameraKey =
  | { kind: 'orbit'; x: number; y: number }
  | { kind: 'turn'; heading: number; tilt: number }
  | { kind: 'zoom'; steps: number }
  | { kind: 'home' }
  | { kind: 'focus' };

/** The camera action for a key, or null. */
export function cameraKeyFor(key: string, shift: boolean): CameraKey | null {
  switch (key) {
    case 'ArrowLeft':
      return shift ? { kind: 'turn', heading: -1, tilt: 0 } : { kind: 'orbit', x: -1, y: 0 };
    case 'ArrowRight':
      return shift ? { kind: 'turn', heading: 1, tilt: 0 } : { kind: 'orbit', x: 1, y: 0 };
    case 'ArrowUp':
      return shift ? { kind: 'turn', heading: 0, tilt: 1 } : { kind: 'orbit', x: 0, y: 1 };
    case 'ArrowDown':
      return shift ? { kind: 'turn', heading: 0, tilt: -1 } : { kind: 'orbit', x: 0, y: -1 };
    case '+':
    case '=':
      return { kind: 'zoom', steps: 1 };
    case '-':
    case '_':
      return { kind: 'zoom', steps: -1 };
    case 'Home':
      return { kind: 'home' };
    case 'f':
    case 'F':
      return shift ? null : { kind: 'focus' };
    default:
      return null;
  }
}

/** Focus inside any of these keeps its keys: fields, menus, lists, tabs, sliders, dialogs and windows. */
export const KEY_OWNERS = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="menuitem"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="tablist"]',
  '[role="slider"]',
  '[role="radiogroup"]',
  '[role="grid"]',
  '[role="tree"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '.wm-window',
].join(',');

/** Whether the globe may take a camera key now. `palette` is true while the command palette is open. */
export function globeTakesKeys(
  ev: {
    target: EventTarget | null;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    defaultPrevented: boolean;
    isComposing?: boolean;
  },
  active: Element | null,
  palette: boolean,
): boolean {
  if (ev.defaultPrevented || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || palette) return false;
  for (const el of [ev.target, active]) {
    if (!el || typeof (el as Element).closest !== 'function') continue;
    const e = el as Element;
    if ((e as HTMLElement).isContentEditable || e.closest(KEY_OWNERS)) return false;
  }
  return true;
}
