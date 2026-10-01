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
| `react.tsx` | `WindowManagerProvider`, `useWm`, `useWmDispatch`, `useWindowManager`, `WindowLayer`, `WindowFrame`, `WindowDots` |
| `wm.css` | minimal token-driven chrome (`wm-` classes), imported by `react.tsx` |
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

## For the shell team

`WindowFrame` is deliberately plain: a `section[role=dialog]` with `data-window-type`,
`data-window-id`, `data-placement` (`docked`, `floating`, `sheet`), `data-mode`, `data-focused` and
`data-dragging`, a `.wm-titlebar` drag handle with `.wm-btn` controls, `.wm-body` for content, and
`.wm-resize[data-edge]` handles. Everything visual in `wm.css` reads tokens (`--slab-bg-solid`,
`--line-*`, `--shadow-window*`, `--r-*`, `--window-titlebar-h`, `--z-window..--z-window-max`). Not
built here, and yours to add: the aperture open and close (6.4 A), the focus rim flare and sweep (6.4
C), the spring on snap and FLIP re-tiling (6.4 B), the swap animation (6.4 G), real icons for the
controls (they are text glyphs now), the tether drawing, the pop-out, and the sheet's drag gesture
(the grabber currently cycles peek, half, tall, full on click).
