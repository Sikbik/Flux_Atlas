# Flux Atlas v2 — Feature Spec

> Owner: tech lead. This document says **what** each feature does, what data it uses, and when it's done.
> **How** it looks and moves is defined by `docs/design/design-direction.md`, which wins on presentation.
> Data contracts live in `docs/ARCHITECTURE.md`. Clean-room rule and no-emoji rule apply everywhere.

## 0. Product principles

1. **Live-first.** Every number, list and point on the globe updates as the network changes. Every animation
   corresponds to a real event (ARCHITECTURE sections 3.2 and 8); there is no decorative noise. Freshness is always
   visible ("seen 0.8 s after it was produced", "stats round 6 min ago").
2. **The globe is home.** It's always there, always live. Everything else opens over it and can fly the camera to
   what it's about.
3. **Everything is a link.** Every node, app, block, tx, address, country, provider and version is clickable and
   deep-linkable. Search understands all of them.
4. **Honest data.** Pending is never shown as confirmed. Unknown is never shown as zero. Estimates are labelled.
   Upstream quirks are handled (see ARCHITECTURE parsing quirks).
5. **Pro-grade speed.** Instant interactions (< 100 ms response to input), 60 fps globe, keyboard-first power
   paths (palette, terminal, shortcuts), works on phones.

## 1. The living globe

- **Nodes.** All ~6.7k nodes by geolocation, colored by tier. Co-located nodes stack (datacenter towers at global
  zoom) and fan out into individual nodes up close. Unlocated nodes (empty IP, unresolved geo) are listed in a
  "no location" tray, never placed at (0,0).
- **Layers (toggleable, persisted):** Nodes; Payments (live); Block producers (live); Mesh (P2P topology);
  Apps (instances); Density heat; Day/night terminator; Country borders + labels; Network weather (unreachable,
  benchmark failures, DOS, at-risk).
- **Filters (URL-synced):** tier, country, continent, provider/ASN, FluxOS/fluxd version, ArcaneOS, has apps,
  hosting vs residential, UPnP multi-node hosts, watched, operator (address/ZelID), payment-queue position.
- **Live events on the globe:**
  - Block: producer flare, payout beams to the three payees, heartbeat ripple (confirm txs) staged over 2–4 s,
    node starts ignite, collateral spends extinguish.
  - Next payees: pre-aimed glow on the three known next payees during the ~30 s wait.
  - Apps: pending deploy (ghost markers where it may land) → confirmed → installing → instance spawn/removal.
  - Mesh deltas: links fade in and out as the topology sweep streams.
  - Node lifecycle: at-risk nodes (≥ 560 blocks since last confirm) dim-pulse; expired nodes fade out.
- **Interaction:** hover tooltip (IP:port, tier, city, provider, queue position); click selects → camera fly-to →
  Node inspector. Box/lasso select → group summary (count, tiers, capacity, providers). Double-click a stack →
  fan-out. Keyboard: arrows orbit, +/- zoom, `f` focus selection, `esc` clear.

**Done when:** 60 fps at 1440p with the full network and live events; picking is accurate at every zoom;
co-located stacks are legible; every event type animates correctly from a recorded live stream.

## 2. Live systems (always-on chrome)

- **Status bar:** tip height (ticks on each block), time since last block, next-block progress (30 s cadence),
  live connection state + event latency, node count by tier, price (optional), UTC clock, freshness of each ingest
  path (hover for details).
- **Block rail:** the latest blocks sliding in live. Each card shows height, age, tx mix (confirms / starts /
  transfers / app payments), producer (tier + location), and the three payees. Click opens the Block view.
- **Activity feed:** human-readable live events (node joined/expired, app deployed/updated/pending,
  large transfer, version rollout milestones, reward cut approaching). Bursts collapse to "+N". Filterable.
  Every item links to its subject.
- **Next payout ticker:** "Next Stratus payout: Helsinki, 9 FLUX, in ~12 s" per tier.
- **Reward-cut countdown:** blocks and time to height 3,071,200 (and every later cut), with the tier amounts before
  and after.

**Done when:** a new block updates the tip, rail, feed, payees and countdown within ≤ 3 s of production (≤ 1.5 s
typical), with no layout jank.

## 3. Node inspector

