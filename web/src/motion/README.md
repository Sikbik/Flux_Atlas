# `web/src/motion`: the Flux interaction language

Energy and current drawn from the network. A short run of light follows the outline of what you press, a spark lands on what you turn on, a streak crosses what just arrived, and a circle of light opens a window out of the thing that summoned it. Everything else is still, and costs nothing.

The design is `docs/design/motion-language.md`: read its sections 3 (the vocabulary), 7 (the rules against overwhelm) and 12 (the checklist) first. This file is how to wire it into the app. The gallery is `/dev/motion` (the real UI kit, in the three motion modes, side by side).

| Word | Says | Fires on | You write |
|---|---|---|---|
| Pulse | got it | `data-pressed` on a kit button | nothing |
| Charge | live under your pointer | hover and keyboard focus | nothing for kit buttons; `data-fx="charge"` elsewhere |
| Spark | it is on | `data-state` turning `on`, `copied`, `selected` | nothing for the kit's toggles |
| Current | something arrived | `data-fresh` appearing on an opted-in row; a `<Current>` signal | `useFresh` and `data-fx="current"`, or `<Current>` |
| Power-on | here is what you opened | a window or panel opening and closing | `<PowerOn>` |
| Settle | this value changed | the kit's `FlashOnChange`, `AnimatedNumber`, fresh rows | nothing: the kit draws it |

## 1. Mount it once

```tsx
// web/src/app/App.tsx
import { MotionRoot } from '../motion';

<RuntimeProvider runtime={runtime}>
  <MotionRoot>
    <RouterProvider router={router} />
  </MotionRoot>
</RuntimeProvider>
```

