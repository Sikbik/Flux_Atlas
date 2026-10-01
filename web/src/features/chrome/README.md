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
| Boot | `boot/Boot.tsx` (eager gate and the quick path), `boot/FullBoot.tsx` (the full timeline, lazy), `boot/BootFail.tsx` (the offline state both paths show), `boot/model.ts` (the pure parts: stall detection, the settle flight, the quick path's steps), `veil.css` (eager), `boot.css` (lazy) |
| Toasts | `toasthost.tsx` (gate), `Toasts.tsx` (the stack), `toaststack.ts` (pure clocks and reconcile), contract in `app/toasts.ts` |
| Shared pieces | `Beat.tsx` (the beat, the ring, the chip), `archive.ts` (the time machine's moment and "t minus"), `live.ts` (one connection summary for every surface), `freshness.ts`, `data.ts`, `glyphs.tsx`, `lazyCard.tsx` |

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
- **The archive's moment** (`archive.ts`). While the time machine shows a recorded moment, its view
  (`features/timemachine/hooks/useTimeMachine.ts`, through `publishArchive` and `lib/moment.ts`) writes
  `data-archive-at` (the playhead, unix ms) to `<html>` beside `data-archive`, with `data-archive-tip` and
  `data-archive-nodes` (the readings the recording holds for it; absent while unknown), at most every 33 ms,
  and removes them when it leaves. The Beat, the status bar and the Live sheet read them (`useArchive(select)`,
  re-rendering only when the value they asked for changes) and switch to the archived moment, with no import of
  the feature. The Beat becomes a "t minus" readout (a still, dashed ring with a clock face, `T-4 d 11 h`, and
  `block 2,998,071`; it is not a link, because leaving for a block would end the archive view), the light along
  the top bar's edge rests, the status bar's tip chip carries the archived tip and `T-...` in the archive's cool
  grey with no block timer, and the node count is the archived one (the tier split and its card step aside).
  A reading the recording does not hold is "block unknown" or "Unknown nodes", never zero. Removing the
  attributes ("Return to live") puts everything back and the Beat rings once.

## `data-fresh`

A block's card and a feed row that arrive after the first fill carry `data-fresh` for 1.8 s (`fresh.ts`:
`useFreshKeys`). The element mounts without it and takes it in a second commit, before the next paint, because
the motion language reads an attribute that *appears on an element that exists* (a created element that already
has it fires nothing), and because a later re-render (a second store update, a reorg timer) must not end the
moment early. The first fill, a resync and a filter change are not arrivals.

## When Atlas does not answer

The veil covers each view's own loading state, so it must not outlast the data it waits for in silence. Both boot
paths ask the same pure question (`detectFailure` in `boot/model.ts`: 3 s of refused or retrying connections, or 10 s
without a snapshot, or a snapshot with no stream) and show the same panel (`boot/BootFail.tsx`): what is wrong
("Atlas did not answer", or "The live stream did not open" when there is a snapshot to go on with), what the
connection is doing right now ("Reconnecting in 3 s", from `useLiveView`), **Retry** (the live client reconnects
now and the stall clock restarts; the veil lifts by itself the moment the data is in) and **Continue without data**
(or "with the last snapshot"), which shows the shell with its own empty and offline states. It is announced as an
alert. The quick path (`quickStep`) has nothing else on screen and centres it; the full boot places it by the log
(`boot.css`). With the data in and only the globe slow, the quick path lifts after 6 s (`QUICK_GIVE_UP_MS`).

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
| Block rail | `section.railwrap[data-region=rail]` > `div.rail[data-frozen]` > `ol.rail-track` > `li.blk-item` > `a.blk` | `li.blk-item[data-flip][data-fresh][data-orphan]` while a card is new (1.8 s) or orphaned, `a.blk[data-tier][data-pressed]`; the ghost is `li.blk-item-ghost[data-late]` > `.blk.ghost[data-phase]` | the rail and each card are positioned hosts for a `<Current>`; `data-frozen` is the "disabled" signal (scrolled into history) |
| Status bar | `section.statusbar[data-region=statusbar]` | `.sb-fresh[data-state]`, `.sb-led[data-state]`, `.sb-conn[data-tone]` | dense zone; the tip and counters settle through the kit's `AnimatedNumber` |
| Pulse feed | `.pulse[data-mode][data-offline][data-frozen]` > `li.evt[data-flip][data-fresh][data-kind][data-tier]` | `data-fresh` while a row is new, `data-frozen` while the pointer holds the feed | rows settle; only a payment to a watched node (`data-kind="paid_mine"`) carries `data-fx="current"` |
| Aim strip | `.aimstrip[data-soon][data-late][data-hidden][data-inline]` > `.aimchip[data-tier][data-pending][data-mine]` | static states | none (no loops in chrome) |
| Toasts | `.toasts[data-docked]` > `.toast[data-toast-id][data-kind][data-state][data-leaving]` | `data-state` is `open` or `leaving`; `.toast-main` and `.toast-x` carry `data-pressed` | the stack keeps a leaving toast mounted for `EXIT_MS`, so a Power-on `panel` can take over the exit |
| Phone tabs | `nav.shell-tabs[data-region=tabs]` > `button.shell-tab[data-tab]` | `aria-current="page"` on the lit tab, `data-pressed` | no Pulse on a tab; `aria-current` is what a `<TabIndicator />` reads |
| Phone header | `header.phone-header[data-region=topbar]` | `.ph-search[data-pressed]` | none |
| Windows and the sheet | `.wm-layer` > `.wm-window` (see `shell/wm/README.md`) | `data-window-type`, `data-window-id`, `data-focused`, `data-dragging`, `data-placement` (`docked`, `floating`, `sheet`), `data-snap` (phone: `peek`, `half`, `tall`, `full`), `data-sheet-drag`, `data-sheet-gone` | the title bar is a dense zone; the wrapper (`.wm-window`) is the element a Power-on would reveal |
| Globe cards | `.globe-tip[data-kind]` (`node`, `site`, `moon`) | `data-tier`, `data-leaving`, `data-flip-x`, `data-flip-y` | none: the renderer's own |
| Place labels | `.globe-places[data-band]` | none | none |

`.wm-layer` is a sibling of `.shell-stage`, not inside it, so windows paint over the globe's labels (`--z-globe-hud`,
10) and the rail (`--z-rail`, 20) by their own `z-index` (`--z-window`, 40 to 79) and under the top bar
(`--z-topbar`, 90). `.shell-stage`, which carries a page route (a 404, a gallery page), has `z-index: var(--z-window)`
too, so a page is over the labels as well and `.wm-layer`, later in the document, is over the page.

