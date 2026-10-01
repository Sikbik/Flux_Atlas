# Window manager core (`web/src/shell/wm`)

A headless window manager for the Atlas shell: plain data, a pure reducer, a tiny store and a thin
React frame. It implements the window model of the design direction (sections 2.1 to 2.4, 3.2, 3.6,
6.4 B): windows are routes, the inspector docks right, explorer windows float left, the globe
re-centres in the free area, and the phone shows one sheet.

| File | What it holds |
|---|---|
| `types.ts` | `WindowType`, `Rect`, `WindowState`, `WmState`, `WmAction`, `TetherAnchor`, `Insets` |
| `specs.ts` | `WINDOW_SPECS` (title, placement, sizes, dockable, tether, key per type) and the constants |
| `route.ts` | `windowForPath`, `pathForWindow`, `parseExtraWindows`, `serializeExtraWindows` (pure) |
| `machine.ts` | `wmReduce`, `initialWmState`, `defaultWorkspace`, `clampRect` and the selectors |
| `store.ts` | `createWindowManager` (subscriptions, persistence), `wmKeyHandler` (keyboard) |
| `react.tsx` | `WindowManagerProvider`, `useWm`, `useWmDispatch`, `useWindowManager`, `WindowLayer`, `WindowFrame`, `WindowDots`, `useWindowMeta` |
| `wm.css` | the window chrome (`wm-` classes), imported by `react.tsx` |
| `chrome.ts`, `ghost.ts`, `meta.tsx`, `scrollfade.ts`, `glyphs.tsx` | the chrome's pure geometry (FLIP, gutter, stable order), the exit ghost, the title bar meta, the body's "more to read" fade, the glyph and accent per window type |
| `index.ts` | re-exports everything but the React layer |

## The model

There are three kinds of window, recorded in `WindowState.binding`:

- **primary**: the window the URL path names (`/node/65.109.26.93:16147` opens the node inspector).
- **extra**: windows that ride in `?w=` in stack order, at most two (`?w=queue,app:BitcoinWhitepaper`).
- **free**: windows opened imperatively (`open`), not in the URL.

There is **one window per type**: opening a type that is already open retargets it (node to node
swaps key, title and tether in place and keeps the window id, so the frame and tether do not
remount). An extra of the same type as the primary is dropped. Window ids are `${type}:${key}` of the
key the window opened with; look windows up by type with `windowOfType(state, type)`.

`time` and `weather` are not windows in the design (a strip and a layer): the WM tracks them so the
route is honoured, but `WindowLayer` never frames them and they never take focus.

Rules from design 2.3 and 2.4:

- **One docked window** (the right inspector slot). Docking another evicts the current one: a
  route-bound primary closes, anything else floats. An `extra` that would dock while the slot is taken
  opens floating instead.
- **At most two floating windows** plus the docked one: opening a third closes the oldest
  non-primary floating window.
- **Focus raises, never moves.** Minimized windows keep their place in `order`, are hidden, and are
  skipped by focus cycling.
- **Memory**: the last placement (docked or floating), floating rect and docked width per type are
  remembered and reused the next time that type opens. Persisted per browser (see below).

## State

```ts
interface WmState {
  windows: Record<string, WindowState>;
  order: string[];              // z-order, bottom to top
  focused: string | null;
  viewport: { w; h };
  workspace: Rect;              // where windows may go: viewport minus top bar, rail, status bar
  layout: 'desktop' | 'phone';  // phone under 720 px wide
  sheet: 'peek' | 'half' | 'tall' | 'full';
  drag: DragState | null;
  memory: Partial<Record<WindowType, { placement; rect; dockWidth }>>;
}
interface WindowState {
  id; type; key; title;
  placement: 'docked' | 'floating';
  mode: 'normal' | 'minimized' | 'maximized';
  rect: Rect;                   // floating rect (kept while docked or maximized)
  restoreRect: Rect | null;     // rect to return to from maximized
  dockWidth: number;            // width in the inspector slot
  tether: TetherAnchor;         // node | cluster (lat, lon) | moon | element | null
  binding: 'primary' | 'extra' | 'free';
  openedAt: number;
}
```

## Actions (`wmReduce(state, action)`; unchanged state is returned by identity)

