# `web/src/motion`: the Flux interaction language

Energy and current drawn from the network. A short run of light follows the outline of what you press, a spark lands on what you turn on, a streak crosses what just arrived, and a circle of light opens a window out of the thing that summoned it. Everything else is still, and costs nothing.

The design is `docs/design/motion-language.md`: read its sections 3 (the vocabulary), 7 (the rules against overwhelm) and 12 (the checklist) first. This file is how to wire it into the app. The gallery is `/dev/motion` (the real UI kit, in the three motion modes, side by side).

| Word | Says | Fires on | You write |
|---|---|---|---|
| Pulse | got it | `data-pressed` on a kit button | nothing |
| Charge | live under your pointer | hover and keyboard focus | nothing for kit buttons; `data-fx="charge"` elsewhere |
| Spark | it is on | `data-state` turning `on`, `copied`, `selected` | nothing for the kit's toggles |
| Current | something arrived | `data-fresh` on an opted-in row; a `<Current>` signal | `data-fx="current"` or `<Current>` |
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

It finds the selected tab by `aria-selected`, `aria-current` or `data-selected` (or the `selector` prop), watches for changes and resizes, and does nothing between them. Reduced and Off: the line jumps.

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

The Pulse feed (dense, so quiet): every row settles with the kit's wash; only the P0 block row and P1 rows (a payment to a watched or owned node) earn a Current along their top edge. Opt those in and nothing else:

```tsx
<li className="evt" data-fresh={fresh || undefined} data-fx={isBlock || isMine ? 'current' : undefined}>
```

The streak runs when `data-fresh` appears on the element (not for a row that was already there). `data-fx-edge="bottom"` and the other edges are available for odd layouts.

### Window chrome

Wrap the window in `<PowerOn>`: it mounts its children on `open`, reveals them with the aperture and the light surge, and on close plays the shorter exit and unmounts.

```tsx
<PowerOn
  open={isOpen}
  origin={() => launcherEl ?? nodeMarkerRect ?? undefined}   // an element, a DOMRect or {x, y}; read at open and at close
  onExited={() => forget(win.id)}
  className="wm-slot"
  style={{ position: 'absolute', left, top, width, height, zIndex }}
>
  <div className="wm-shadow">           {/* the drop shadow: a wrapper, since box-shadow ignores masks */}
    <section className="wm-window">...</section>   {/* the chamfer, the mask, the rim */}
  </div>
</PowerOn>
```

- **The wrapper is the animated element.** Give it the window's position and size (`className` and `style` are forwarded to it). It must have no `clip-path`, `mask`, `box-shadow` or `filter` of its own: then it gets the circle reveal (the aperture, which runs 64 px past the farthest corner so a drop shadow is never cut off). With any of those it still scales, fades and surges, and the clip is skipped. Put the chamfer, mask and shadow on the children.
- **Closing needs the window to stay mounted until it is done.** `open={false}` plays the exit and calls `onExited`, but a window the manager removed from its list is unmounted by React at once. Keep rendering it with `open={false}` until `onExited` (a `leaving` set keyed by window id, rendered with the visible list). With motion off, or before the runners have loaded, `onExited` comes at once: closing never waits on decoration.
- **Re-opening mid-close** brings the window back visible and cancels the exit.
- **Title bar controls** (close, minimise, pin): mark the title bar `data-fx-density="dense"`; the window closing is their answer.
- **Focus arrival** (the one-time rim flare of design 6.4 C) is plain CSS on `[data-focused]`, an event and not a loop. The 9 s rim sweep is dropped (design section 14).
- **While dragging**, nothing plays: Power-on is for open and close only.

### Toasts and the command palette

```tsx
<PowerOn open={visible} variant="panel" onExited={dismiss}>
  <div className="toast" role="status">...</div>
</PowerOn>
```

A quicker scale from 0.97 and fade (260 ms) with one comet along the top edge. Keep a toast mounted until `onExited`, as for windows.

### Block rail cards

```tsx
<div className="rail" style={{ position: 'relative' }}>
  <Current signal={tip.height} edge="top" tail={120} disabled={frozen} />
  {cards.map((c) => (
    <article key={c.height} className="rail-card" style={{ position: 'relative' }}>
      <Current signal="landed" edge="perimeter" fireOnMount={c.height > heightAtFirstPaint} disabled={frozen} />
      ...
    </article>
  ))}
</div>
```

One streak crosses the rail's top edge per block, and the card that just landed is circled once. The hosts must be positioned (`<Current>` renders an absolute, zero-size, `aria-hidden` track inside its parent and nothing else). `fireOnMount` only for cards that landed after the first paint (the ones the page loaded with do not circle), and `disabled` while the rail is hover-frozen or scrolled into history. The rail is not a dense zone. The card's white rim and its Beat landing thunk are static CSS (design 6.4 F).

### Status bar: the tip counter and connection

```tsx
<FlashOnChange value={height} tone="white"><AnimatedNumber value={height} /></FlashOnChange>
```

Nothing from this folder: the kit draws the settle. The status bar is a dense zone (`data-fx-density="dense"`). A connection light is a static dot and a word: its state change is its own answer, with no loop and no light.

