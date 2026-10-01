# The frame and the live chrome (`features/chrome`, `shell/frame`, `shell/wm`)

Everything around the globe: the top bar and the phone header, the dock and the phone tabs, the block rail
and its ghost card, the status bar, the Pulse feed, the aim strip, the toasts, the globe's labels and cards,
the boot, the one-time moon hint and the Live sheet. `features/chrome` holds the live parts, `shell/frame`
the frame that places them (`Shell.tsx`, the routing, the launchers and menus), `shell/wm` the window
manager (see its own README).

## Where things are

| Area | Files |
|---|---|
| The frame | `shell/frame/Shell.tsx` (regions, boot gates, phone or desktop), `routing.ts` (URL, globe inset), `launchers.tsx`, `actions.tsx`, `nav.ts`, `ShellLink.tsx` |
| Desktop | `TopBar.tsx`, `topmenus.tsx`, `menus.tsx`, `Dock.tsx`, `dock.ts`, `Rail.tsx`, `rail.ts`, `StatusBar.tsx`, `Pulse.tsx`, `pulse.ts`, `AimStrip.tsx` |
| Phone | `PhoneHeader.tsx`, `PhoneTabs.tsx`, `phonetabs.ts`, `LiveSheet.tsx`, `LivePanel.tsx`, `phone.ts` (UI state of the Live sheet), the sheet in `shell/wm/PhoneSheet.tsx` and `useSheetDrag.ts` |
| The globe's text | `globe/overlays.tsx` (gates), `overlays/` (labels, tips, moon card, clearance), `cardplace.ts`, `GlobeHome.tsx` (the text twin) |
| Boot | `boot/Boot.tsx` (eager gate and the quick path), `boot/FullBoot.tsx` (the full timeline, lazy), `veil.css` (eager), `boot.css` (lazy) |
| Toasts | `toasthost.tsx` (gate), `Toasts.tsx` (the stack), `toaststack.ts` (pure clocks and reconcile), contract in `app/toasts.ts` |
| Shared pieces | `Beat.tsx` (the beat, the ring, the chip), `live.ts` (one connection summary for every surface), `freshness.ts`, `data.ts`, `glyphs.tsx`, `lazyCard.tsx` |

## Contracts other teams use

- **Toasts.** Anyone calls `toast({ kind, title, body?, to? })` from `app/toasts.ts`; this folder renders it,
  owns the look and the timing, and never imports the caller.
- **The palette.** The top bar's Search, the phone's Search tab and `/` all go through `nav.palette()`, which
  sets `?q=`; F2b's palette reads it. The Apps tab opens the palette like the dock's A until an app window exists.
