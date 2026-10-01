# Flux Atlas UI kit

The shared components every Atlas view is built from. One import path, real data in the gallery, and a
small set of rules so a new view looks and behaves like the rest without anyone designing it again.

```tsx
import { ViewHeader, Section, StatGrid, Stat, KeyValue, EntityLink, DataTable } from '../../ui';
```

Open the gallery at `/dev/kit` (lazy route, not part of the shell): every component in every state, fed
by the live server where a real value exists. If a view needs something that is not here, say so before
building a one-off.

## Rules

- **Tokens only.** Every colour, radius, space, shadow and duration comes from `styles/tokens.css`. The
  kit adds no hex or rgb literals. Dark only. Class names are `ui-*`; variants and state travel on
  data attributes, never `is-*` classes.
- **Honest data.** A missing value renders the word **Unknown** (never `0`, `-` or blank); pending is
  never drawn as confirmed; an estimate says it is an estimate; a figure that changes carries the period
  it changed over.
- **Everything is a link.** Nodes, hosts, apps, blocks, transactions, addresses, operators, countries,
  providers and versions render through `EntityLink` and keep the camera, layers and filters in the URL.
- **Data is Plex Mono.** Hashes, ids, endpoints, amounts and times use `IBM Plex Mono` with tabular
  figures. Montserrat is for titles, labels and large numerals; Open Sans for text; Lora at most once
  per view.
- **Calm by default.** One primary action per surface, quiet defaults, nothing decorative that does not
  carry meaning. Progressive disclosure: put the rarely used behind a fold, a menu or a hover card.
- **Plain motion.** The kit uses only fast, simple transitions (colour, opacity, a fold). The Flux
  interaction language (Pulse, Charge, Spark, Current, Power-on, Settle) lives in `web/src/motion` and
  attaches to the hooks below, so components do not invent their own effects.
- **One height ladder.** `Button`, `IconButton`, `SegmentedControl`, `TextField`, `SearchField`, `Select`
  and `Tabs` come in two heights, `sm` (30 px, toolbars, headers, table filters) and `md` (36 px), so any
  mix of them in a row lines up. On touch both are 44 px (`--ui-h-sm`, `--ui-h-md`). Where a control must
  stay small to look right (a toggle chip, a copy glyph, an entity link in text) an invisible hit band
  makes the target bigger without moving the layout.
- **Accessible.** Roles and names, visible focus rings (`--focus-ring`), full keyboard operation,
  AA contrast, and `prefers-reduced-motion`, the in-app motion setting and `<html data-motion>` honoured by
  CSS and by `useMotionMode` alike.
- **Fast.** No component polls; lists over about 200 rows are windowed (`DataTable`); `TimeSeries` loads
  uPlot lazily in its own chunk. The kit declares `"sideEffects": ["**/*.css"]` (see `package.json` in
  this folder), so a view that imports `Button` bundles `Button` and its stylesheet, not the whole kit.

## Attach points for the motion primitives

Every interactive component forwards `ref` (React 19: a plain prop), accepts `className` and `style`,
spreads the remaining attributes onto its root, and reports its state through data attributes. The
Flux motion primitives (`web/src/motion`) attach to these; the kit itself only does fast, plain
transitions.