**Landing (`/nodes`, what the Nodes launcher opens):** the network node by node in one window, maximizable and phone
friendly. Search in place for a node, a host or a provider (the palette's resolver). A hero with the confirmed count,
one hexagon for each percent of the nodes cut by tier, and the health of the network (healthy, at risk, unreachable)
over a row of figures (hosts, countries, providers, nodes waiting to confirm, nodes on the DoS list). Then the **top
node operators** leaderboard (also at `/nodes#operators`), ranked by ZelID or by payment address: nodes and share,
the tier mix, countries and providers with where most of the nodes sit, FLUX a day as an estimate, health with the
problems in words, and a link to the wallet most of the nodes are paid to. Live activity (nodes joined and left over
a day and a week, marked "at least" while the server has only been counting since it started, and the latest node
events); the payment queue at a glance (the next node, a turn's length and a day's yield per tier); where the nodes
are, who hosts them and which FluxOS they run, each with a way into analytics; how decentralized the network is (the
Nakamoto coefficient for countries, providers and operators, and the concentration index, said in words); node age;
how the nodes benchmark per tier; and the newest nodes. Each section loads, fails, waits for the server's first fill
and empties on its own, and holds its size while it does.

Identity (collateral outpoint, IP:port, tier, payment address → operator view, ZelID, pubkey), location (city,
region, country, provider/ASN, hosting flags, mini-map), **payment queue** (position in tier, ETA to next payout,
last paid, payment history from our blocks, earnings/day estimate), **lifecycle** (started, joined, heartbeat
timeline, blocks since last confirm with expiry risk, IP history), hardware (cores/threads, RAM, SSD, EPS,
bandwidth; percentile vs its tier), versions (FluxOS, fluxd, bench, ArcaneOS, Docker, OS) with "latest?"
markers, reachability (stats round + WatchProbe if watched), peers (count + reveal on globe), hosted app
instances, co-hosted nodes (same IP), blocks produced by this node, recent events.

**Done when:** every field is sourced or marked unknown; the payout ETA updates each block; "watch" enrolls the
node in WatchProbe and raises its events above the animation budget.

## 4. App inspector

**Landing (`/apps`, what the Apps launcher opens):** the app network in one window, maximizable and phone friendly.
Search for an app in place. A hero with the number of apps and what they lock of the network's CPU, memory and storage
(a floor, because enterprise apps keep their size private), over instances running, owners, enterprise apps,
countries and apps per owner. The biggest apps as a treemap by instances running or by footprint beside the ranked
list; the top owners (a row opens in place with the owner's biggest apps); where the instances run, by country, with a
way to show a country's nodes on the globe; the apps registered and updated each day for 90 days (with its numbers as
a table); what apps pay for their register and update messages over a day, a week and a month; the newest apps; and
the apps about to expire (the time is an estimate, the block count is exact). Each section loads, fails, waits for the
server's first fill and empties on its own, and holds its size while it does.

Header (name, description, owner, spec version, registered height/date, expiry countdown with the PoN block
conversion, instances running / target, enterprise flag), constellation on the globe (instances linked, with a
rolling update shown by instance hash), components (image repotag → registry link, ports, domains + the default
`<name>.app.runonflux.io` URL, env var count (names only), CPU/RAM/SSD per instance and totals, tiered specs),
geo restrictions, lifecycle (pending → confirmed → installing → running; install failures), **spec history** (every
permanent message with a readable diff between versions, FLUX paid per update, owner transfers), marketplace
template link.

**Done when:** encrypted (enterprise) apps are clearly labelled with their public fields only; spec diffs are
correct across versions v2–v8; the constellation animates live instance changes.

## 5. Explorer

- **Landing (`/explorer`, what the Explorer launcher opens):** the chain live in one window, maximizable and phone
  friendly. A hero with the height and its pace (block time, transactions and fees so far today against the same hours
  yesterday, pending, nodes) over a tape of the last hundred blocks (each bar cut by kind, late blocks marked, the next
  block filling as the 30 seconds pass) with a clear "Latest block" action; the latest blocks; the mempool now; who
  holds the supply (the share of the top ten, the five largest addresses with their labels, and the movers over a day,
  a week or a month) with a way to the whole rich list; the long view from `GET /chain/daily` (transactions, fees,
  FLUX moved, blocks and supply over 30 days to two years, linear or log, with the numbers as a table); the supply; search
  in place with the palette's resolver; quick links. Each section loads, fails, waits for the server's first fill and
  empties on its own, and every chart has its numbers as text. The explorer views share a small nav in their headers
  so the rich list, the mempool and the supply are one click apart.
- **Search omnibox** (ARCHITECTURE section 6 `/search`): height, block hash, txid, t1/t3 address, shielded address
  (explained), IP(:port), collateral outpoint (any form), app name, country, provider, and version. Typed result
  chips; Enter goes to the best hit.
- **Block view:** header, producer (node link), payouts (by tier, node links), dev fund, tx list grouped by kind
  (fluxnode confirms/starts, app payments, transfers), prev/next navigation, live confirmations.
- **Tx view:** inputs → outputs flow visualization (change collapsed), fees, Flux tx type annotations (start /
  confirm with node link, app register/update with app link, coinbase payouts with tier labels), confirmations
  ticking live, mempool state if unconfirmed.
- **Address view:** balance, received/sent, tx history (paginated, newest first), UTXOs, balance over time (from
  history), **nodes owned / paid to this address** (count by tier, mini-map, locked collateral), payout timeline,
  rich-list rank, known-entity labels (dev fund, swap pool).
- **Mempool view:** live pending txs (mostly node confirms), transfers highlighted.
- **Supply & emission:** transparent + shielded supply, circulating (per explorer, labelled), emission schedule
  curve with all cuts, the announced 560M reference line (labelled as announced, not enforced), dev-fund inflow.
- **Rich list:** rank, balance, share of supply, nodes operated, locked vs liquid.

**Done when:** every explorer entity cross-links to the others and to the globe; immutable data is cached, and
live data (tip, mempool, confirmations) updates without reloads.

## 6. Analytics

- **Network growth:** node counts by tier over time (30-day backfill from stats history, then our own metrics),
  joins/expiries per hour, age distribution, survival.
- **Geography & decentralization:** countries/continents/cities ranked, provider/ASN concentration (grouped by
  ASN, not by org spelling), Nakamoto coefficients (country, ASN, operator), hosting vs residential share, UPnP
  multi-node hosts.
- **Capacity & utilization:** total vs app-locked CPU/RAM/SSD by tier, country and provider; EPS and bandwidth
  distributions.
- **Versions:** adoption waves over time (FluxOS, fluxd, bench, ArcaneOS), stragglers per operator.
- **Economics:** payouts per tier per day, per-node daily estimate per tier, emission, dev fund, reward-cut impact.
- **PoN fairness:** producer share by tier/country/provider vs node share (expected vs actual).
- **Chain history:** block difficulty and time per block over 24 h, 7 d, 30 d, a year and the whole chain, against
  the target (120 s before the PoN fork, 30 s after); per block for recent windows, sampled every 720 blocks for
  the rest, with honest gaps and coverage (`GET /network/chain-history`).
- **App economy:** apps and instances over time, deploys/updates per day, FLUX spent on apps, top images,
  enterprise share, spec-version adoption (spec archaeology over the full permanent-message history).

**Done when:** every chart is interactive (hover values, click-through to filtered globe/list) and live
where the underlying data is live.

## 7. Payment queue visualizer

Three rings (one per tier), nodes ordered by queue position, a cursor sweeping one slot per block, a pre-aimed
next payee, the paid node animating to the back. Search or click any node to see its position and ETA.

## 8. Operator view & watchlist

The top operators leaderboard on the Nodes landing opens any operator here.

Enter one or more addresses/ZelIDs (stored locally; shareable URL) → fleet map highlight, status grid,
next payouts with ETAs, earnings (24 h / 7 d / 30 d), expiry-risk alerts, version stragglers, hardware mix, apps
hosted. Watchlist of individual nodes with opt-in browser notifications for: offline (WatchProbe), at risk of
expiry, paid, IP changed, expired.

## 9. Time machine

A timeline scrubber over our recorded history (and the 30-day tier-count backfill): the globe replays node
appearance/expiry, charts sync their cursors, and play/pause runs at variable speeds. Labelled clearly as
"history since <first ingest>".

## 10. Ambient mode (screensaver)

Auto after idle (configurable), manual via palette/terminal/shortcut, and kiosk URL `/ambient` (no chrome,
auto-reconnect, wake-lock). A cinematic camera director follows live events: block producer → payees, deploy
lifecycles, mesh flow. Minimal typography overlays, optional generative sound (off by default), and a hidden
easter egg. Any input exits smoothly back to where the user was.

## 11. Command palette & terminal

- **Palette (⌘K / Ctrl+K):** search everything, run actions (toggle layers, filters, go to place, open views,
  enter ambient), recent items.
- **Terminal:** `help`, `node <ip|collateral>`, `app <name>`, `block <h|hash>`, `tx <id>`, `addr <a>`, `search <q>`,
  `goto <place|lat,lon>`, `filter <expr>`, `layer <name> on|off`, `top countries|providers|apps`, `queue <tier>`,
  `watch <node>`, `operator <addr>`, `ambient`, `stats`, `about`, `clear`. It has autocomplete, history, and live
  output for streaming commands (`tail blocks`, `tail feed`).

## 12. Achievements

Local-only, playful, unobtrusive (e.g. first node inspected, all continents visited, ten live blocks watched, a
payout to a watched node witnessed, time machine used, app constellation viewed, ambient for ten minutes, the
easter egg found). Icons come from the design system (no emoji).

## 13. Platform

Deep links for every entity and view; installable PWA; phone layout (bottom sheets, simplified globe controls);
`prefers-reduced-motion` honored everywhere; full keyboard access and visible focus; WCAG AA contrast on text;
performance budgets (first meaningful paint < 2 s on broadband, globe 60 fps target, JS main thread free of
long tasks during live bursts).