### Left for the integration pass (needs `web/src/motion` merged)

- Mount `<MotionRoot>` around the router in `app/App.tsx` (shared file).
- Rail: a `<Current signal={tip} edge="top" disabled={frozen} />` in `div.rail` and a `<Current edge="perimeter"
  fireOnMount />` in each `li.blk-item[data-fresh]` (both hosts are `position: relative` already).
- Toasts: wrap `.toast` in `<PowerOn variant="panel" open onExited>`; the stack's own exit timer and the FLIP
  (`[data-toast-id]`, transform only) can stay, or be dropped when `onExited` takes over.
- Windows: `<PowerOn origin={...}>` around `.wm-window`, with the origin the dock button
  `[data-launcher="<launcherOf(type)>"]`; the exit ghost in `shell/wm/ghost.ts` is what it replaces. The window is
  ready for it (no filter, clip or mask on the wrapper; see "Ready for the motion language's Power-on" in
  `shell/wm/README.md`).
- Phone tabs: `<TabIndicator />` as the last child of `nav.shell-tabs` (a positioned host) in place of the lit pill.

## No loops

The motion language keeps idle loops out of the chrome, so there are none: the connection dot is the kit's
`LiveDot` with `ping={false}` and no blink (a colour and the words), the Beat ring holds a steady glow in the
last seconds before a block (`data-phase="soon"`), a focused window flares its rim once on arrival instead of
sweeping every 9 s, and the rail's loading cards are still. The `animation-iteration-count: infinite` search
over `features/chrome` and `shell` finds nothing but the boot's spinner.

## The block timer in each motion mode

The Beat's ring, the top bar's light, the status bar's fill and the rail's next-block fill are 30 s CSS
animations started at the right offset (`--since`, set once per block; see `useBlockSince`). Full runs them
linear. Reduced runs them in one-second steps (`steps(30)`), as the design says. Off runs no animation at all
(`getAnimations()` finds none of them): the component writes the whole seconds into the interval (`--sec`) with
each tick, and the stylesheet draws the same state from it, 12 degrees of ring a second and a thirtieth of the
fill or the bar. The state moves once a second with no tween.

## What the kit lacked

Built here and listed for consolidation into `web/src/ui`:

- `pressHandlers` and `mergeRefs` are not exported from the kit's barrel; the frame imports them from
  `ui/internal/press` and `ui/internal/refs`.
- A hover-charge hook for custom controls that are not kit buttons (the dock, the top bar, the tabs).
- A bottom sheet (the phone sheet: snap heights, drag by a grabber, FLIP on release), a pill for the Beat mini,
  and a lazy-loaded hover card body (`lazyCard`).