| Attribute | Where | Meaning |
|---|---|---|
| `data-pressed` | Button, IconButton, CopyButton, toggle Chip, interactive Card, Stat as a button, Tabs and SegmentedControl options, Switch, Slider, Select trigger and options, SearchField clear, Menu rows, BarList link and button rows, TimeSeries legend toggles, Timeline disclosure rows | set while a pointer button or Space/Enter is held; written straight to the DOM, so pressing never re-renders |
| `data-state` | Button `loading`; toggle Chip `on` or `off`; CopyButton `idle`, `copied`, `failed`; Section, TabPanel, Timeline row and floating layers `open` or `closed`; Tab and segment `selected` or `idle`; Switch `on` or `off`; Select trigger `open`, `closed`, `loading`; fields `invalid`; Stat `loading` or `stale`; TimeSeries, BarList, ShareBar, Meter, Sparkline `ready`, `loading`, `empty`, `error` (Meter adds `unknown`, Sparkline `flat`); AnimatedNumber `unknown`, `steady`, `counting`; Freshness `fresh`, `aging`, `stale`, `dead`, `unknown` | the component's state |
| `data-mode` | AnimatedNumber, FlashOnChange, Timeline | the motion mode in force (`full`, `reduced`, `off`) |
| `data-enter`, `data-fresh`, `data-flash` | DataTable (first paint), DataTable rows (just arrived), FlashOnChange (alternates `a` and `b` so a second change restarts) | an arrival or a change is happening |
| `data-tier`, `data-status`, `data-tone` | chips, Stat, ViewHeader, Card, Meter, Timeline | the colour role (remapped by `tokens.css`) |
| `data-size`, `data-variant`, `data-kind` | Button, Chip, fields, Sparkline, BarList rows, DiffBlock lines | the shape or kind |

Use `pressHandlers` from `internal/press.ts` when you build a new pressable component. `useMotionMode()`
returns the effective mode (the root `data-motion` attribute wins, then the stored preference, then the OS
setting); `useAnimate()` is true only in `full`.

## Which component for what

- **A number** → `Stat` (one figure, its unit, its change, a line of context). Several facts about one
  thing → `KeyValue`. A short fact in a sentence or a row → `Chip`. The one big figure of a view → `Stat hero`.
- **A change** → `Delta`, always with the period (`period="24 h"`).
- **A tier or a state** → `TierChip` / `StatusChip` (icon plus word; colour is never the only cue). The
  caps `Badge` only for status words in dense headers.
- **A long id** → `Hash` (middle-truncated, copies whole). An id that is also a place to go → `EntityLink`.
  An IP and port → `Endpoint`. Money → `Amount`. A block height → `Height`. A moment → `RelativeTime`.
- **How fresh a source is** → `Freshness`. How old one value is → `RelativeTime`.
- **Switch between sections of one thing** → `Tabs`. Pick one of a few exclusive options for the current
  view → `SegmentedControl`. Neither is navigation between views; use links for that.
- **A list or table** → `DataTable` (sorting, keyboard, windowing, live rows). Do not hand-roll a list of
  more than a screenful.
- **A short explanation on hover** → `Tooltip` (text only). A preview with links and actions →
  `HoverCard` (mouse and keyboard; never the only way in, touch opens the inspector instead).
- **Loading** → a `Skeleton` with the geometry of the content, never a spinner alone. **Nothing there** →
  `EmptyState`. **It failed** → `ErrorState` (retry only where retrying can help). A query → wrap it in
  `QueryBoundary`, which does all three and keeps stale data on screen, labelled.
- **Group content** → `Section` (a titled, optionally foldable block). A raised surface inside a window →
  `Card`. Do not nest a bordered box inside a bordered box.
- **A trend** → `Sparkline` inside a `Stat`; a real chart → `TimeSeries`. Shares of a whole → `ShareBar`;
  a ranked list with bars → `BarList`; progress or capacity → `Meter`.
- **Ask for a value** → `TextField` for one line, `SearchField` for search, `Select` for one of a list
  (`native` where the OS picker is better, as on phones), `Switch` for on or off that applies at once,
  `Slider` for a number in a range. Every field has a visible `label` (or an `aria-label`); say what is
  wrong in `error`, not in a toast; keep the message line's height with `reserveMessage` where a form
  must not jump.
- **Actions behind a button** → `Menu` (commands, group labels, shortcuts; a kebab `IconButton` for row
  actions). A small form or a panel of detail → `Popover`. Neither replaces a window: anything the user
  keeps looking at becomes a view with its own URL.
- **A history** → `Timeline` (lifecycles, spec versions, event logs; `live` for events that arrive while
  you watch). The change inside one item → `DiffBlock`.

## Components

### Layout (`layout/`)

