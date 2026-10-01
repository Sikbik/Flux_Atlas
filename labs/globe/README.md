# Flux Atlas globe lab

The real-time 3D globe for Flux Atlas v2, built as a standalone lab: a framework-agnostic renderer in
`src/engine/` (plain three.js r0.186, WebGL2, no React), and a small lab app around it in `src/lab/`
(dev HUD, a fake live feed, the ambient overlays). The engine is written to be ported as a folder into
`web/src/globe/engine/`; the lab is the harness that proves it and the reference for the DOM around it.

Clean-room: nothing here is derived from the v1 renderer. The look follows the Design Director's
direction v0.3 (`docs/design/design-direction.md`, sections 6.4, 7.x) and reads every colour from its tokens.

What it draws, in one list: the planet in three art directions; up to 15,000 nodes as stacked towers
that unfurl into fans as you zoom (6,724 real ones in the bundled snapshot); the peer mesh as a faint
rolling web; hover, click and a selection beacon; app constellations; the block relay (producer, the
Flux moon, three payees, the dev fund); node lifecycle pulses; the day and night terminator for the real
UTC time; a screensaver mode with a camera director, typographic overlays, optional generative sound and
a hidden easter egg.

Contents: [Run it](#run-it) | [Art directions](#art-directions-and-the-choice) | [Engine API](#engine-api) |
[Driving it from the web app](#driving-the-engine-from-the-web-app-effectsink) | [The Flux moon](#the-flux-moon) |
[Ambient mode](#ambient-mode) | [Reduced motion](#reduced-motion) | [Performance](#performance) |
[Data format](#data-format) | [Tokens, fonts and assets](#tokens-fonts-and-assets) | [Screenshots](#screenshots) |
[Porting checklist](#porting-checklist) | [Limits and honest notes](#limits-and-honest-notes)

## Run it

```sh
cd labs/globe
npm install
npm run dev          # http://127.0.0.1:5391 (the port is strict)
npm run build        # type check, then a production build into dist/
npm run preview      # serves dist/ on http://127.0.0.1:5392
```

Needs a browser with WebGL2. Developed and verified on Chromium 153 (Linux) with the GPU path
(Vulkan through ANGLE on an RX 9070 XT) and with SwiftShader. Firefox and Safari were not tried.

Other scripts: `npm run tokens` (copy the design tokens in), `npm run textures` (download and prepare the
NASA and Natural Earth assets), `npm run fixtures -- <rawDir>` (rebuild the network snapshot),
`npm run check:sink` (type-check `engine.sink` against the web app's `EffectSink`, both ways),
`node scripts/shots.mjs` (the screenshots, see [Screenshots](#screenshots)).

### URL parameters

All optional. They exist so a screenshot or a bug report is one link.

| Parameter | Values | Meaning |
|---|---|---|
| `art` | `marble` (default), `dotmatrix`, `neon` | art direction |
| `quality` | `auto` (default), `high`, `medium`, `low` | quality tier |
| `nodes` | `real` (default), `synth15`, `synth30` | the bundled 6,723-node snapshot, or 15,000 or 30,000 synthetic nodes shaped like it |
| `ambient=1` | | start in screensaver mode |
| `feed=0`, `speed=N` | | switch the fake live feed off; run it N times faster |
| `hud=0`, `labels=0`, `intro=0` | | hide the dev HUD; hide hub labels; skip the load-in wave |
| `dpr=N` | | cap the device pixel ratio (default 2) |
| `mesh` | `off`, `selection` (default), `flow` | mesh layer mode |
| `cam=lat,lon,range[,tilt]` | | start pose (`range` is altitude in globe radii) |
| `sun=ISO-8601` | | freeze the sun at a UTC time (default: the real clock) |
| `select=<id>`, `app=<index>` | | start with a node selected, or an app constellation shown |
| `moon=0`, `moonmode`, `moonphase`, `moonclock` | `auto`, `companion`, `orbit` | moon off; placement; freeze its phase (degrees, orbit mode); start it that many seconds along its orbit |
| `moonview`, `moonat`, `moondur` | `portrait`, `earthrise`, `eclipse`, `follow` | start on a free moon shot, freeze it at second N, set its length |
| `driver=sink` | | play blocks through `engine.sink` (the app's path) instead of `engine.emitBlock` |
| `boot=1` | | play the boot at load |
| `sound=1` | | arm the ambient sound for the first click or key (browsers need a gesture) |

Keys: `A` toggles ambient mode, `H` collapses the HUD, `M` is the moon's click (what the app maps to opening
About Flux), `Esc` clears the selection and any constellation. Typing `stache` plays the easter egg.

## Art directions and the choice

Three were built and shot with the same camera: `shots/art-marble.webp`, `shots/art-dotmatrix.webp`,
`shots/art-neon.webp`.

| | Marble | Dot matrix | Neon |
|---|---|---|---|
| Look | NASA Blue Marble and Black Marble photographed through a slate grade: land in cool grey, oceans near black, real city lights, a thin cloud layer | the design's own dot-matrix globe: a hex-packed lattice of dots on land, graticule, antialiased coasts | glowing coast and border lines, hatched land, a magenta terminator ring, tron blue |
| Cost (15k nodes, 200 arcs, 50 pulses, 1440p) | 4.5 to 5.7 ms | 4.5 ms | 4.4 ms |
| Assets | day, night, clouds textures (about 2.6 MB) | land mask only | land mask and border lines |
| Lite tier | works, no clouds | the natural lite look | works |

**Marble is the default and the hero.** Reasons: it is the only one that makes the planet itself read as
a real place, which is what lets a viewer find Frankfurt or Virginia without a label, and the real night
lights agree with the real terminator: the picture says "this is happening now, on Earth". The slate grade
keeps the planet quiet (land is grey, ocean is black), so the node tiers (cyan, violet, amber) and the
moon's brand blue carry all the saturation on screen; the photographic version without the grade fought the
node colours. Its frame cost is within a millisecond of the other two, and bloom treats the real lights gracefully.

**Dot matrix** is the design mock's look and the right choice for the lite tier and for anything that must
stay legible under a heavy UI (it has the least texture detail, so labels and windows sit on it easily).
It needs no image downloads. **Neon** is the stylistic option: the most dramatic, the least calm, and its
glow competes with node colours, so it is kept as a theme, not a default.

All three share every other layer (nodes, relay, moon, mesh, ambient), so switching is one call:
`engine.setArtDirection('dotmatrix')`.

## Engine API

```ts
import { GlobeEngine } from './engine/GlobeEngine';
const engine = new GlobeEngine(canvas, { assetBase: import.meta.env.BASE_URL, artDirection: 'marble', quality: 'auto' });
```

The constructor throws `GlobeUnsupportedError` when WebGL2 is missing. `engine.dispose()` releases the GPU
resources, listeners and the animation loop. Everything crosses the boundary as numbers and typed arrays.

### Data

| Call | What it does |
|---|---|
| `setNodes(cols: NodeColumns, { animate?, intro? })` | replaces the whole node set. When nodes already exist it diffs by id (departures fade, arrivals grow); the first load plays a wave from the camera target |
| `updateNodes(delta: NodeDelta)` | `added` (columns), `removedIds`, `changed` (`tier`, `status`, `flags` by id), animated unless `animate: false`. Same-location nodes stack on arrival without disturbing neighbours |
| `setFilter(filter \| null, allowIds?)` | dims nodes that do not pass (`tiers`, `statuses`, `requireFlags`, `excludeFlags` bit masks, plus an optional id allow-list). Cross-fades over 500 ms; spire height follows the passing count |
| `setWatched(ids)` | a dashed ring on nodes the user owns or watches; they survive focus dimming |
| `setMesh(a, b)` / `updateMesh({ addA, addB, removeA, removeB })` | peer links as two id arrays |
| `setMeshMode('off' \| 'selection' \| 'flow')` | no links, a selected node's links only, or a rolling web of all links with packets travelling along them |
| `setUnlocatedBelt(on)` | nodes without a location (NaN lat or lon) are hidden by default; this draws them as an orbital belt |

`NodeColumns`: `ids` (u32, unique, non-zero), `lat`, `lon` (f32 degrees, NaN = unknown), `tier` (u8: 1 Cumulus,
2 Nimbus, 3 Stratus), `status` (u8: 1 confirmed, 2 started, 3 offline, 4 DoS, 5 at risk), `flags` (u8 bits, see
`NodeFlag` in `types.ts`), `loc` (u32 co-location cluster id), optional `host`. Co-located nodes share a
`loc` and form one stack: a tower far away (height follows the live count, segmented by tier), a fan of
individual nodes up close, with an eased transition between them. Capacity grows by powers of two; 15,000
nodes and 30,000 both run without a rebuild.

### Selection, camera, picking

| Call | What it does |
|---|---|
| `select(id \| null, { fly?, alt?, silent? })` | selects a node: beacon and ring pulses on it, the rest dims to 55%, its peers light with their links (a dashed arc for inbound peers). Flies there unless `fly: false` |
| `setHover(id \| null)` | highlights a node as if hovered (list rows hovering their node); no tooltip event |
| `flyTo(lat, lon, alt, { tilt?, heading?, duration? })` | resolves when the flight ends. 900 to 2,600 ms by angle covered with an altitude arc and ease in-out; 400 ms and no arc under reduced motion |
| `flyToNode(id, alt?)`, `flyToCluster(cluster, alt?)` | the same for a node or a hub |
| `releaseCamera()` | leaves a free moon shot and blends back to the standard camera |
| `setFocusOnly(on)` | focus mode: everything but the selection and the constellation dims to the full dim alpha |
| `setInset({ left, right, top, bottom }, ms?)` | docked UI: the globe re-centres in the free area over `ms` (default 300) and the moon's orbit re-clamps to it, so a window never covers either |
| `showAppConstellation(ids \| null, { name?, fly? })` | an app's instances linked by thin arcs (a minimum spanning tree plus a few loop-closing links, drawn in over about two seconds), member hubs lit, everything else dimmed. `clearAppConstellation()` |
| `project(lat, lon, radius, out)`, `projectNode(id, out)` | CSS pixel positions for DOM overlays; `out.visible` is false behind the limb |
| `nodeInfo(id)`, `getHubs(max)` | static info; the biggest co-location hubs (`lat`, `lon`, `count`, tier split) for labels |
| `aimAnchors()` | where the pre-aim reticles are on screen, for chips |

Interaction is built in: drag to orbit with inertia, wheel and pinch zoom on a log scale, double click to
zoom to the point, click to select (a click on a stack flies in so it unfurls). Picking is a CPU pass over the
projected nodes (about 0.1 ms at 15,000, no GPU readback) that reads the same display positions the shaders do, so
it matches exactly what is drawn. Idle drift: after 20 s without input the global view (zoom band 0) turns 1.2 degrees per second (never when
reduced motion is on or a node or constellation is selected; set `engine.idleDrift = false` while a window holds
focus).

### Events out: `engine.on(name, fn)` returns an unsubscribe function

| Event | Payload |
|---|---|
| `hover`, `select` | `PickInfo \| null` (`id`, `lat`, `lon`, `tier`, `status`, `flags`, `clusterSize`, `isCluster`, canvas `x`, `y`) |
| `pickCluster` | a hub was clicked: `cluster`, `loc`, `lat`, `lon`, `count`, `tiers`, `x`, `y` |
| `cameraChange`, `zoomBand` | pose, `size` (the planet's diameter in percent of the viewport height) and `band` 0 to 3 (global under 110, continental to 260, regional to 700, city); at most once per frame |
| `moon`, `moonclick`, `moonhover` | the moon was clicked (same moment, two names) or the pointer entered or left it |
| `block`, `seal`, `payout`, `devfund`, `aim` | a block started; the moon sealed it; a payout landed (with canvas position); the dev-fund bar flashed; the next payees were announced |
| `appDeploy`, `mempool`, `egg` | lab-choreographer events |
| `summary`, `reorg`, `recap` | mirror the effect sink's commands of the same name |
| `wake` | the screensaver was woken by input |
| `caption` | a caption from the ambient director |
| `frame`, `quality`, `budget`, `ready` | per frame stats; the governor changed scale or tier; the budget suppressed events; the camera came to rest |

### The look

`setArtDirection(art)`, `setEffects({ bloom, chromatic, grain, vignette, atmosphere, stars, clouds, nightLights,
terminator, mesh, spires, labels })`, `setQuality('auto' | 'high' | 'medium' | 'low')`, `setDesignTokens(t)` and
`setTokens(partial)`, `setSunTime(utcMs \| null)` and `setSunRate(n)`. The sun is the real UTC time by default
(subsolar point and terminator from a small solar model in `astro.ts`).

### Time and testing

`pause()`, `resume()` and `stepFrame(dt)` make captures deterministic: the screenshots are the same picture on
every machine. `benchmark(frames)` renders with a GPU sync per frame and returns ms per frame. `engine.stats` is the
live `EngineStats` (fps, frame and CPU ms, draw calls, triangles, nodes, pools in use, DPR, render scale, tier).

## Driving the engine from the web app (EffectSink)

The web app has its own choreographer (`web/src/choreo/`) and will bypass the lab's. The engine therefore
exposes the same vocabulary as low-level primitives: **`engine.sink` implements the web `EffectSink`
one to one** (same command names and fields; `src/engine/effects.ts` re-declares the types so the lab builds
alone, and on porting you delete that block and import them from `web/src/choreo/effects.ts`). `npm run check:sink`
proves it at the type level against the real file: `engine.sink` is assignable to the web's `EffectSink`, and the
web's `EffectSink` to the engine's.

```ts
runtime.setEffectSink(engine.sink);        // the app's choreographer now drives every visual
engine.setMoon({ mode: 'auto' });          // companion in the shell, orbit in ambient (see The Flux moon)
engine.on('moon', () => openAboutFlux());  // the moon's click
```

Every command is immediate: it draws at the moment it is called, from preallocated pools, and schedules
nothing of its own except short tails that belong to the effect (a payee's 6 s brightness hold, the second ring of an
ignition, the gossip hops of a block). Timing, rate budgets, coalescing and priority stay with the caller. The
engine keeps only its own concurrency caps (the arc, ring and beam pools drop the newest when full).

| Web command | What the engine draws | Notes |
|---|---|---|
| `beat(cmd)` | producer flare (white, 900 ms), pillar 0.34 R, ring, node flash, a small camera shake (never when reduced), and the shockwave: a ring rolling over the planet to 62 degrees in 1700 ms, four passes (24, 10, 3.6, 1.4 px) that light the nodes they pass | `emission`: a second ring 400 ms later to 88 degrees in 2100 ms, emission tint. `compact`: nothing (beams only). `reduced`: a static ring flash at the producer, no shockwave. It also hides the faint aim guides |
| `uplink(cmd)` | a beam from the producer up to the moon over `durationMs` | does nothing when the moon is off |
| `moonFlare(cmd)` | all four pieces flash, two rings leave the moon, a bead is added to the chain, and the `seal` event fires | with `piece` (`bar`, `smallHex`, `bigHex`, `cap`) only that piece flashes for 340 ms |
| `downlink(cmd)` | a ribbon from the moon's piece for that tier to the payee, `durationMs` long, in the tier colour | if its piece was not flashed in the last 200 ms the engine flashes it now and launches the beam 60 ms later (it flies a little faster so it still lands on time). With no moon it flies straight from the producer |
| `payoutLanded(cmd)` | the aim reticle collapses into a payee pulse (ring 6 to 36 px in 900 ms), node flare, +40% brightness for 6 s, an `Impact` ring; `mine` adds a second ring in the "mine" colour; the `payout` event fires with the canvas position | `highlightMs` set: a static highlight instead (reduced motion) |
| `devFund(cmd)` | the bar piece flashes (unless it just did) and the `devfund` event fires with the bar's canvas position, so the app places its chip | the engine draws no chip: DOM is the app's |
| `heartbeats(cmd)` | micro sparkles on `nodes` | the caller samples to its budget |
| `pulse(cmd)` | one node: `joined` (pillar, two rings, white-hot flash), `started`, `left` and `expired` (implode ring), `confirmed`, `status`, `recovered`, `dos`, `unreachable`, `ip_changed`, `located`, `installing` (a spinning 240 degree arc until the instance starts), `instance_started`, `instance_removed`, `instance_updated` | these are flourishes only: the node must exist in the engine (call `updateNodes` first for `joined`) |
| `aim(cmd)` / `clearAim()` | a breathing reticle on each next payee (up to 8, tier colour; the last 5 s breathe faster), plus a faint dotted guide from the moon's piece to the payee that brightens over the last 5 s | `payees[].amount` is an optional extension (the lab draws a label with it) |
| `app(cmd)` | per-node flourishes for an app's phases: `pending`, `confirmed`, `expired`, `upserted`, `removed` | |
| `links(cmd)` | draws added mesh links (fade-in plus a handshake packet) and fades removed ones | the links must be in the store (`setMesh` / `updateMesh`); added ones are added for you |
| `summary(cmd)` | emits `summary` (the engine draws no "+N more"; that is a DOM chip) | |
| `reorg(cmd)` | takes the newest beads off the moon's chain and emits `reorg` | |
| `recap(cmd)` | flushes anything queued, emits `recap` | |

The relay's timeline (design 6.4 I) is data, exported from `effects.ts`: `RELAY` and `DOWNLINK_ORDER`.
Times in ms after the Beat: the producer flares at 0; the uplink leaves at 60 and flies 720 ms (the moon
receives at 780); the moon fires its four outputs **in coinbase order, dev fund, Cumulus, Nimbus, Stratus, 130 ms
apart** starting at 890; each piece flashes 60 ms before its output leaves; the dev-fund chip starts 60 ms
after the bar's turn; each downlink flies 900 ms and lands 40 ms early, so the payouts land at 1880, 2010 and
2140; the next payees are aimed at 2600; the sequence ends at 2780. Reduced motion: flare static, uplink 380,
receive 440, every downlink at 480, landed at 860. A second block inside 3 s plays the compact version
(uplink 300, downlinks 600, 60 ms apart).

What the web choreographer needs to match, as of today: `web/src/choreo/choreographer.ts` still orders
downlinks Stratus, Nimbus, Cumulus (`DOWNLINK_ORDER` there) and sends `moonFlare` without `piece`. Design v0.3
wants dev fund, Cumulus, Nimbus, Stratus and per-piece flashes. The engine copes with the old behaviour (it flashes
the piece itself on `downlink`), but the order is the caller's, and the crescendo that ends on Stratus only
happens if the caller adopts it. `src/lab/sinkDriver.ts` is a hundred-line reference for the whole sequence
through the sink, and `?driver=sink` runs the lab on it. Measured through it (wall clock, 60 fps): moon seals at
781 ms, dev fund chip at 962, payouts at 1882, 2012 and 2141 ms; with reduced motion 441, 551 and 862.

Two more things the app must do around the sink: (1) node set changes (`setNodes`, `updateNodes`) come from
the store; the sink only draws the flourish, so call `updateNodes({ added })` before `pulse('joined')`.
(2) Call `engine.announceBlock(block)` just before the Beat when in ambient mode: it tells the camera director
to cut to the producer and returns how many seconds it would like the Beat delayed. The app may ignore the
return value; nothing waits for it.

The engine's own **choreographer** (`choreographer.ts`) is an optional layer for the standalone lab and
for `engine.enqueue(event)` / `emitBlock`: it schedules the same sink calls on the relay's timeline from a
time heap, spreads bursts, applies token-bucket budgets per family (beams, confirms, ticks, life, apps, crawl,
links) and priorities, and applies state changes at enqueue time so a hidden tab can never leave the wrong
network on screen. The web app does not need it.

## The Flux moon

The Flux symbol (the official brand outline, in `moon/symbol.ts`) is the chain. Block producer beams up to
it, it flares when a block is sealed, and it pays out three beams to the payees (small hexagon to the Cumulus
payee, big hexagon to Nimbus, cap to Stratus; the bar is the dev fund). Faint dotted guides run from its pieces
to the next block's payees. A chain of small hexagons on its orbit is the last blocks, each left at the moon's
angle when it was sealed.

**Two placements, one object** (design 7.10.12), switched by `engine.setMoon({ mode })`:

| Mode | Where | Used for |
|---|---|---|
| `companion` | screen space, locked to the camera: a tilted ellipse (1.32 R, 22 degrees, rolled -16 degrees) around the middle of the free area, clamped so the whole orbit fits it, never covered by docked UI, lap 240 s (120 s ambient), slows to 15% on hover. Drawn in an overlay pass with the depth buffer cleared, so it is never behind the planet | the shell (explore) |
| `orbit` | world space, an inclined orbit around the planet at 2.05 R; the planet can hide it and cameras can fly to it | ambient mode, the lab, and the cinematic moon shots |
| `auto` (default) | `companion` in explore, `orbit` in ambient (and in any `viewMoon` shot); always `companion` under reduced motion, which has no orbit to ride | |

Switching blends over 900 ms (the body moves from the overlay pass to the world scene when the blend
completes; the look moves from the tonal brand blue of the companion to the glass look of the orbit with the
blend). It is feasible as a depth-cleared overlay pass because the overlay uses the same camera as the scene.

The brand rules are binding in the code (`symbol.ts` header): colours stay in the brand family (Flux blue
#2B61D1, white, black, gray, the tonal blues of the book), proportions never change, no tier colour or hue shift ever
touches the symbol, no outline or border is drawn on it. The pieces move apart and lock back together; they are
never recoloured, stretched or re-arranged. The beams that leave it are in tier colours: they are not the logo.

API: `setMoon({ on, mode, scale, padTop, guides, chain, lite, ... })`, `moonState()` (`x`, `y`, `s`, `r`, `z`,
`visible`, `hover`, `phase`, canvas pixels, per frame for the DOM proxy button), `moonScreen()`, `moonClick()`
(keyboard or proxy activation), `setBeat(0..1)` (the ring that fills across the block interval; steps once per
second under reduced motion), `setMoonStatus('live' | 'late' | 'offline' | 'archive')`, `seedMoonChain(blocks)`
(pass the last dozen blocks once; every sealed block adds its own), `setMoonBoot(boot)` and `setReveal(originNodeId,
theta)` (the boot sequence: the pieces arrive and lock, a white flash, the symbol lifts into orbit while a reveal
wave lights the planet; `src/lab/boot.ts` is the reference driver, from weighted load progress to pieces, flash,
reveal and lift, with the reduced-motion cross-fades; `?boot=1` or the HUD's `boot` button plays it), `setReduced(on)`, `viewMoon('portrait' | 'earthrise' | 'eclipse' | 'follow')`.
Events: `moon`, `moonclick`, `moonhover`, `seal`, `devfund`. Hit testing is on the moon's disc (clearance
radius 0.74 of its height) and works in both modes, in both art directions and in the lite tier (flat faces, no
extrusion, glow or sweep).

Seen in `shots/`: `moon-companion.webp` (close-up, companion), `moon-chain.webp` (the ring and chain),
`moon-orbit-portrait.webp`, `moon-earthrise.webp`, `moon-eclipse.webp` (orbit mode, cinematic), `moon-lite.webp`,
`moon-neon.webp`, `moon-hover.webp` (the tooltip card), `boot-sheet.webp`, `relay-sheet.webp`,
`relay-reduced-sheet.webp`.

## Ambient mode

`engine.setMode('ambient')` (or `engine.ambient.start()`) turns the globe into a screensaver. A director picks a
scene about something the network is really doing; nothing is decoration.

| Scene | Seconds | What it shows |
|---|---|---|
| landing | 7.6 | a block landed: the camera cuts to frame producer, moon and payees together (a wide shot), then comes down onto the payees while their pulses land. Cued on the Beat so the cut lands on the shockwave |
| orbit | 26 | the planet at hero size, slow drift, the night side toward the camera when quiet |
| sweep | 22 | along the terminator, dawn or dusk, atmosphere backlighting the limb |
| hub | 14 | the densest datacentre of the moment, close, towers unfurled into fans, with its name |
| web | 18 | the mesh at high alpha, packets flowing |
| constellation | 12 | a random popular app: its tree draws in over the planet; the mesh steps aside for the scene |
| flyby | 10 | a low pass between two real sites |
| drift | 14 | over the region with the most activity in the last minute |
| counters | 6 | an overlay counts up nodes, hosts and apps |
| earthrise, eclipse, moonfollow | 16, 16, 18 | the moon scenes: the planet rising behind the moon; the moon crossing the sunlit limb as a silhouette (planned from the moon's real orbit); riding along with the moon |
| egg | 7.5 | a handlebar moustache drawn in light over the planet (see below) |

Pacing: scenes never repeat, never two high-energy scenes in a row, a recently played scene is down-weighted,
and the live event rate steers the choice (a burst favours the drift, quiet favours the orbit and the web). Landings
always play. The director only writes camera targets, the mesh mode and captions; it owns no rendering.

Overlays (lab DOM, `src/lab/ambientOverlay.ts`, in the design's type: Montserrat display numerals, Open Sans,
Lora italic for the one editorial line): a brand mark and UTC clock top left, the block height as an odometer
bottom left with "Next block in N s" and the beat ring, the scene caption or the block's route (producer to payees with
amounts as they land) bottom right, the counters scene top right, a faint "asleep. move the mouse." line. The
overlay drifts 12 px over 120 s so a TV never burns in. The pointer waking it needs 8 px of travel; a press, wheel,
touch or key wakes it at once (`wake` event).

Sound (`ambient/sound.ts`): generative, off by default, started only by a user gesture. A low drone of two open
fifths under a slowly breathing filter; each block is a soft bell whose pitch walks a pentatonic scale with the
height, over a low thump; each payout is a pluck pitched by tier and panned to where the payee is on screen; an
aimed payee gets a faint tick; a synthesized room reverb. Only the drone is continuous.

The easter egg (`ambient/egg.ts`): an original handlebar moustache, drawn as a stroke of light across the planet
and captioned "stache.beer / brewed, not hosted". It is never random: typing `stache`, the HUD's Egg button, or
`engine.ambient.egg()`.

## Reduced motion

`prefers-reduced-motion` (or `engine.setReduced(true)`; the lab HUD has a toggle) follows design 6.6:

- the moon is a parked companion, upper right (right of the planet in ambient, where the counters live), with no orbit, sway, chain or sweep;
- the relay is a static flare, no shockwave, and the uplink and three downlinks appear together as lines that fade in (see the timings above); chips appear in place;
- camera flights take 400 ms with no altitude arc; no idle drift; no travelling packets in the mesh; no chromatic aberration or grain; no camera shake; no node spawn animation or load-in wave; breathing rings hold still and the install arc turns at a fifth of its speed;
- ambient becomes still compositions held 20 s with a 0.45 s cross-fade through black between them: camera moves are cuts, the follow and eclipse scenes are not used, landings cut instead of flying.

Seen in `shots/relay-reduced-sheet.webp` and `shots/ambient-reduced-sheet.webp`.

## Performance

Measured with `engine.benchmark()` (CPU update, render and a GPU sync per frame, median of three runs of
90 frames) in headless Chromium on an AMD RX 9070 XT, 2560 x 1440, DPR 1, WebGL2 through Vulkan and ANGLE.
Budget at 60 fps is 16.7 ms. The GPU was shared with other work on the machine, so treat the figures as
having about 1.5 ms of noise.

| Scenario | ms per frame |
|---|---|
| real 6,723 nodes, marble | 3.1 |
| 15k nodes, marble | 3.4 |
| 15k nodes, 200 arcs, 50 pulses, marble | 5.1 |
| the same, dot matrix | 4.5 |
| the same, neon | 4.4 |
| 30k nodes, 200 arcs, 50 pulses, marble | 5.3 |
| 15k, 200 arcs, 50 pulses and three relays playing, marble | 4.8 |
| 15k with relays, companion moon, dot matrix | 5.4 |
| 15k with relays, orbit moon (ambient), marble | 6.1 |
| 15k ambient with the feed at 3x, marble | 5.1 |
| 15k explore with the feed at 3x, marble | 3.7 |
| 15k, 200 arcs, 50 pulses: tier high, medium, low (marble) | 5.8, 5.3, 2.1 |
| the same, dot matrix at tier low | 3.0 |

A frame is 21 to 27 draw calls. Soak (ambient mode, 15k synthetic nodes, feed
at 6x, 135 s, memory sampled after a forced GC): the JS heap stays flat at 40 to 44 MB (one transient 65 MB sample
while the machine was busy), geometry count 15 to 17, textures 13, scene children 12, pools bounded. A hidden tab
stops the loop and clears the effects; returning plays no backlog.

Degradation ladder: the tier (`high`, `medium`, `low`) is chosen at start from device hints (mobile, cores, memory)
unless forced. In `auto` a governor lowers the render scale by 0.1 after 1.5 s of frames over 19.5 ms, down to
0.55; at the floor it drops a tier (MSAA 4, 2, 0; bloom levels 6, 5, 4; grain off from `medium`, chromatic
aberration off at `low`; atmosphere steps 10, 7, 4; the flat lite moon at `low`; DPR cap 2, 1.5, 1) and resets to 0.8; after 12 s of comfortable
frames it raises the scale again by 0.05 (never the tier). `low` also loads 2048 px textures and the 1:110m
coastlines. Pool sizes per tier are in `quality.ts`.

Not measured: an integrated GPU or a phone (none available), and software GL (SwiftShader) is only used for
screenshots. The design's target (60 fps on an integrated GPU at 15k nodes, 200 arcs, 50 pulses in `balanced`)
therefore stands unverified; the ladder above is how the engine protects it. The 1440p numbers are with
the full post chain (bloom, composite, grain, chromatic aberration) on.

## Data format

`public/data/flux-snapshot.json` and `.bin` hold the bundled network, snapshot 2026-09-30, tip 2,996,915:
6,723 nodes, 2,653 hosts, 489 locations, 13,639 sampled peer links, 1,401 apps with 7,895 instances. No IPs,
collateral or payment addresses. The binary is little endian, columns 4-byte aligned; the JSON gives each
column's `offset` (bytes), `length` and typed-array `type`:

`ids` u32, `lat` f32, `lon` f32, `tier` u8, `status` u8, `flags` u8, `loc` u32, `host` u32, `country` u16,
`org` u16, `meshA` u32, `meshB` u32 (edges as node ids, one per link), `appOffsets` u32 and `appInstances` u32
(app i owns `appInstances[appOffsets[i] .. appOffsets[i+1])`). String tables (`countries`, `orgs`, `locs`, `apps`)
are in the JSON. One column is partly synthetic and the file says so: the ArcaneOS flag is set at a 38% rate
because the source does not expose it. `src/lab/data.ts` loads it into `NodeColumns`, and generates the 15k and
30k synthetic sets by sampling the real distribution (hubs with hundreds of nodes included).

The repository's root `.gitignore` ignores any folder named `data/`; this lab's own `.gitignore` re-includes
`public/data/` (the snapshot and the Natural Earth files are needed to run it), and `package-lock.json` for
reproducible installs.

Real-data shape the engine was tuned on: hubs with hundreds of nodes at one location (Helsinki 952, Copenhagen
416, Falkenstein 532), long tails of one to three nodes, and 1,401 apps.

## Tokens, fonts and assets

Colours come from the design tokens, never from the engine: `npm run tokens` copies the `globe`, `tier` and
`hot` blocks of `docs/design/tokens.json` into `src/engine/design-tokens.json` (77 globe tokens at v0.3,
including `moon-*`, `shock-reach` and `shock-reach-emission`) and the whole sheet to `src/lab/design-tokens.css`.
At runtime `tokensFromCss(document.documentElement, engine.tokens)` reads the live `--globe-*` custom
properties, so a theme change reaches the planet. The moon's tonal look and the beams do their arithmetic in
display sRGB, like the design's canvas, and convert on output.

Assets (sources, licences and changes are in `public/licenses/ATTRIBUTION.txt`): NASA Visible Earth Blue Marble
(day), NASA Earth Observatory Black Marble (night) and a NASA cloud composite, all public domain; Natural Earth
1:50m and 1:110m land and countries (public domain) in the world-atlas 2.0.2 TopoJSON packaging (ISC); Montserrat,
Open Sans, Lora and IBM Plex Mono (SIL OFL 1.1, full texts in `public/licenses/`); the official Flux symbol, whose
outline is compiled into `moon/symbol.ts` (a reference copy of the SVG is in `public/brand/`); three.js (MIT).
Nothing is hotlinked at runtime. `npm run textures` rebuilds the images from the NASA sources.

## Screenshots

In `shots/` (WebP, 1600 x 900 unless noted; sheets are contact sheets of frames from one deterministic run):

| File | What it shows |
|---|---|
| `art-marble`, `art-dotmatrix`, `art-neon` | the three art directions, same camera |
| `explore-hud` | the lab with its dev HUD |
| `selection-beacon` | a Frankfurt node selected: beacon, the rest dimmed, peers and links, the fan of individual nodes |
| `constellation` | an app's constellation: member hubs lit, the tree drawn over North America |
| `mesh-flow` | the mesh in `flow` mode, packets and arcs |
| `relay-sheet` (10 frames), `relay-01` to `relay-10` | one block through the relay: flare and shockwave, uplink, the moon receives, dev fund, three downlinks, landings, the next aim |
| `relay-reduced-sheet` | the same under reduced motion |
| `moon-companion`, `moon-chain`, `moon-lite`, `moon-neon`, `moon-hover` | the moon close up, its ring and chain, the lite tier, the neon look, the hover card |
| `moon-orbit-portrait`, `moon-earthrise`, `moon-eclipse` | orbit mode, the cinematic shots |
| `boot-sheet` | the boot (`src/lab/boot.ts`): dashed outlines fill as pieces arrive, the white flash, the reveal wave, lift-off |
| `inset-docked` | a docked window: the globe re-centres, the moon keeps to the free area |
| `mobile-sheet` | a 390 px phone: the relay in portrait |
| `ambient-landing-sheet`, `ambient-hub`, `ambient-web`, `ambient-constellation`, `ambient-earthrise-sheet` | the director's scenes with their overlays |
| `ambient-reduced-sheet` | ambient under reduced motion: stills, the moon parked right of the planet |

To re-shoot: start the dev server, then `node scripts/shots.mjs` (all) or `--only relay` (names containing a string);
add `--gpu` for the real GPU (the default is SwiftShader), `--base` for another URL. It needs `playwright-core` (found in
`../../web/node_modules`, or set `PLAYWRIGHT_CORE`), a Chromium, and ImageMagick (`magick`) for the WebP
conversion and the sheets.

## Porting checklist

Copy `src/engine/` as `web/src/globe/engine/` and `public/textures/`, `public/data/land-*.json`,
`public/data/countries-*.json` to the app's public folder (the engine loads `textures/earth_{day,night}_{2048,4096}.jpg`,
`textures/earth_clouds_2048.jpg` and `data/{land,countries}-{50m,110m}.json` under `assetBase`). Dependencies: `three` only.

- **Entry point:** `GlobeEngine.ts` (`new GlobeEngine(canvas, opts)`, `engine.sink`, `dispose()`).
- **Effect primitives:** `effects.ts` (the `EffectSink` implementation, `RELAY`, `DOWNLINK_ORDER`). Delete its type block and import the types from `web/src/choreo/effects.ts`. `choreographer.ts` is idle unless something calls `enqueue` or `emitBlock`, so the app path never touches it; leave it in (trimming it out means removing its host wiring from `GlobeEngine.ts`).
- **Rendering core:** `post.ts`, `uniforms.ts`, `shaders/chunks.ts`, `fx.ts`, `camera.ts`, `controls.ts`, `tokens.ts` + `design-tokens.json` (or feed `setDesignTokens` from the app's CSS), `types.ts`, `math.ts`, `quality.ts`, `assets.ts`, `assetstore.ts`, `astro.ts`, `activity.ts`, `traffic.ts`.
- **Layers:** `layers/{atmosphere,beams,body,dotmatrix,marble,neon,rays,ribbons,rings,sky}.ts`; **nodes:** `nodes/{clusterLayer,layout,mesh,nodeLayer,picking,store,veil}.ts`; **moon:** `moon/{chain,hud,moon,placement,symbol}.ts`.
- **Ambient (optional as a unit):** `ambient/{director,egg,moonShots,sound}.ts`. If the app does not ship the screensaver, `moonShots.ts` is still used by `viewMoon`.
- **Lab only, do not port:** `src/lab/*` (HUD, fake feed, fixtures loader, gazetteer). Read as references: `src/lab/explore.ts` (hub labels culled around the moon, the moon tooltip card, the dev-fund chip), `aimLabels.ts` (amount labels at the reticles), `ambientOverlay.ts` (counters, captions, route line), `sinkDriver.ts` (the relay through the sink), `boot.ts` (the boot through `setMoonBoot` and `setReveal`), `main.ts` (wiring, `tokensFromCss`, `setBeat` per frame, `setInset` when a card docks).

Mapping from the design's renderer interface (7.12) to the engine:

| Design 7.12 | Engine |
|---|---|
| `mount(el)`, `dispose()` | the wrapper creates the canvas; `new GlobeEngine(canvas)`, `engine.dispose()` |
| `setTokens(t)` | `setDesignTokens(t)` |
| `setNodes(bin)`, `applyDelta(d)` | `setNodes(cols)`, `updateNodes(delta)` |
| `setMesh(edges)` | `setMesh(a, b)`, `updateMesh`, `setMeshMode` |
| `setInset(i, ms)`, `flyTo(target, o)` | `setInset(i, ms)`, `flyTo` / `flyToNode` / `flyToCluster` |
| `select`, `hover(id)` | `select(id, opts)`, `setHover(id)`; focus modes: `setFocusOnly`, `setWatched` |
| `setFocusSet('app', ids)` | `showAppConstellation(ids)` |
| `play(e)` | `engine.sink` (preferred) or `enqueue(event)` / `emitBlock` (the lab choreographer) |
| `project(id)`, `labelAnchors()` | `projectNode(id, out)`; labels are built from `getHubs()` + `project()` + the app's place names |
| `setAim`, `clearAim` | `sink.aim`, `sink.clearAim` |
| `setMoon`, `moonState`, `moonClick`, `setBeat`, `setMoonBoot`, `setReveal`, `setReduced` | same names |
| `setMode('ambient')`, `ambient.start/stop/next` | `setMode('ambient' \| 'explore')`, `engine.ambient.*`; archive: `setMoonStatus('archive')` |
| `on('hover' \| 'select' \| 'cameraChange' \| 'zoomBand' \| 'frame' \| 'pickCluster' \| 'moonhover' \| 'moonclick')` | the same events |
| `stats()` | `engine.stats` (a live object) |

## Limits and honest notes

- No Canvas2D fallback: without WebGL2 the constructor throws `GlobeUnsupportedError` (the lab prints a message). The design mock is that fallback's reference.
- The design's "Density" glow layer (hex-bin heat texture under the points) is not built; the stacks and the night lights carry density.
- `labelAnchors()` (city and country labels) is not in the engine: it has no place-name data. The lab's `explore.ts` shows the pattern with a small gazetteer.
- Flow-layer packets are sampled from real peer links of the snapshot (thirteen thousand sampled edges); it is not a live traffic capture.
- The relay, shockwave and moon were checked against the design's numbers by measuring timings and rendering sequences, not pixel by pixel; one place the lab deliberately differs from the design: in ambient mode the moon is in world space (the project brief's request), while the design's camera-locked companion is the explore default. Both are implemented and blend over 900 ms.
- Performance on integrated GPUs and phones is not measured (see Performance).
- The aim reticles and dev-fund chip positions are reported in canvas pixels; the app must place its DOM from them each frame (`aimAnchors()`, `moonState()`, the `devfund` event).
- `moon-eclipse` and `moon-earthrise` depend on where the moon is in its orbit; the ambient director only plays the eclipse when the planner's cost is low, so it is not shown on a schedule.