- **Overlays and the globe's free area.** `overlays/clearance.ts` holds the top and left clearance the globe's
  labels and cards keep (the header's height on a phone is read from `--phone-top`). The globe inset comes from
  `shell/frame/routing.ts` (`insetFor`), which watches every element whose size changes the free area.
- **The Live sheet** is UI state (`usePhone`), not a window and not a route: `WindowType` is closed and
  `shell/windowContent.tsx` switches on it exhaustively.

## `data-fresh`

A block's card and a feed row that arrive after the first fill carry `data-fresh` for 1.8 s, from
`useFresh` in `web/src/motion/fresh.ts` (the motion language's one way to mark arrivals: see "Marking arrivals" in
`web/src/motion/README.md`). The element mounts without the attribute and takes it in a second commit, before the
next paint, because the language reads an attribute that *appears on an element that exists* (a created element that
already has it fires nothing), and because a later re-render (a second store update, a reorg timer) must not end the
moment early. The first fill, a resync and a filter change are not arrivals. A test fails any view that renders
`data-fresh`, or opts a row into Current with `data-fx="current"`, without it.

## Loaded on demand

The first paint carries the gates and the chrome that is on screen; the rest is its own chunk, fetched when
it is first wanted (`lazyCard` preloads on pointer-enter, focus or a quiet moment).

| Chunk | When it loads |
|---|---|
| `FullBoot` and `boot.css` | a boot that plays; the quick path is eager and tiny |
| `Pulse` | desktop, as a chunk of its own (it is not on the first paint's path) |
| `Toasts` | the first toast |
| `Tips`, `PlaceLabels` and `clearance` | the first hover on the globe, or the network arriving |
| `ChromeCards`, the menus' place list and keyboard map | the first hover or open |
| `LiveSheet` | the Live tab is within reach (preloaded after the first paint) |

## Attach points for the motion primitives (`web/src/motion`)

Every surface takes a `ref`, a `className` and a `style` on its root (the rest of the props are spread), writes
its state as `data-*` attributes, and keeps the same element for the life of the thing so a primitive can hold
on to it. Pressable controls carry `data-pressed` while held (`pressHandlers` from the kit). The frame already
says, in its markup, which word each surface speaks and which zones are dense; what still needs the motion
folder in the tree is listed under "Left for the integration pass".

| Surface | Markup | State attributes | The language |
|---|---|---|---|
| Shell | `.shell` | `data-boot` (`running`, `done`), `data-boot-instant`, `data-layout` (`desktop`, `phone`) | none |
| Top bar | `header.topbar[data-region=topbar]` | controls carry `data-pressed` | dense zone (`data-fx-density="dense"`) |
| Dock | `nav.dock[data-region=dock]` > `button.dk` | `data-launcher` (the launcher id; `launcherOf(type)` in `shell/frame/dock.ts` names the one a window opens from, so a window can take its launcher as its source), `data-state` (`idle`, `open`, `focus`, `min`), `data-pressed` | `data-fx="charge"`, no Pulse: the window opening is the answer |
| Block rail | `section.railwrap[data-region=rail]` > `div.rail[data-frozen]` > `ol.rail-track` > `li.blk-item` > `a.blk` | `li.blk-item[data-flip][data-fresh][data-orphan]` while a card is new (1.8 s) or orphaned, `a.blk[data-tier][data-pressed]`; the ghost is `li.blk-item-ghost[data-late]` > `.blk.ghost[data-phase]` | Current: a streak along the rail's top edge for each block that lands (`<Current>` in `div.rail`, keyed to the newest fresh card, off while `data-frozen`) and a lap around the new card (`<Current edge="perimeter" fireOnMount delay={90}>` in the fresh `li.blk-item`, which has the card's 12 px radius) |
| Status bar | `section.statusbar[data-region=statusbar]` | `.sb-fresh[data-state]`, `.sb-led[data-state]`, `.sb-conn[data-tone]` | dense zone; the tip and counters settle through the kit's `AnimatedNumber` |
| Pulse feed | `.pulse[data-mode][data-offline][data-frozen]` > `li.evt[data-flip][data-fresh][data-kind][data-tier]` | `data-fresh` while a row is new, `data-frozen` while the pointer holds the feed | rows settle; only a payment to a watched node (`data-kind="paid_mine"`) carries `data-fx="current"`, and its streak is drawn inside the row, so it goes where the row goes while the row slides in; it starts when the block's own light is gone (`data-fx-delay`, counted from when the block was seen: 1.1 s) |
| Aim strip | `.aimstrip[data-soon][data-late][data-hidden][data-inline]` > `.aimchip[data-tier][data-pending][data-mine]` | static states | none (no loops in chrome) |
| Toasts | `.toasts[data-docked]` > `.toast[data-toast-id][data-kind][data-state][data-leaving]` | `data-state` is `open` or `leaving`; `.toast-main` and `.toast-x` carry `data-pressed` | the stack keeps a leaving toast mounted for `EXIT_MS`, so a Power-on `panel` can take over the exit |
| Phone tabs | `nav.shell-tabs[data-region=tabs]` > `button.shell-tab[data-tab]` + `span.fx-indicator` | `aria-current="page"` on the lit tab, `data-pressed` | no Pulse on a tab; a `<TabIndicator />` is the bar's last child and draws one line on its top edge over the lit tab (it reads `aria-current`) that stretches to the next; the pill behind the lit tab is a state |
| Phone header | `header.phone-header[data-region=topbar]` | `.ph-search[data-pressed]` | none |
| Windows and the sheet | `.wm-layer` > `.wm-window` (see `shell/wm/README.md`) | `data-window-type`, `data-window-id`, `data-focused`, `data-flare`, `data-dragging`, `data-placement` (`docked`, `floating`, `sheet`), `data-snap` (phone: `peek`, `half`, `tall`, `full`), `data-sheet-drag`, `data-sheet-gone` | the title bar is a dense zone; the wrapper (`.wm-window`) is the element Power-on reveals, out of the launcher that stands for its type |
| Globe cards | `.globe-tip[data-kind]` (`node`, `site`, `moon`) | `data-tier`, `data-leaving`, `data-flip-x`, `data-flip-y` | none: the renderer's own |
| Place labels | `.globe-places[data-band]` | none | none |

`.wm-layer` is a sibling of `.shell-stage`, not inside it, so windows paint over the globe's labels (`--z-globe-hud`,
10) and the rail (`--z-rail`, 20) by their own `z-index` (`--z-window`, 40 to 79) and under the top bar
(`--z-topbar`, 90). `.shell-stage`, which carries a page route (a 404, a gallery page), has `z-index: var(--z-window)`
too, so a page is over the labels as well and `.wm-layer`, later in the document, is over the page.

### The motion language here (the integration pass)

- `<MotionRoot>` is mounted around the router in `app/App.tsx`, and it is the one writer of `<html data-motion>`
  (`full`, `reduced` or `off`). `useRootPrefs` (`prefs.ts`) keeps `data-perf` and the `data-motion-off` marker the
  frame's stylesheets still key on, and no longer writes `data-motion`: it used to write `reduced` for Off, which
  made Off read as Reduced to the kit and to every effect.
- Windows and sheets, toasts, the rail and the Pulse's P1 rows speak the language as the table above says; the
  dock, the top bar, the status bar and the title bars are quiet (`data-fx="charge"` on the launchers, dense zones
  elsewhere). A surface that is not in the language's table in `docs/design/motion-language.md` (section 8) does not
  move.
- Rows and cards mark arrivals with `useFresh` only; the rail's streak and lap and the Pulse's streak are the
  language's `<Current>` and `data-fx="current"`.

## No loops

The motion language keeps idle loops out of the chrome, so there are none: the connection dot is the kit's
`LiveDot` with `ping={false}` and no blink (a colour and the words), the Beat ring holds a steady glow in the
last seconds before a block (`data-phase="soon"`), a focused window flares its rim once on arrival instead of
sweeping every 9 s, and the rail's loading cards are still. The `animation-iteration-count: infinite` search
over `features/chrome` and `shell` finds nothing but the boot's spinner.

## What the kit lacked

Built here and listed for consolidation into `web/src/ui`:

- `pressHandlers` and `mergeRefs` are not exported from the kit's barrel; the frame imports them from
  `ui/internal/press` and `ui/internal/refs`.
- A hover-charge hook for custom controls that are not kit buttons (the dock, the top bar, the tabs).
- A bottom sheet (the phone sheet: snap heights, drag by a grabber, FLIP on release), a pill for the Beat mini,
  and a lazy-loaded hover card body (`lazyCard`).