| Component | Use it for |
|---|---|
| `ViewHeader` | The head of every view: kind label, title (mono for ids), subtitle, actions, freshness slot over a hairline of accent (tier colour on node views). Folds by its own width. |
| `Section` | A titled block with an aside and actions; `collapsible` folds it (content becomes inert); `flush` lets a table run edge to edge. |
| `StatGrid` | Equal-width columns for `Stat` tiles, as many as fit (`min`, default 140 px); a hero tile takes a whole row while the grid is narrow and two columns once it is wide. |
| `Card` | One ink step above the slab with a rim lit at the top left. `glow` adds a faint corner light, `interactive` brightens on hover, `tone="flat"` is a hairline only. |
| `Stack`, `Row` | Token-gap layout glue (`gap` is a `--space-N` step 1 to 10). |

### Readouts (`readout/`)

| Component | Use it for |
|---|---|
| `Stat` | A figure with label, unit, `Delta`, caption and a `spark` slot. The figure scales with the tile. `loading` keeps the geometry; `stale` says No data and why; `onClick` makes it a button; `tier` tints it. |
| `Delta` | A signed change: arrow, sign, colour, in Plex Mono, then the period. A change that rounds to zero is flat. |
| `KeyValue` | Label and value rows (`items` or `KeyValueRow` children). Values can be mono, copyable, links, or any node; missing is Unknown. `align="start"` and `ruled` for wide panes. |

### Chips (`chips/`)

| Component | Use it for |
|---|---|
| `Chip` | A short fact (22 px pill; `sm`/`md`/`lg`; `tone` neutral, accent, ghost). Give it `onClick` and it becomes a filter toggle with `aria-pressed`. |
| `TierChip`, `TierGlyph` | Cumulus, Nimbus, Stratus: the three-capsule glyph in the tier colour plus the word. `amount` rides after the word; `mine` rings the operator's own node. |
| `StatusChip` | Fifteen states over five reserved roles, each an icon and a word (`confirmed`, `pending`, `started`, `syncing`, `live`, `at-risk`, `degraded`, `stale`, `dos`, `offline`, `expired`, `error`, `unreachable`, `departed`, `unknown`). |
| `Badge` | The one ALL CAPS style, for status words in dense headers. |

### Identity (`identity/`)

| Component | Use it for |
|---|---|
| `EntityLink` | Any noun as a link: `node`, `host`, `app`, `block`, `tx`, `address`, `operator`, `country`, `provider`, `version`. Optional icon, copy button and `preview` (hover card). Missing value renders Unknown, not a dead link. |
| `Hash` | A long id middle-truncated in Plex Mono; the full value is in the title and in the DOM, so a drag-select or the copy button gives all of it. |
| `Amount` | FLUX with the right precision (2 decimals, or 8 with `exact` and dimmed trailing zeros), a dim unit, optional `+` and signed tint. |
| `Height` | A block height with grouped digits, linked to the block. |
| `RelativeTime` | "12 s ago" on the shared 1 Hz clock; full UTC time in the title. |
| `Endpoint` | `ip:port` (IPv6 bracketed), linked to the node or host; `hideDefaultPort`, `copy`. |
| `Unknown` | The one rendering of "no value". |

### Controls and overlays (`controls/`, `overlay/`)

| Component | Use it for |
|---|---|
| `Button` | `primary` (chamfered, one per view), `secondary`, `ghost`, `danger` (destructive only); `icon`, `loading`, `pill`, `sm` (30 px) or `md` (36 px). |
| `IconButton` | An icon-only button; `label` is the required accessible name and the title. |
| `CopyButton` | Copies the exact value and confirms with a check and a polite announcement. |
| `Kbd`, `KbdCombo` | Key caps for shortcuts, wherever a shortcut is offered. |
| `Tooltip` | A one-line label after 120 ms of mouse hover or on keyboard focus. Escape closes only the tooltip. |
| `HoverCard` | A glass card after 180 ms of mouse hover or on focus, with links and actions; stays open while the pointer is on it. |

### States (`states/`)