| Action | Effect |
|---|---|
| `syncRoute { primary, extras, now? }` | Route binding. Opens or retargets the primary and the extras, closes route-bound windows whose type left the URL, demotes a former primary that moved into `?w=`. Focuses the primary only when it opened, changed key, became primary or was minimized, so re-syncing an unchanged URL (camera `c=` updates) never steals focus |
| `open { type, key, now?, binding? }` | Opens (default binding `free`) or retargets and focuses |
| `close { id }` | Removes; focus falls to the next topmost window |
| `focus { id }` | Raises and focuses; restores a minimized window |
| `cycleFocus { dir }` | Next or previous framed, non-minimized window in opening order |
| `minimize`, `maximize`, `restore { id }` | `maximize` fills the workspace and stores `restoreRect` |
| `toggleDock { id }` | Dock or float (dockable types only) |
| `dragStart { id, kind: 'move' \| 'resize', edges, px, py }` | Starts a drag. Moving the docked inspector undocks it; moving a maximized window tears it off at its restore size |
| `dragMove { px, py }` | Moves or resizes (edges `n s e w` and corners; min size from `--window-min-w/h`); computes the snap zone |
| `dragEnd {}` | Applies the snap, clamps into the workspace, remembers the placement |
| `resize { id, rect }` | Sets a floating rect (clamped) or the docked width (`rect.w`, clamped to 360..640) |
| `nudge { id, dx, dy, dw, dh }` | Keyboard move/resize, clamped; on the docked inspector `dw` changes its width |
| `setViewport { viewport, workspace }` | Re-clamps every window; switches between desktop and phone |
| `setTether { id, tether }` | The bindings resolve endpoint keys and host clusters into anchors |
| `setSheet { snap }`, `setTitle { id, title }` | Phone sheet height; live titles |

### Snap rules (drag by the title bar)

The zone is decided by the pointer, 24 px from the workspace edge (`SNAP_PX`):

