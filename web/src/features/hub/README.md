# The hubs (`features/hub`, `features/explorer/landing`)

The three landings of the app share one frame: the **Explorer** (`/explorer`, the chain), **Nodes** (`/nodes`, the
network node by node) and **Apps** (`/apps`, the app network). Each is a window like any other (`explorer`, `nodes`,
`apps` in `shell/wm/specs.ts`, wide and maximizable), opened by its dock launcher, its palette entry or a link, and the
block, node, app and address views open from it. This folder holds the frame; each landing keeps its own sections next
to the data they read.

| Where | What it holds |
|---|---|
| `Hub.tsx` | `Hub` (the container-query root), `HubStack` (the rows under the view header), `HubGrid` (six columns of panels) |
| `HubHero.tsx` | `HubHero` (the chamfered slab with the one big figure, a graphic and the figures under a hairline), `HubFigures`, `HubFigure`, `balancedColumns` |
| `HubPanel.tsx` | `HubPanel`: a card with a heading row, a body, a footer, and its own loading, error and empty state |
| `Leaderboard.tsx` | `Leaderboard` (ranked rows that are real links, figures in aligned columns, folds to two lines), `LbBar` |
| `HubLink.tsx` | `HubLink` ("Open the rich list"), `HubTiles` and `HubTile` (go-to tiles, laid out by `columns.ts`), `HubButton` (a link that wears the kit button) |
| `columns.ts` | `balancedColumns` (the columns that leave no hole in the last row) and `rowPlan` (a grid fine enough for rows of different counts to each fill the width) |
| `HubNav.tsx` | the small nav the explorer views wear in their headers |
| `HubSearch.tsx` | search in place: the palette's own resolver drawn inside the hub |
| `useAnchor.ts` | `useHashAnchor`: scrolls to `#operators` once the section has rendered |
| `api.ts` | the queries only the hubs read (`/network/operators`, `/network/nodes-overview`, `/network/apps-overview`) and their shared retry rule |
| `hub.css` | every hub class, prefixed `hub-`; the landings add their own prefixed files (`ex-` for the Explorer) |
| `../explorer/landing/` | the Explorer landing: `ExplorerView.tsx` composes the sections; `lib/` holds their pure parts |
| `nodes/` | the Nodes landing: `NodesView.tsx` composes the hero (`NodesHero`: the tier hexagons and `HealthStrip`), `NodeTiles` and the panels (`OperatorsPanel`, the top operators leaderboard at `#operators`; `ActivityPanel`, `QueuePanel`, `DistributionPanels`, `DecentralizationPanel`, `AgePanel`, `BenchmarksPanel`, `NewestPanel`); `Redact.tsx` draws a panel's loading state as its real markup with made-up rows; `lib/` holds the pure parts |
| `apps/` | the Apps landing: `AppsView.tsx` composes `AppsSearch`, `AppsHero` (with the `CapacityRails`), `AppsTiles` and the panels (`TopAppsPanel` with the `AppsMap` treemap, `OwnersPanel`, `CountriesPanel`, `DeploymentsPanel`, `EconomyPanel`, `AppLists`: new and expiring); `ghost.tsx` draws a loading state as made-up figures in loading-gray blocks; `api.ts` holds the one query only this hub reads (`/network/app-economy`); `lib/` holds the pure parts |

## Contracts

**A hub is a window, so it folds by its window.** Every breakpoint is a container query on the window's own width
(`container: hub`, `hubpanel`, `lb`, and the hero as an unnamed container), never a viewport query: six columns of panels
when wide, two when medium, one on a phone, and the same sections in a maximized window or a phone's sheet. The phone
layout is decided by the window manager (`PHONE_MAX_W`), not by the hub.

**Every section owns its states.** A `HubPanel` takes `state` (`ready`, `loading`, `error`, `empty`) and draws the
loading skeleton in the geometry of its content, an error with a Retry, or an empty state that says what is missing.
One endpoint being down never blanks the page: the heading stays and the others carry on. A section that has nothing
to say when empty (the rich list card with no ranking) returns nothing instead.

**503 means "wait", not "broken".** The hub endpoints answer `503` with `Retry-After: 5` until the server knows the
chain tip. `retryWhileFilling` (`api.ts`) keeps asking for about a minute, and `isFilling(error)` lets a panel say the
numbers are being read. Any other failure retries a few times and then shows the error.

**Unknown is never zero.** A figure the server did not send renders as `Unknown` (`HubFigure value={null}`), an
estimate says it is one ("in about 3 days", "at least"), and a series with a partial last day draws it dashed and says so.

**Every chart has words.** A chart carries a text summary or a data table (the activity chart's "Show data", the tape's
reading and its screen-reader summary), is reachable by keyboard (the tape is one tab stop with arrow keys, the chart
is a slider), and never relies on colour alone: the tier and status colours are reserved for tiers and statuses.

**Motion is the motion language.** An arrival is marked with `useFresh` from `web/src/motion` (a test fails any file that
renders `data-fresh` without it); counters use `AnimatedNumber`; everything else is transform and opacity, and Reduced
and Off draw the same state without travel (`:root[data-motion=...]`).

**Rows are balanced.** `HubFigures` and `HubTiles` count their children and choose the columns that leave no hole in
the last row (five across, or three and two, never four and one). The tiles' rows share one grid fine enough that each
fills the width, so three over two is two halves under three thirds; on a phone an odd last tile takes the whole row,
or the first one does when it is the tile the reader came for (`emphasis`).

**Loading holds the size of loaded.** A section's loading state is as tall as what replaces it, at every width, so
nothing under it moves when its answer lands: the panels draw their real markup with made-up rows as loading-gray
blocks (`nodes/Redact.tsx`, and the same idea as `apps/ghost.tsx`; one piece could serve both), or reserve the
height. The e2e layout test loads each landing against the demo server and fails on a layout shift inside the hub.

**Search in place reuses the palette.** `HubSearch` runs `useSearchModel` and draws the same `RowView`s, limited to the
groups the hub is about; a row opens its subject alongside the hub (`runRow`), so closing it leaves the hub where it was.

**Links are links.** Anything that goes somewhere is a `ShellLink` underneath (middle click and copy address work) and
opens its subject as a window beside the hub.

## Adding a section

1. Put its data hook next to it and its pure shaping in `lib/` with a test; the hook returns the query, the view
   decides the state.
2. Draw it in a `HubPanel` with a `skeleton` that matches the final geometry, an `emptyTitle` that says what is
   missing, and a Retry through `onRetry`.
3. Give it a heading, a text equivalent for anything drawn, and a footer link that goes deeper (`HubLink`).
4. Look at it in a wide, a medium (about 900 px) and a phone window, with motion Full, Reduced and Off, and with its
   endpoint down, filling (503) and empty. The demo server (`cargo run -p atlas-server --example demo_server`) serves
   every hub endpoint with fixture data; the e2e route test loads each hub against it.