| Component | Use it for |
|---|---|
| `Skeleton`, `SkeletonText` | Placeholder shapes with the geometry of the content. |
| `EmptyState` | An icon, one sentence, one action. `pattern` draws the hexagon lattice on full-pane states only. |
| `ErrorState` | `describeError` picks copy, tone and icon from the error; Retry only when retrying can help. |
| `QueryBoundary` | Wrap a TanStack query: skeleton, error with retry, empty, data; a failed refresh keeps the last data and says how old it is. |

### Live atoms (`live/`)

| Component | Use it for |
|---|---|
| `LiveDot` | The status dot (healthy connection, an active source). |
| `Freshness` | How old a source is against its own cadence: fresh, aging, stale, lost; a chip or an inline sentence. |
| `AnimatedNumber` | A live count that rolls only the digits that changed; width never moves. |
| `FlashOnChange` | A breath of light behind a value or a row when it changes. |

### Navigation (`nav/`)

| Component | Use it for |
|---|---|
| `Tabs`, `TabPanel` | Sections of one thing; controlled, arrow keys, optional icons and count badges, overflow scrolls under an edge fade. |
| `SegmentedControl` | One of a few exclusive options for the current view; the pill glides on a transform. |

### Tables (`table/`)

| Component | Use it for |
|---|---|
| `DataTable` | The one table: typed columns, sort, sticky header and first column, one tab stop with a roving active row, `rowLink`, loading and empty states, windowing above 200 rows, live-row highlight via `useFreshKeys`. |

### Forms (`forms/`)

| Component | Use it for |
|---|---|
| `TextField` | A single-line input: label, hint or error line, leading icon, prefix, suffix, key caps, trailing slot; `mono` for hashes, addresses and amounts; `size="sm"` for toolbars. Controlled or uncontrolled like a native input. |
| `SearchField` | A `role="search"` box with a clear button, Escape to clear, Enter to submit and `onDebouncedChange` for typing pauses (debounce input here; let a query, not a timer, fetch). |
| `Select` | One choice from a list: a field-style trigger and a glass listbox with arrow keys, typeahead, icons and descriptions; `native` renders a styled native select. Generic over the option value. |
| `Switch` | On or off that applies immediately (a native checkbox with `role="switch"`); `layout="row"` for a settings row with a description. |
| `Slider` | A number in a range: native range input, filled track, mono readout (`valueText` formats it), optional marks. |

### Popover and Menu (`popover/`)

| Component | Use it for |
|---|---|
| `Popover` | A small anchored panel (a filter set, detail with actions): glass, non-modal, a named `dialog`; focus moves in and returns on close; flips and clamps to the viewport. `trigger` is an element or a function that spreads the props it is given. |
| `Menu` | A menu button's menu: actions with icons and key caps, labels, separators, checkable and danger items; arrow keys, Home, End, typeahead, Enter or Space, Escape. |

### Timeline (`timeline/`)

| Component | Use it for |
|---|---|
| `Timeline` | A vertical thread of events with a time gutter (relative on the shared clock, or absolute UTC). Items with `children` expand; runs group ("Renewed 9 times"); `live` grows in items that arrive while you watch. |
| `DiffBlock` | A small diff for spec changes: added and removed lines with a sign as well as a colour; Plex Mono. |

### Charts (`charts/`)

| Component | Use it for |
|---|---|
| `Sparkline` | A trend glyph (line, area, bars) with an end dot; real gaps stay gaps; an empty series is a dashed baseline, never a zero. |
| `TimeSeries` | A real time chart over UTC: lines or area, crosshair with a glass tooltip, legend for several series, arrow-key reading, a "Show data" table, honest loading, empty and error states. uPlot loads in its own chunk; callers need no Suspense. |
| `BarList` | Ranked horizontal bars (top countries, providers, versions); rows are links, buttons or plain; `limit` adds "Show all". Rank the rows before passing them. |
| `ShareBar` | Parts of a whole in one stacked bar with a legend of amount and share; the bar is one labelled image that spells every share out. |
| `Meter` | One reading in a range (emission progress, capacity); `zones` turns it into a gauge with named bands; unknown is a dashed track and the word Unknown. |

