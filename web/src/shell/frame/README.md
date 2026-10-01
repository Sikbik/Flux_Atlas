# The shell frame (`web/src/shell/frame`)

The structural regions over the persistent globe (design 2.1, 3.1, 3.6): the top bar and dock (desktop), the
header and tab bar (phone), the stage with its page slot, the rail and status bar, and the window layer, toasts,
palette and boot around them. The window manager (`shell/wm`) owns window geometry; the frame measures the
workspace, hands it over, binds windows to the URL, keeps the globe centred in the free area and draws the tethers.

| File | What it holds |
|---|---|
| `Shell.tsx`, `frame.css` | the regions, the page slot, the boot's chrome assembly and the states below |
| `TopBar.tsx`, `topmenus.tsx`, `menus.tsx`, `topbar.css`, `menus.css` | the desktop top bar; the three menus are a chunk of their own, fetched when the pointer nears a trigger |
| `Dock.tsx`, `dock.ts`, `dock.css` | the dock; `dock.ts` is what each launcher shows (pure), `dock.css` sizes the launchers to the screen (`--dk-size`) |
| `PhoneHeader.tsx`, `phoneheader.css`, `moonpark.ts` | the phone header, and the moon's parking in its Beat ring |
| `PhoneTabs.tsx`, `phonetabs.ts`, `phonetabs.css` | the tab bar and which tab is lit (pure) |
| `LiveSheet.tsx`, `livegate.tsx` | the Live tab's sheet, its gate and its chunk |
| `launchers.tsx`, `keys.ts`, `actions.tsx`, `nav.ts` | the one list behind the dock, menus, tabs and keys; the keyboard map; the shared actions; navigation by URL |
| `routing.ts` | the URL to window manager binding, and the globe's inset (`insetFor`, `useGlobeInsetSync`) |
| `ShellLink.tsx` | a link that opens its subject as a window and still works as a link |
| `skip.ts` | where "Skip to content" goes (pure): the open window's body, else the page panel, else the stage |

## Contracts

**The page slot.** Routes without a window (`/dev/live`, `/q/...`, not found) and the strip and layer types
(time machine, weather) render in `main.shell-stage > .shell-page`. A route that draws a panel in the stage's left
column (`isPagePanel` in `nav.ts`) sets `data-page` on `.shell`, and `frame.css` steps the Pulse and the aim strip
aside for it; on a phone the page takes the stage and nothing needs to move. On a desktop the panel also gives the
globe its side (see the inset below).

**The archive view.** While the time machine shows the past it sets `data-archive="on"` on `<html>`. The live
chrome steps back on that attribute alone, in CSS (`frame.css`): the Pulse folds to its head with "Paused in the
archive view", the rail's blocks fade out under a label, and what is paused leaves the key and the reading order
(`visibility`), while the veil still takes the pointer so nothing falls through to the globe.

**The palette.** It is open while the URL carries `?q=`, even empty. The launchers that need a subject open it on
a kind's prefix (`PALETTE_SEED` in `launchers.tsx`: `node `, `app `), and a prefix is only a prefix with its trailing
space, which is why the `q` validator (`text` in `app/search.ts`) keeps the end of what it is given. The Operator
launcher needs no subject: it opens the watchlist (`/operator/watchlist`, `WATCHLIST` in `launchers.tsx`), or raises
an operator window that is already open.

**Skip to content.** The first stop of the tab order, hidden above the screen until it has focus (`.skip-link`,
`frame.css`). It does not follow its fragment: it moves focus to what is open (`focusContent`, `skip.ts`), the
focused window's body (past its title bar's controls), else the topmost window's, else the page panel, else the
globe's stage, and the next Tab lands on that thing's first control. On a phone the one window shown is the sheet.
The targets take focus with `tabindex="-1"`, so the arrow keys scroll them and they stay out of the tab order.

**The globe's inset.** `globeInset` (`wm/machine.ts`) gives the workspace edges plus the windows: docked windows
always reserve their side, a maximized window reserves nothing, and a floating window reserves its side only
while the free area left after it is still as wide as the planet's minimum (`planetMinWidth`); past that it floats
over the globe. A page panel (search results, a dev page, not found) is one more left-floating obstruction under
the same rule: `usePageEdge` (`routing.ts`) writes the panel's right edge to the shell as `--page-edge` (an edge
that moves by under 16 px is not chased, since a panel that sizes to its content, like the live inspector, would
otherwise drag the globe with it), and `globeInset(state, pageEdge)` counts it like a window, edge + 24 px, while
the planet still fits beside it. `insetFor` (`routing.ts`) adds what the window manager does not know on a phone:
the Live sheet, the time machine's sheet (`--tm-sheet-h`, written on the shell) and the bottom safe area.

**The moon on a phone.** While a window or the Live sheet is as tall as the tall snap or taller, `moonParked`
(`moonpark.ts`) is true: the moon glides into the Beat ring in the header as a 22 px symbol
(`GlobeTarget.setMoonPark`), the header opens a window in its scrim round the ring (`data-parked`, `--moon-x`,
`--moon-y`, `--park-k`), the ring's core dot gives way, and a 44 px door over the ring is the moon's tap target
and its one keyboard control (the proxy steps aside, except at the full snap, where the header is covered and
inert). It goes by the sheet's height, so a short phone that folds tall into half parks at half.

**The boot.** While `data-boot="running"` every region is hidden; when it ends they assemble from the edges (top
bar 0 ms, dock 160, rail and status bar 260, Pulse, aim strip and windows 520; 700 to 760 ms each), the boot's own
fade and the globe's settle (1,500 ms) running with them.

## Rules

Regions that are chunks of their own (the Pulse, the menus, the Live sheet) load after the first paint, and the
boot keeps every region hidden until it ends, so none of them arrives into a visible screen. Motion is transform,
opacity and two registered custom properties (`--timeline-h`, `--park-k`); every transition has its reduced-motion
rule. The frame draws no guide on the globe: the planet and the moon are the only things in the canvas.
