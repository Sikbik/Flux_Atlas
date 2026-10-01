# Reel notes for R1 (from the globe lab session; work so far, decisions, pitfalls)

All paths are under `/home/stache/Projects/Flux_Atlas/labs/globe/`. `clips/` is gitignored. Nothing here is committed.

## What exists

| File | What it is |
|---|---|
| `clips/recording-2026-10-01T01-11-42Z.json` (4.4 MB) | A recording of the LIVE Flux Atlas server (ws://127.0.0.1:3100/ws), 01:11:42 to 01:21:42 UTC on 2026-10-01: 20 real blocks (2997577 to 2997596), 425 WS messages (block, next_payees, mempool, nodes, mesh, apps, feed, stats), the nodes.bin snapshot (6,732 nodes, base64), mesh.bin (80,435 peer links, base64), the 60 busiest apps with instances, and `nodeGeo` (region, country, org for 83 nodes, from `/api/v1/nodes/<id>`). The server at 3100 is released: do not depend on it, render from this file. |
| `scripts/record-live.mjs` | The recorder (re-run only if a fresh recording is wanted; `--enrich <file>` adds `nodeGeo`). |
| `scripts/virtual-time.js` | A virtual clock injected before page scripts (`page.addInitScript`): replaces performance.now, Date, setTimeout/Interval, rAF, requestIdleCallback; seeded Math.random. API: `__vt.advance(ms)`, `__vt.setWall(epochMs)`, `__vt.realRaf`. CSS transitions/animations cannot be virtualized: the overlay must write styles from the frame number. |
| `src/lab/cinema/bin.ts` | Decoders for nodes.bin (FXAT) and mesh.bin (FXMS) (copied logic from `web/src/api`), `ENGINE_STATUS = [0,1,2,4,3,3,3]`. Node-strippable (no parameter properties). |
| `src/lab/cinema/recording.ts` | `loadRecording`, `class World` (columns for `engine.setNodes`, `meshEdges()`, `place(id)`, `topSites(n)`), `blocksOf`, `nextPayeesOf`, `describeBlock` (producer, payees with places, aimed/next payees), `fmtInt/fmtFlux/fmtUtc`. TODO still open: add `nodeGeo?` to `RecordingFile` and a `region` label to `Place` (nodes.bin has NO city names; use region + country, never invent a place). |
| `src/lab/cinema/cam.ts` | Free-camera helpers: `Pose`, `surfacePose(lat, lon, heading, range, tilt, fov, out, lift)`, `mixPose`, `applyPose(rig, pose)`, easing. |
| `src/lab/cinema/cinema.css`, `cinema.html` | Typography/layout in vh units (no CSS transitions) and the page shell: `#stage` with `#under`, `#globe`, `#fx`, `#dim`, `#overlay`, `#black`. `main.ts`, the film script, overlay and compositor are NOT written. |
| `scripts/shots.mjs` | Deterministic screenshot harness (virtual clock option `vt: true`, GPU flags with `--gpu`, `--fresh` per-shot browser, retry on GPU hiccups). Good reference for the page set-up and stepping loop. |

## Facts that decide the film

- GPU: `--enable-gpu --use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist` gives the real RX 9070 XT (ANGLE Vulkan, RADV). Chromium: `/usr/bin/chromium`; playwright-core from `web/node_modules`.
- Engine stepping: `engine.pause()` after a few virtual frames (the engine's own `applySize()` runs only in its rAF `frame()`), then `engine.stepFrame(1/60)`. Wait for `engine.assets.ready` before starting. Math.random is seeded by the virtual clock script; check determinism by hashing the same frame in two runs.
- Ambient mode: `engine.setMode('ambient')`, then call `engine.director.interrupt()` every frame to keep the director's scenes off, and drive a free camera yourself: `rig.setFree(pos, look, up, 1e6, 1e6); rig.snapFree(true); rig.baseFov = rig.fovV = rig.camera.fov = fov`. `engine.shots.planWide(moon, pts, aheadSeconds, fovV, aspect)` is the director's wide landing frame (producer, moon and payees in one view); `engine.shots.earthrise(moon, p01)`, `.eclipse(p01)` (after `planEclipse(...)`), `.follow(...)`, `.portrait(...)` give the moon shots.
- Beat driving: call `engine.sink` commands yourself on the film clock. Timeline (seconds after the beat starts), from `RELAY` in `src/engine/effects.ts`: 0 `beat` (producer flare, pillar, shockwave); 0.06 `uplink` (flight 0.72); 0.78 `moonFlare` all (900 ms, the seal; adds the bead); 0.83 `moonFlare` piece `bar`; 0.95 `devFund`; per output in order dev, cumulus, nimbus, stratus: flare piece 0.06 before the beam, `downlink` at 0.89 + 0.13 i (flight 0.9), `payoutLanded` 0.04 before arrival (landings at +1.88 / 2.01 / 2.14); heartbeats from 1.6 s in 100 ms batches; `aim` (next payees) at 2.6. `src/lab/sinkDriver.ts` is a working reference (it uses timers: schedule on the film clock instead). Pieces: bar = dev fund, small hex = Cumulus, big hex = Nimbus, cap = Stratus. Engine ids are server ids + 1.
- Real data rules from the brief: only recorded events; compress idle time BETWEEN real events but keep each Beat's internal timing; mempool whispers from the recorded mempool messages (`engine.enqueue({ type: 'mempool', count, seed })` needs mesh mode `flow`); heartbeats from the block's `heartbeats` ids; payee place = recorded region + country (no city is recorded; never invent one).
- Featured block: **2997581** (01:14:04 UTC): producer Virginia US (39.0, -77.3); Cumulus Capital Region DK 1.00, Nimbus South Holland NL 3.50, Stratus Uusimaa FI 9.00, dev fund 0.50; 12 heartbeats; `next_payees` for 2997582 recorded. A natural second Beat for the "chain grows by one" shot is **2997582** (01:14:34): producer Uusimaa FI, payees PACA FR, Saxony DE, Uusimaa FI; its payees are exactly the reticles the first Beat's `aim` draws, so the aim visibly pays off.
- Sun: freeze it at the block's real time: `engine.setSunTime(Date.UTC(2026,9,1,1,14,4))`. At that instant the sunset line is at about 108 W and the dawn line at 71 E: the Atlantic, the US east coast and Europe are all on the NIGHT side (lights, glow, good for beams).
- Moon phase (the only non-literal element, disclose it in the report): the moon orbit period is 420 s and `clock = (Date.now()/1000) % 420`. At the real time of 2997581 the moon is over the Pacific (theta 209 deg), behind the planet for an Atlantic shot. Shift the virtual wall clock so the moon sits over the mid-Atlantic (theta about 90 deg is lat 27 N, lon 20 W at radius 2.05): `__vt.setWall(...)` to a time whose `(s % 420) = 105`, for example 2026-10-01T01:11:45Z, and pass the chain history to `engine.seedMoonChain` with the SAME shift added to every block time (so beads sit where the moon was when each block sealed). Sun, block data, places, amounts and the displayed clock stay real. Over 15 s the moon moves only 13 deg.
- Real blocks whose real moon phase is already near 90 deg: 2997589 (55 deg, Finland producer, payees ZA/UA/FI), 2997590 (81 deg, Oregon producer, payees FR/FI/DE). 2997581 reads best geographically.

## Shot plan I had (15.0 s, 60 fps, 900 frames; adjust freely)

1. 0.0 to 2.2 Marble, night-side Atlantic hero, slow push-in, mesh flow starting, moon in sky. Mark and UTC clock.
2. 2.2 to 5.4 THE BEAT of 2997581 (planWide-style framing with a slow push). Shockwave-ring conversion Marble to Neon or Holo centred on the moon at the seal (0.78 s into the Beat). Payout pins "Denmark +1.00 FLUX", "Netherlands +3.50 FLUX", "Finland +9.00 FLUX", block height odometer.
3. 5.4 to 7.0 Holo: mesh flow, "80,435 live peer links" (real count from mesh.bin), scan-wipe conversion.
4. 7.0 to 8.6 Neon: datacenter towers / hub fly-over (`world.topSites(n)`), caption with the real node count at the site.
5. 8.6 to 10.0 app constellation (`engine.showAppConstellation(ids, { name })`), real app and instance count.
6. 10.0 to 11.6 second Beat 2997582, macro on the moon: the chain gets one bead longer; odometer rolls 2,997,581 to 2,997,582.
7. 11.6 to 13.0 earthrise / eclipse moon shot (check `planEclipse` cost with the shifted phase; skip eclipse if cost > 1.2).
8. 13.0 to 15.0 moon hero, Flux logo lockup in brand colors only (`assets/brand/flux/logo/Flux_logo_blue_white.svg`, symbol `#2B61D1` and white), provenance line "Live Flux network · block 2,997,581 · 2026-10-01 01:14 UTC".
- Conversions: two renders per frame during a transition (`stepFrame(dt)` in art A, copy the canvas to a 2D canvas, `setArtDirection(B)`, `stepFrame(0)`), then a CSS mask / 2D composite: ring from a screen point (shockwave), vertical scan line (Holo), whip cross-dissolve. `stepFrame(0)` is idempotent for the engine state.
- Render path: CDP PNG screenshots (`optimizeForSpeed`) at DPR 2 (3840x2160) then ffmpeg downscale to 1080p/1440p, libx264 crf 14-16 preset slow yuv420p +faststart (ffmpeg n9.0.2 also has libsvtav1). Pre-warm all three art bodies (`setArtDirection` each once) before frame 0, and pre-roll the engine a few seconds so mesh traffic is alive at frame 0.
- Fonts (brand): Montserrat (display), Open Sans, Lora italic, IBM Plex Mono: `src/lab/fonts.css`, `design-tokens.css`.

## The look is being restyled right now

The moon, wake, beads, beams, landing sparks and dev-fund pulse are being restyled in `src/engine/**` by this session. Render the final only after "style frozen" (the coordinator will relay it). Until then expect the engine files to change under you: work on your own copy of the lab.