## Utilities for views

Exported from the same entry for views that build their own surfaces on the same foundations:
`useEntityLinkProps(kind, value)` (the props for an `<a>` that opens an entity and keeps the camera, layers
and filters in the URL; `EntityLink` and `BarList` use it), `Portal`, `useDismiss`, `useFloatingPosition`
(places a layer against an anchor, flips and clamps, and hides it while the anchor is scrolled out of
view), `computePosition`, `navigateIndex` and `typeaheadIndex` (roving focus and typeahead math), `cx`,
`clamp`, `tierLabel`, `useMotionMode`, `useAnimate`.

## Custom properties the kit adds

Declared in `base.css` (derived from `tokens.css`): `--ui-rim` and `--ui-rim-hot` (the lit rim gradient),
`--ui-lit` (the lit top edge), `--ui-contact` (contact shadow), `--ui-h-sm` and `--ui-h-md` (the control
height ladder). Set on a component root, by the component or by you to override it:

| Area | Properties |
|---|---|
| Layout | `--ui-gap` (Stack, Row), `--ui-stat-min`, `--ui-stat-cols` (StatGrid), `--ui-kv-label` (KeyValue), `--ui-card-glow` (Card), `--ui-section-px` (Section) |
| Readouts | `--ui-stat-glow` (Stat), `--ui-number-weight` (AnimatedNumber's digits), `--ui-chip-h`, `--ui-chip-px` (Chip) |
| Forms and nav | `--ui-field-h`, `--ui-select-row`, `--ui-slider-thumb`, `--ui-slider-fill`, `--ui-switch-w`, `--ui-switch-knob`, `--ui-switch-pad`, `--ui-seg-h`, `--ui-seg-pad`, `--ui-seg-gap`, `--ui-tabs-h`, `--ui-tabs-accent`, `--ui-tabs-fade` |
| Layers | `--ui-layer-dx`, `--ui-layer-dy`, `--ui-layer-max-h`, `--ui-anchor-w` |
| Charts | `--ui-spark-color`, `--ui-spark-surface`, `--ui-ts-surface`, `--ui-bl-label`, `--ui-sb-h`, `--ui-meter-h`, `--ui-meter-surface` |
| Live | `--ui-flash` (the light colour), `--ui-tint`, `--ui-fresh-color`, `--ui-fresh-dot`, `--ui-tl-gutter`, `--ui-tl-line`, `--ui-tone` (a Timeline marker's colour), `--ui-diff-hue` |
| Tables | `--ui-table-bg`, `--ui-table-zebra`, `--ui-table-hover`, `--ui-table-head-h`, `--ui-table-min`, `--ui-table-row-h`, `--ui-row-bg` |

Values the component computes per instance (`--ui-meter-frac`, `--ui-bl-frac`, `--ui-seg-i` and similar) are
internal.

## Not in the kit (ask before building a one-off)

No modal dialog (Atlas uses windows and the inspector), no toast (`shell/` owns it), no date picker, no
multi-select, option groups or type-to-filter in `Select`, no submenus or radio items in `Menu`, no arrow
or hover-intent on `Popover`. `TimeSeries` has no zoom, brush, annotations or second axis. `Timeline` is
meant for histories of about 50 rows (no windowing). `ShareBar` segments are not links.

## Gallery

`npm run dev`, then open `/dev/kit`. Sections: foundations, layout, readouts, chips, identity, controls,
states, tabs, tables, charts, live atoms, forms, overlays. Specimens marked synthetic say so; everything
else is drawn from the live server or the live store. Add a specimen for every new state you introduce.

## Testing

Logic lives in plain modules with vitest tests next to them (`position`, `keys`, `time`, `hashParts`,
`entityLabel`, `delta`, `describeError`, `statusMeta`, `press`, `odometer`, `freshness`, `scale`, ...).
Components have jsdom tests through `internal/testing.tsx` (`mount`, `click`, `press`); there is no
testing-library dependency. `npx vitest run src/ui` runs the kit's tests in about two seconds.