- **Where.** Once, for the whole session, above the router outlet and the portals: `App.tsx` around `RouterProvider`, or `main.tsx` around `<App/>`. Never inside a route or a window (it must not unmount on navigation). It renders no element and no context; it re-renders nothing.
- **What it needs.** Nothing from its parents. It reads the stored Motion preference from `useUi` (`web/src/store/ui.ts`, a zustand store, no provider), draws its light into one fixed layer on `<body>`, and relies on `tokens.css` and the kit's styles, which the app loads already. Portalled content (windows, menus, tooltips) joins automatically because the engine listens on the document.
- **What it does.**
  1. Starts the engine: four passive capture listeners and one `MutationObserver` filtered to `data-pressed`, `data-state`, `data-fresh`, `aria-checked`, `aria-pressed`, `aria-selected`. Nothing else runs at rest.
  2. Mirrors the effective motion mode to `<html data-motion>` (the attribute the kit's components and `tokens.css` switch on; nothing else writes it from the stored preference) and to `<html data-fx-mode>`. It never overrides a mode the page forced there (a screenshot run, an embedding shell).
  3. Loads the effect runners (a separate chunk, about 8 kB gzipped with their CSS) on idle.
- **Settings.** The Motion setting (Full, Reduced, Off, System) is `useUi.motion`. Settings changes that value and nothing else; MotionRoot follows it live, and the OS `prefers-reduced-motion` when it is `system`.
- **Without a MotionRoot.** `usePulse`, `useCharge`, `useSpark`, `<Current>`, `<PowerOn>` and `<TabIndicator>` install the engine themselves (reference counted), so each works alone, in a test or a story. A MotionRoot at the top is still the one to ship: it is what mirrors the mode and what listens for the kit's attributes.

## 2. The kit joins by itself

The engine answers the attributes the UI kit already writes (`web/src/ui/README.md`, "Attach points"). Nothing below needs code.

| Kit component | Attribute it writes | The language answers |
|---|---|---|
| `Button`, `IconButton` (every variant and size) | `data-pressed` | Pulse (white light on `primary` and `danger`), and the Charge ring on hover and focus |
| `Switch` | `data-state` `on` or `off` | Spark at the end of the track, after the knob has arrived |
| `Chip` as a toggle (`onClick`) | `data-state` | Spark at its icon. No Pulse: a toggle answers once |
| `CopyButton` | `data-state` `copied` | Spark at its icon |
| `Tabs`, `SegmentedControl` | `data-state` `selected` | nothing: they glide their own ink |
| `DataTable` | `data-fresh`, `data-enter` | nothing: the kit's wash is Settle, and a table is a quiet zone |
| `FlashOnChange`, `AnimatedNumber` | `data-flash`, `data-mode` | nothing: this is Settle |
| `Menu`, `Select`, `Slider`, fields, `Card`, `Stat` | `data-pressed` | nothing |

The lists live in `attach.ts` (`rules.press`, `rules.spark`, `rules.fresh`, `rules.charge`) and are short on purpose. A Spark also needs a recent real input in that control (within 900 ms), so a setting restored on load or changed by the app never sparks.

## 3. Component by component

### Buttons and icon buttons

Nothing to do: every `.ui-button` pulses and charges. Overrides, all optional:

```tsx
<Button data-fx-tone="hot">...</Button>      // white light instead of the accent
<Button data-fx="off">...</Button>            // no effect on this one (or on anything inside it)
<div data-fx-density="dense">...</div>       // a dense zone: no Pulse, Charge or Current inside
```

Mark a toolbar of four or more small controls, a table, a title bar and the status bar `data-fx-density="dense"` (the kit's `DataTable` is already quiet). Controls under 14 px, disabled and `aria-disabled` controls, and anything off screen draw nothing by themselves. A button that opens or closes a window should not also pulse: see the launchers.

### Dock launchers (a custom control, not in the kit)

Charge on hover and focus, and no Pulse: the window opening is the answer.

```tsx
<button type="button" className="shell-launcher" data-fx="charge" data-launcher={type} aria-label={label}>
```

`data-fx="charge"` gives the control `position: relative`, reserves its `::after` for the edge light (move a badge or a hit band to a child element or `::before`), and inherits its `border-radius`. If the launcher clips its overflow, set `--fx-inset: 0` on it. Hand the window the launcher as its source (section "Window chrome").

### Tabs

Use the kit's `Tabs` and `SegmentedControl`: they already glide their own ink, and nothing is added. For a tab-like list without any ink of its own:

```tsx
<div role="tablist" style={{ position: 'relative' }}>
  {tabs.map((t) => <button key={t.id} role="tab" aria-selected={t.id === value}>{t.label}</button>)}
  <TabIndicator />   {/* last child of a positioned host; drop the per-tab underline */}
</div>
```

It finds the selected tab by `aria-selected`, any `aria-current` that is not `false` (a bar of routes marks its lit tab `aria-current="page"`) or `data-selected` (or the `selector` prop), watches for changes and resizes, and does nothing between them. Reduced and Off: the line jumps. It measures in the host's own pixels, so a host that is still scaling when it mounts (the palette's chips under a panel that is powering on) gets its line in the right place. The line sits on the host's bottom edge; a bar that wants it on top moves it with CSS (`.shell-tabs .fx-indicator { top: -1px; bottom: auto }`).

On a phone's tab bar (`nav.shell-tabs`) it is the last child and the pill behind the lit tab stays as a state; in the command palette it follows the chosen kind chip (`data-selected`).

### Toggles

`Switch` needs nothing. A custom toggle:

```tsx
<div role="switch" aria-checked={on} data-fx="toggle" data-fx-spark="end" /> // end | start | icon; default: track end, first icon, centre
```

`data-fx-delay="ms"` waits for a sliding knob. Or in code: `useSpark(ref, on)` (fires when `on` turns true, never on mount). Turning off is quiet by design.

### Chips

A toggle chip (`<Chip onClick selected>`) sparks at its icon when it turns on and is not on the press list: one effect per interaction. A plain chip is static; a chip that is a link does nothing.

### Table rows and feed rows

`DataTable`: nothing. New rows arrive with the kit's own wash and `data-enter` fade (Settle), and a table is a quiet zone. Do not add `data-fx="current"` to table rows.

The Pulse feed (dense, so quiet): every row settles with the kit's wash; only P1 rows (a payment to a watched or owned node) earn a Current along their top edge. Opt those in and nothing else:

```tsx
const fresh = useFresh(keys, { scope: filter });          // the keys that just arrived
<li
  className="evt"
  data-fresh={fresh.has(key) || undefined}
  data-fx={isMine ? 'current' : undefined}
  data-fx-delay={isMine ? blockLightLeft(ev) : undefined}   // ms; see below
>
```

The streak runs when `data-fresh` appears on the element (not for a row that was already there), and it is drawn inside the row (a track the run puts in the host and removes when it ends), so it goes where the row goes while the row slides in; a host that is not positioned falls back to an overlay over its rectangle. The P0 block row does not get one: the rail already carries the block's light (a Current on the rail, one on the new card; the budget allows two at once). The payment row arrives with the block, so its Current would be the third light of the same moment and the budget would refuse it: `data-fx-delay="ms"` on a `data-fresh` row holds the Current back until that long has passed (one timer, started by the arrival; nothing is drawn if the row went away or stopped being fresh meanwhile) and the engine asks the budget only then. The Pulse counts it from when the block was seen, so the streak runs 1.1 s after the block (the rail's and the card's lights are gone by 990 ms), and a row that shows later than that lights at once. `data-fx-edge="bottom"` and the other edges are available for odd layouts.

### Marking arrivals: `useFresh`

The engine answers an attribute that **appears on an element that already exists** (`data-fresh`). An element that is created carrying it fires nothing, and the engine does not watch the document for new nodes (that would be a `childList` observer over every React commit, a cost the language refuses). `useFresh` is the one way a view writes the attribute so that the order is right:

```tsx
import { useFresh } from '../../motion/fresh';           // or from '../../motion'

const keys = useMemo(() => rows.map((r) => r.id), [rows]);  // identity changes only when the keys do
const fresh = useFresh(keys, { max: 3, scope: filter });    // ms defaults to 1800, a little over the kit's 1.6 s wash
...
<li key={r.id} data-fresh={fresh.has(r.id) || undefined} data-fx="current">
```

- The element mounts without the attribute and takes it in a second commit, before the next paint, and keeps it for `ms` whatever else re-renders.
- Nothing is fresh on the first fill, a refill is not an arrival (more than `max` keys at once: a resync, a filter change) and a change of `scope` starts over.
- Do not compute freshness from a timestamp while rendering (`Date.now() - ts < 1800`): that renders `data-fresh` on the element's first commit. `src/motion/fresh.contract.test.ts` reads the source of every view outside the kit and this folder and fails one that renders `data-fresh=` or opts a row into Current without `useFresh`.
- The kit's own `useFreshKeys` (`ui/table`) is a different hook for `DataTable`'s `highlightKeys` wash (Settle); it does not drive this.

### Window chrome

The app's windows call `powerOn` on the window's own element when it mounts and play `powerOff` on the ghost a closed window leaves (`shell/wm/react.tsx`, `ghost.ts`, `origin.ts`):

```tsx
useLayoutEffect(() => {
  const el = rootRef.current;
  const h = el && powerOn(el, { origin: windowOrigin(type, phone), variant: phone ? 'panel' : 'window' });
  return () => h?.cancel();
}, []);
```

- **The element is the window's wrapper.** It must have no `clip-path`, `mask`, `box-shadow` or `filter` of its own: then it gets the circle reveal (the aperture, which runs 64 px past the farthest corner so a drop shadow is never cut off). With any of those it still scales, fades and surges, and the clip is skipped. Put the chamfer, mask and shadow on children (`.wm-shadow`, `.wm-slab`).
- **The origin** is the dock launcher `[data-launcher="<id>"]` for the window's type (`launcherOf`), read when it opens and when it closes; a phone sheet's is the middle of its foot (`{ fx: 0.5, fy: 1 }`). The engine holds an origin to 48 px outside the element, so a launcher a thousand pixels away does not delay the first frame or slide the window.
- **Closing.** `powerOff` returns a handle whose `done` resolves when the exit has played, and at once when there is nothing to play (effects off, runners not loaded yet): closing never waits on decoration. The app plays it on a ghost (a copy of the frame) because a closed window is already gone from the manager's state and a route-bound body is the router's outlet; where the thing that closes can stay mounted, keep it mounted with `<PowerOn open={false}>` until `onExited`, as the command palette does.
- **Re-opening mid-close** brings the element back visible: `cancel()` removes the end state.
- **Title bar controls** (close, minimise, pin): mark the title bar `data-fx-density="dense"`; the window closing is their answer.
- **Focus arrival** (the one-time rim flare of design 6.4 C) is CSS on `[data-focused][data-flare]`, set for 900 ms when an open window takes the focus, and never on a window that is opening: Power-on has its own light. The 9 s rim sweep is dropped (design section 14).
- **While dragging**, nothing plays: a press on the window ends its entrance.

`<PowerOn open origin onExited>` is the wrapper form of the same thing for a panel that is rendered by a parent that can keep it mounted (the command palette): it mounts its children on `open`, plays the entrance, and on `open={false}` plays the exit, unmounts and calls `onExited`.

### Toasts and the command palette

A toast is a pane of glass, so the animation is on the toast itself and not on a wrapper: an ancestor that fades stops a backdrop blur seeing the page behind it.

```tsx
useLayoutEffect(() => {
  const h = powerOn(ref.current, { variant: 'panel', origin: { fx: 1, fy: 0.5 } }); // the middle of its right edge
  return () => h?.cancel();
}, []);
useLayoutEffect(() => {
  const h = leaving ? powerOff(ref.current, { variant: 'panel', origin: { fx: 1, fy: 0.5 } }) : null;
  return () => h?.cancel();
}, [leaving]);
```

A quicker scale from 0.97 and fade (260 ms) with one comet along the top edge, and an exit of 180 ms; the stack keeps a leaving toast mounted for that long. On a phone the toast grows out of the foot of the screen (`{ fx: 0.5, fy: 1 }`). The command palette uses `<PowerOn variant="panel" origin onExited>` around its slot, with its own origin (the middle of its top edge, so the edge the light runs along stays put).

### Block rail cards

```tsx
const fresh = useFresh(cardKeys, { max: 2 });
const landed = cards.find((c) => fresh.has(keyOf(c.block)));      // the newest card that just landed
const landedKey = landed ? keyOf(landed.block) : null;

<div className="rail" style={{ position: 'relative' }}>
  <Current signal={landedKey} edge="top" tail={120} disabled={frozen || landedKey === null} />
  {cards.map((c) => (
    <li key={keyOf(c.block)} className="blk-item" style={{ position: 'relative', borderRadius: 12 }}>
      ...
      {fresh.has(keyOf(c.block)) ? <Current signal="landed" edge="perimeter" fireOnMount delay={90} /> : null}
    </li>
  ))}
</div>
```

One streak crosses the rail's top edge per block, and the card that just landed is circled once. Keying the streak to the newest fresh card means the first fill and a resync (which `useFresh` does not call arrivals) draw nothing. The hosts must be positioned (`<Current>` renders an absolute, zero-size, `aria-hidden` track inside its parent and nothing else), and the card's host takes the card's radius so the lap follows it. `delay` holds the lap back for the 90 ms the card's own landing waits, so the light starts when the card shows. `disabled` while the rail is hover-frozen or scrolled into history. The rail is not a dense zone. The card's white rim and its Beat landing thunk are the kit's Settle and static CSS (design 6.4 F); the rim is not drawn in Off.

### Status bar: the tip counter and connection

```tsx
<FlashOnChange value={height} tone="white"><AnimatedNumber value={height} /></FlashOnChange>
```

Nothing from this folder: the kit draws the settle. The status bar is a dense zone (`data-fx-density="dense"`). A connection light is a static dot and a word: its state change is its own answer, with no loop and no light.

## 4. The frame's attributes (the integration pass)

What each frame attribute means to the language. Most mean nothing, on purpose.

| Attribute | On | What to do |
|---|---|---|
| `data-fresh` | `.evt` feed rows, rail cards | written by `useFresh` only; Current only on P1 rows (mine) via `data-fx="current"`; the block row settles like the rest; for rail cards use `<Current fireOnMount>` |
| `data-kind`, `data-tier` | rows, chips, cards | nothing: they are the kit's colour roles, and the light is never tier or status coloured |
| `data-leaving` | globe and rail cards | a plain fade; no light |
| `data-frozen` | `.pulse` (hover-freeze) | pass `disabled` to any `<Current>` there while frozen |
| `data-offline` | `.pulse` | nothing |
| `data-soon`, `data-late`, `data-hidden`, `data-pending`, `data-mine` | aim strip and chips | static states only: a brighter edge or a colour, never a loop |
| `data-state` on a status light | status bar | nothing: status lights are not on the spark list |
| `data-boot`, `data-layout` | `.shell` | nothing; effects only ever answer input, so the boot needs no switch. Touch layouts get no Charge (there is no hover) and keep the Pulse |
| `data-focused`, `data-flare`, `data-dragging`, `data-placement`, `data-mode` | `.wm-window` | the wrapper gets Power-on (above); focus arrival is CSS on `data-flare` |

Z-order: the light layer is `position: fixed` on `<body>` at `z-index` 135 (`--fx-z`), above windows, toasts, the palette and tooltips, so a surge is never hidden. The frame settled its own: `.wm-layer` is a sibling of `.shell-stage` and paints over the globe's labels and the rail by its own `z-index`.

## 5. Outside the kit

Opt a custom element in with `data-fx` tokens (space separated: `data-fx="press charge"`):

| Token | Effect |
|---|---|
| `press` | Pulse on pointer down and on Enter or Space (never in a text field, never for a link's Space) |
| `toggle` | Spark when `data-state` or `aria-checked` or `aria-pressed` turns on |
| `charge` | the hover and focus ring (and the energised focus outline) |
| `current` | Current when `data-fresh` appears (`data-fx-edge` picks the edge, default top) |
| `focus` | only the energised focus outline |
| `off` | nothing, here or inside |

Or add a selector to a rule list once, at the seam where the app is assembled:

```ts
import { attach } from '../motion';
const detach = attach('press', '.shell-launcher'); // 'press' | 'spark' | 'fresh' | 'charge'
```

`charge` also needs its selector in `motion.css` (it is a stylesheet rule), so for one-off controls prefer `data-fx="charge"`. Hooks for elements you do not render: `usePulse(ref, { tone, force, enabled })` (returns a trigger), `useCharge(ref, enabled)`, `useSpark(ref, on, { at, from, delay, tone })`. Imperative, when there is no element to hang an attribute on: `pulse(el, opts)`, `spark(el, opts)`, `runCurrent(host, opts)`, `powerOn(el, opts)`, `powerOff(el, opts)`; they return a handle (`done`, `cancel`) or `null` when nothing is drawn.

## 6. Rules for CSS authors

- `::after` belongs to the edge light on `.ui-button` and on `[data-fx~="charge"]`. Do not use it on those.
- The ring sits over the control's 1 px border (`--fx-inset: -1px`). On a control with `overflow: hidden` or a clipping parent, set `--fx-inset: 0`.
- One effect per interaction. Do not add a second press animation, a ripple or an animated shadow to a control that pulses, and do not add a Pulse to something that already moves (a launcher, a tab, a window control).
- Light is brand: white, Blue Wave, brand blue (`--fx-*`). Never a tier or status colour.
- No idle loops in the chrome: no `infinite` animations, no timers for decoration. If it must say "still going", it is a state.
- The light layer is `aria-hidden` and `pointer-events: none`; do not put anything interactive in it.

## 7. Modes

Resolved in the same order as the kit's `useMotionMode()`: the nearest `[data-fx-mode]` ancestor, then `<html data-motion>` if it holds a mode, then the stored preference. To see or test a mode, set `data-motion` on `<html>` (the kit follows it too) or `data-fx-mode` on a subtree (this folder follows it; the gallery's Compare view does this). Reduced removes all travel and pointer-follow; Off draws nothing. See the design doc, section 6.

## 8. Budget and diagnostics

At most 3 flashes (Pulse and Spark) a second, 3 Pulses, 3 Sparks, 3 slides, 2 Currents and 2 window openings alive at once, 10 in all; a new effect on an element replaces its old one; the user's own effects preempt a live Current; a refused effect draws nothing and queues nothing. `motionStats()` returns `{ active, byKind, granted, dropped, preempted }` (null until the runners have loaded); the gallery's header shows it live, and `MotionRoot` exposes it as `window.__atlasMotion.stats()` for the tools below (a dev server serves a module twice once it has been hot-replaced, so a tool cannot import the engine and read the live one).

## 9. Verify

```bash
cd web
# the app needs a backend: the Rust server, or the demo server (cargo run --example demo_server)
ATLAS_API_TARGET=http://127.0.0.1:3100 ATLAS_WEB_PORT=5380 npx vite --host 127.0.0.1 --port 5380 --strictPort &
npx vitest run src/motion                                    # engine, budget, geometry, mode, React layer, timing and docs parity

# frame sequences (the dev server, Chromium, ImageMagick)
node src/motion/tools/frames.mjs --list                      # the gallery's scenarios
node src/motion/tools/frames.mjs --only pulse-primary,window-open --mode full --dpr 3
node src/motion/tools/frames-app.mjs --list                  # the same on the live app: windows, toast, block, P1 row, palette, phone
node src/motion/tools/frames-app.mjs --mode full,reduced,off --debug

# the quiet-zone audit and frame time (the dev server, or `vite preview` on a build)
node src/motion/tools/audit.mjs --mode full                  # rest and a burst against the budget; --phone, --only rest|stress
node src/motion/tools/frametime.mjs --app --dpr 2 --detail   # real-time frame time beside the live globe, with the scripts behind long frames
node src/motion/tools/window-cost.mjs --dpr 1                # window opens and closes in Full against Off (--base, --cycles)
node scripts/globe-check.mjs fps                             # the globe's own numbers (dev server)

# a production build, for the numbers to trust (React runs in development mode on the dev server)
npm run build && node src/motion/tools/size.mjs dist         # the initial payload, gzip level 9
ATLAS_API_TARGET=http://127.0.0.1:3100 ATLAS_WEB_PORT=5381 npx vite preview --host 127.0.0.1 --port 5381 --strictPort &
node src/motion/tools/frametime.mjs --app --base http://127.0.0.1:5381 --dpr 2
```

Contact sheets land in `/home/stache/.cache/flux-atlas/shots/m1/frames/` for the gallery and `/home/stache/.cache/flux-atlas/shots/m1/app/` for the app (`<scenario>-<mode>.png`, with the single frames in a folder beside it); the audit's shots of the frame at the peak of the burst and after it go to `.../m1/audit/`. Motion is judged as frames, never as stills: the tools freeze the Web Animations a real interaction started and seek them to chosen times, so a capture is deterministic (`frames-app.mjs` can also run the page's own timers at their time, which is how a row that waits for the block's light is checked). Open `/dev/motion` and use Compare to see Full, Reduced and Off side by side.

## 10. Files

| Path | What |
|---|---|
| `index.ts` | the public surface |
| `attach.ts` | the rule lists (what joins the language), `attach()`, the quiet zones |
| `engine.ts` | the delegated listeners, the observer, the imperative API (always loaded) |
| `mode.ts` | the motion mode: resolution, the `<html>` mirror, `useMotionMode` |
| `budget.ts` | the effect budget |
| `timing.ts`, `motion.css` | the durations, easings and `--fx-*` tokens (a test keeps them in step), the charge ring, the focus outline, the indicator, the mode rules |
| `fxRunners.ts`, `runners/` | the effect runners (a lazy chunk): `pulse`, `spark`, `current`, `power`, the comet chain, `fx.css` |
| `geometry.ts` | pure outline, easing and comet-frame maths |
| `indicator.ts` | the travelling selection line (also in the always-loaded part) |
| `fresh.ts` | `useFresh`: how a view marks an arrival so the engine can answer it (`data-fresh` appears on an element that exists), and the guard test beside it (`fresh.contract.test.ts`) |
| `react/` | `MotionRoot`, `Current`, `PowerOn`, `TabIndicator`, `usePulse`, `useCharge`, `useSpark` |
| `gallery/` | `/dev/motion`, lazy-loaded by the router |
| `tools/` | `frames.mjs` (gallery frame sequences), `frames-app.mjs` (the same on the live app), `audit.mjs` (what animates at rest, a burst against the budget), `frametime.mjs` (real-time frame time, `--app` for the live app), `window-cost.mjs` (window opens and closes, Full against Off), `size.mjs` (the initial payload of a build) |

## 11. Cost

Nothing at rest: no timers, no animation frames, no layers.

Bytes, gzip level 9, on the production build at this commit (`node src/motion/tools/size.mjs dist` prints the initial payload of the whole app: 215.4 kB). The language's always-loaded part is the engine, the rule lists, the mode, the indicator and the timing: 12.5 kB raw, about 5.4 kB gzip, and its stylesheet, 1.7 kB gzip. The effect runners, the comet geometry and the budget are a separate chunk loaded on idle (19.2 kB raw, 7.3 kB gzip), and the gallery is a separate route chunk. Single files shift by a few hundred bytes when Rollup re-splits shared chunks, so compare the totals of two builds.

Measured beside the running globe at 1600 by 900 on the GPU (section 9 has the commands). Production build, at device pixel ratio 1 and 2, 19 interactions in 8 s (windows from the dock, blocks on the rail, the palette, a switch and a press): mean 16.67 ms, median 16.7, 99th percentile 16.8, longest 16.8, and no frame over 25 ms. Windows opened and closed in Full against Off (32 each at 1x): opens 16.68 ms mean in both, closes 16.74 against 16.67, so the aperture clip over the drop shadow costs nothing measurable; the only slow frames are cold ones (the first open of the Explorer window, the first closes of the About window: one 33 ms frame, in Full and Off alike). The globe's own check at 2560 by 1440: 60 fps, 0.3 ms of engine CPU and 1.35 ms of GPU per frame.

On the dev server, where React runs in development mode, 16 of 411 frames pass 25 ms in the same mix: 12 are React's synchronous work in a click or key handler (mounting a window's content, the palette), none is in this folder, and the tool says so by attributing every long frame to its script. The live WebSocket handler's globe update (`GlobeEngine.updateMesh`, `addLinkInternal`) stalls the dev server for 1 to 2 s about every 12 s and is one 50 ms frame in the production build. Two named paint-only exceptions to compositor-only, both bounded: the tab indicator's clip insets (a 2 px strip, 300 ms) and the window surge's radial gradient (one window-sized transparent layer, 480 ms, at most two at once).

The audit (`tools/audit.mjs`, in Full, Reduced and Off, on a desktop and a phone) finds the app still at rest between two blocks, apart from state (the block timer's ring and the progress bars) and the About window's own decoration while it is open, and finds a burst of blocks, toasts, windows and the palette inside every cap with nothing left behind.