| Zone | On release |
|---|---|
| left | left column: workspace x, full workspace height, the window's width |
| right | dockable types dock into the inspector slot; others take a right column of their width |
| top | maximize (the drag's start rect becomes `restoreRect`) |

`snapPreview(state)` returns the drop-zone rectangle while the pointer is in a zone; `WindowLayer`
draws it as `.wm-drop-zone`.

## Selectors

| Selector | Returns |
|---|---|
| `windowRect(state, id)` | the resolved on-screen rect: docked slot (right edge of the workspace, `dockWidth` wide, full height), workspace when maximized, the sheet on the phone, else `rect` |
| `visibleWindows(state)` | framed, non-minimized windows bottom to top; on the phone only the sheet (the focused window) |
| `dockedWindow(state)`, `topmost(state)`, `windowOfType(state, type)`, `minimizedWindows(state)` | |
| `globeInset(state)` | `{ left, right, top, bottom }` for `engine.setInset`: the workspace edges, plus the docked width + 24 on the right, plus a left-floating explorer, queue or analytics window's right edge + 24 on the left (design 3.2). Phone: the bottom is the sheet's top edge |
| `snapPreview(state)` | drop zone while dragging |

## Store and persistence

```ts
const wm = createWindowManager({ storage?, now?, viewport?, workspace? });
wm.getState(); wm.subscribe((s, prev) => ...); wm.dispatch(action);
```

`now` is filled into `open` and `syncRoute` when omitted. Only `memory` is persisted, under
`localStorage['atlas.wm.v1']`; every access is in try/catch (private mode or a full quota only lose
the memory), and malformed entries are dropped on load. Everything else comes from the URL, as the
design asks (2.4 Reload): there is no session store to drift out of sync.

## Keyboard (`wmKeyHandler(wm, { onEscape?, onCloseRoute? })`)

Attach the returned function to `keydown` on `window`; it returns true and prevents the default when
it handled the key.

| Key | Action |
|---|---|
| Esc | `onEscape()` first (return true to consume, for example clearing the selection, design 2.4); else closes the topmost window. Route-bound windows go to `onCloseRoute(win)` so the shell navigates and `syncRoute` closes them. In a field, Esc only blurs it |
| Alt + backquote / Alt + Shift + backquote | focus next / previous window |
| Alt + Arrow | move the focused floating window 16 px (Shift: 64 px) |
| Alt + Ctrl + Arrow | resize it (Right and Down grow); on the docked inspector Left widens, Right narrows |
| Alt + D | dock or float |
| Alt + M | minimize |
| Alt + Enter | maximize or restore |

Keys typed into inputs, textareas, selects and contenteditable elements are ignored. The launcher
letters in `WINDOW_SPECS[type].key` (N, A, E, Q, S, O, M, T, W, backquote) belong to the shell's
global keymap (design 10.4), not to this handler.

## Integrating it in the frame

1. Create one manager for the session and wrap the shell in `<WindowManagerProvider wm={wm}>`.
2. Measure the workspace (the region between the top bar and the rail/status bar, right of nothing:
   the dock floats over the globe) on resize and dispatch `setViewport({ viewport, workspace })`.
3. On every location change dispatch `syncRoute({ primary: windowForPath(pathname), extras:
   parseExtraWindows(search.w) })`.
4. Subscribe to the store and call `engine.setInset(globeInset(state))` when it changes, so the globe
   and the moon re-centre in the free area (300 ms, design 6.4 B).
5. Tethers: `windowRect(state, id)` gives the header position; the window's `tether` says what the
   line points at (`node` -> `engine.projectNode`, `cluster` -> `engine.project(lat, lon)`, `moon` ->
   `engine.moonState()`). Draw them from the one rAF label loop, not from React renders.
6. Render `<WindowLayer renderContent={(win) => ...} onRequestClose={(win) => ...} />`. The primary
   window's content is the route's `<Outlet />`; extras and free windows render from a registry keyed
   by type. `onRequestClose` navigates for `primary` (to `/`, keeping the query) and rewrites `?w=` for
   `extra`, and dispatches `close` for `free` windows. Put `<WindowDots />` under the dock launchers.
7. Install `wmKeyHandler` on `window` with `onEscape` clearing the selection first.

## The window chrome (`react.tsx`, `wm.css`)

A window is a `section.wm-window[role=dialog]` wrapper (geometry, the drop shadow, the state attributes)
around a `.wm-slab` (the material, the 1 px rim, the chamfered top right corner), plus the resize handles
and `.wm-cut` (the hairline on the chamfer's diagonal). Inside the slab: `.wm-titlebar` (glyph disc, title,
subtitle, freshness chip, controls), then `.wm-body`.

State attributes on the wrapper, for CSS and for anything that wants to attach to a window:
`data-window-type`, `data-window-id`, `data-placement` (`docked`, `floating`, `sheet`), `data-mode`
(`normal`, `minimized`, `maximized`), `data-focused`, `data-dragging`, `data-accent` (a Flux blue tone or
white) or `data-tier` (a node window wears its tier). Tests and tethers find windows by these; a ghost
(below) never carries them.

| Behaviour | How |
|---|---|
| Open | the wrapper scales from 0.96 and fades in (`wm-open`, `--dur-slow`); reduced motion fades only |
| Focus | the hot rim cross-fades in over the quiet one; a hairline of light passes along the top edge every 9 s (dropped in reduced motion and the lite tier) |
| Drag | `scale(1.006)` and a deeper shadow; the snap zone previews as `.wm-drop-zone` |
| Move to a new rectangle (maximise, dock, float, snap) | one FLIP of transform from the old rectangle, 340 ms, never while dragging, resizing or when the viewport changed |
| Close | a ghost (a copy of the frame, inert, `aria-hidden`, without the identity attributes) fades and shrinks in place, 200 ms |
| Minimise | the ghost flies to the window's `.wm-dot` in the dock, 300 ms |
| Retarget (node to node) | the body fades in with a 6 px rise, 320 ms; the frame stays |
| Body | thin scrollbar; fades over its last 30 px only while there is more to read (`data-more`) |

Only transform and opacity animate. A docked, snapped or maximised window that fills the workspace's
height is drawn with a 12 px gutter above and below (`withGutter`); the shell leaves a 12 px margin at the
workspace's right edge, so a docked inspector floats clear of the screen like the others.

Each `Frame` selects its own window, and the view inside is memoised on the fields it depends on (type,
key, binding, placement, mode, title): dragging changes the rectangle every frame and re-renders neither
the layer nor the view. Frames keep the order they appeared in the DOM (`stableOrder`) and stack by
z-index: moving a frame's element in the document would cancel a click that is half done on one of its
controls. Pressing a control on an unfocused extra window raises it but does not make it the path's
window, so Close and Minimise act on the window you pressed them on.

### Telling the frame about a window: `useWindowMeta`

```tsx
import { useWindowMeta } from '../../shell/wm/react';

useWindowMeta({
  subtitle: 'Stratus node, Helsinki',   // a line under the title
  mono: true,                            // set the title in Plex Mono (IPs, ids, hashes)
  tier: 'stratus',                       // a node window wears its tier colour and capsule glyph
  fresh: { label: 'nodes', evidenceMs: lastNodesMs, cadenceMs: 90_000 },  // the title bar's own freshness chip
});
```

Call it from anywhere inside the window's content; it clears when the content unmounts. `accent` overrides
the type's default (`WINDOW_ACCENT` in `glyphs.tsx`). The title itself stays the window manager's (`setTitle`).
The chip uses the same rule as the status bar: fresh under 1.5x the cadence, aging to 3x, stale to 10x, dead
beyond; an unknown time reads "Unknown".

### Not built

The aperture open (a clip-path circle out of the clicked launcher or marker, 6.4 A) and the pop-out are not
here: the open is a plain scale and fade, which the motion layer can replace by attaching to the state
attributes above. The phone sheet's grabber cycles peek, half, tall, full on click.