## 4. The frame's attributes (the integration pass)

What each frame attribute means to the language. Most mean nothing, on purpose.

| Attribute | On | What to do |
|---|---|---|
| `data-fresh` | `.evt` feed rows, rail cards | Current only on P0 and P1 rows via `data-fx="current"`; for rail cards use `<Current fireOnMount>` |
| `data-kind`, `data-tier` | rows, chips, cards | nothing: they are the kit's colour roles, and the light is never tier or status coloured |
| `data-leaving` | globe and rail cards | a plain fade; no light |
| `data-frozen` | `.pulse` (hover-freeze) | pass `disabled` to any `<Current>` there while frozen |
| `data-offline` | `.pulse` | nothing |
| `data-soon`, `data-late`, `data-hidden`, `data-pending`, `data-mine` | aim strip and chips | static states only: a brighter edge or a colour, never a loop |
| `data-state` on a status light | status bar | nothing: status lights are not on the spark list |
| `data-boot`, `data-layout` | `.shell` | nothing; effects only ever answer input, so the boot needs no switch. Touch layouts get no Charge (there is no hover) and keep the Pulse |
| `data-focused`, `data-dragging`, `data-placement`, `data-mode` | `.wm-window` | the wrapper gets PowerOn (above); focus arrival is CSS |

Z-order: the light layer is `position: fixed` on `<body>` at `z-index` 135 (`--fx-z`), above windows, toasts, the palette and tooltips, so a surge is never hidden. On the merged foundation, `.shell-stage` is a fixed container with no `z-index` of its own, which makes it a stacking context painted below the globe's labels (`--z-globe-hud`, 10) and the rail (`--z-rail`, 20): windows inside it paint under them whatever their own z-index. That is the frame's z-order to settle (give the stage `z-index: var(--z-window)`); the gallery portals itself to `<body>` for the same reason.

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

At most 3 flashes (Pulse and Spark) a second, 3 Pulses, 3 Sparks, 3 slides, 2 Currents and 2 window openings alive at once, 10 in all; a new effect on an element replaces its old one; the user's own effects preempt a live Current; a refused effect draws nothing and queues nothing. `motionStats()` returns `{ active, byKind, granted, dropped, preempted }` (null until the runners have loaded); the gallery's header shows it live.

## 9. Verify

```bash
cd web
ATLAS_API_TARGET=http://127.0.0.1:3100 ATLAS_WEB_PORT=5380 npx vite --host 127.0.0.1 --port 5380 --strictPort &
npx vitest run src/motion                                    # engine, budget, geometry, mode, React layer, timing and docs parity
node src/motion/tools/frames.mjs --list                      # frame-sequence scenarios (needs the dev server, Chromium, ImageMagick)
node src/motion/tools/frames.mjs --only pulse-primary,window-open --mode full --dpr 3
node src/motion/tools/frametime.mjs --dpr 2                  # real-time frame time beside the globe, idle and active
npm run build && node src/motion/tools/size.mjs dist         # the initial payload, gzip level 9
```

Contact sheets land in `/home/stache/.cache/flux-atlas/shots/m1/frames/` (`<scenario>-<mode>.png`, with the single frames in a folder beside it). Motion is judged as frames, never as stills: the tool freezes the Web Animations a real interaction started and seeks them to chosen times, so a capture is deterministic. Open `/dev/motion` and use Compare to see Full, Reduced and Off side by side.

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
| `react/` | `MotionRoot`, `Current`, `PowerOn`, `TabIndicator`, `usePulse`, `useCharge`, `useSpark` |
| `gallery/` | `/dev/motion`, lazy-loaded by the router |
| `tools/` | `frames.mjs` (frame sequences), `frametime.mjs` (real-time frame time), `size.mjs` (the initial payload of a build) |

## 11. Cost

Nothing at rest: no timers, no animation frames, no layers.

Bytes, gzip level 9, over the initial payload of the production build (167,091 B at the foundation): the lazy `/dev/motion` route that is merged today adds 25 B. Mounting `MotionRoot` adds 3.9 kB (JS 2.8 kB, CSS 1.1 kB) when it is imported from `motion/react/MotionRoot`, and 6.5 kB (3.9%) when the shell pulls every primitive through the `motion` barrel. The effect runners (7.3 kB JS and 1.1 kB CSS) are a separate chunk loaded on idle, and the gallery is a separate route chunk. `node src/motion/tools/size.mjs dist` prints the initial payload; single files shift by a few hundred bytes when Rollup re-splits shared chunks, so compare the totals of two builds.

Measured beside the running globe at 1600 by 900 (device pixel ratio 1 and 2, `tools/frametime.mjs`): a 60 fps lock at rest and during about 25 interactions in 8 s, with no frame over 25 ms that belongs to an effect. The tool attributes every long frame to its script: the one it does find (1 to 2 s, about every 12 s, with or without interaction) is the app's live WebSocket handler running the globe's mesh update (`GlobeEngine.updateMesh`, `addLinkInternal`), not the language. Two named paint-only exceptions to compositor-only, both bounded: the tab indicator's clip insets (a 2 px strip, 300 ms) and the window surge's radial gradient (one window-sized transparent layer, 480 ms, at most two at once).
