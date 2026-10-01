# Flux moon style pass: hand-over for G2

Lab only. Nothing under `web/` was touched and there is no web patch for this pass (the earlier trail patch,
`clips/moon-trail-web.patch`, is already in the app as eea0241). All paths are under
`/home/stache/Projects/Flux_Atlas/labs/globe/`. `clips/` is gitignored; nothing here is committed.

The look only makes sense for a moon that lives in world space on a fixed orbit, because the wake and the beads are
drawn along the orbit behind the moon (angles `theta`, basis `e1`/`e2`, radius `orbit`). That is what the lab's `moonmode=orbit`
does and what you are building. `hud.ts` (the screen-space companion) got the same ribbon and beads in CSS pixels
so the shell is consistent until it is replaced; port the world-space parts first.

## 1. What changed, in one screen

| Element | Before (trail pass) | Now |
|---|---|---|
| Wake | hairline orbit trail | A comet's tail, not an orbit segment: it starts at the moon's trailing edge (nothing of it crosses the mark), is brightest and widest right there and thins hard to nothing over about 26 degrees (about half of it is visible); thin white-hot core, Flux blue body, soft glow; a slow shimmer flows backward and a pulse of light runs down it on every seal. Real geometry, constant width in CSS px, DPR-aware. |
| Beads | flat hexagons on the path | Tiny glowing hex glyphs, one per real sealed block: born with a white flash, kicked out from behind the moon in 1.5 s, then fall back along the orbit with a slight tumble, cooling white to Flux blue and fading like embers. Uneven by construction (block times), never a ring. |
| Moon body | one glass, one look | Three finishes, eased between (about a second): Marble = frosted glass with a key light and polished chamfers; Holo = dot-matrix hologram (hex lattice of round dots, LOD-blended, never swims); Neon = tubes of light with a second inner tube and a saturated Flux-blue halo. Idle breathing in all three. |
| Flares | soft swell | Crisp: the edge ignites white-hot, a band of light sweeps across the face, the face lifts a little. Ignition is an ease over about 85 ms; overlapping flares build on each other (no dip). |
| Seal recoil | each piece jumped 4.5 px in one frame (at the wide landing shot) | The push arrives over about three frames (25 ms time constant: 2.4, 1.1, 0.4 px) and settles back as before; half as much on the hologram, none under reduced motion. Same peak, no one-frame teleport. |
| Beams | thin lines | Fast comet streaks: white-hot head with a four-point star and halo, tapered tail (about 30% of the route, 70..340 px), faint hairline of the whole route that drains after landing. Arcs above the surface. Uplink arrives exactly at the seal (0.78 s). |
| Landing | ring | Ring plus a six-point spark. |
| Dev fund | (nothing distinct) | A white pulse with a light-blue tail that drifts out into space from the bar (no tier color), clearly not a payout. |

Timing is untouched (beat contract, `RELAY` in `src/engine/effects.ts`). The only timing-adjacent edits: the uplink head
now arrives at the seal instead of 0.3 s after it, and downlink heads keep a fifth of their way at constant speed so
they land moving instead of hovering. Both are visuals; arrival times are the contract's.

## 2. Files (all in `src/engine/`)

| File | What changed |
|---|---|
| `moon/chain.ts` | Rewritten. Wake ribbon + ember beads (world space). `update(now, e1, e2, orbit, moonTheta, moonSize, wakeA, alpha, pulse, motion)`; `moonSize` is the moon's actual world height (`o.size * scaleNow`). New exports `beadHash`, `beadDrag`, `beadKick`, `beadTumble`; `companionBeads` writes 8 floats per bead. |
| `moon/moon.ts` | New `glass()` with three finishes (`marbleFront`, `holoFront`, `neonFront`, `flareFront`), key light, chamfer lighting, graze fades; art weights (`artW/artT`, `setArt`); crisp flare envelope (`flareShape`, `flareAttack`) and continuous retrigger; the piece kick follows its target with a quick attack (`kickS`); `uMotion`; anchor 5 (dev pulse target); halo scaled per finish; wake/bead call. |
| `moon/hud.ts` | Companion (screen-space) ribbon and beads: same shapes in CSS px (this path is being replaced; port only if you keep it). |
| `layers/rays.ts` | Rewritten. World-space beams: constant-pixel ribbon + camera-facing head sprite. `RayKind = { Beam, Guide, Down, Drift, Still }` (`Still` is added to a kind under reduced motion). |
| `layers/beams.ts` | Companion beams: tapered tail, fainter route, head star; the strip now runs 30 px past both ends so a head at an end keeps its halo (was cut square). |
| `layers/rings.ts` | `RingKind.Spark` (11): camera-facing six-point star. |
| `shaders/chunks.ts` | `waveGlow` (the block shockwave on the planet bodies) restyled: a soft swell with a trailing wash that ends as a glow, instead of the design's 1.4 px white hairline (see section 3, "The thin ellipse"). Shared by all three art directions. |
| `fx.ts` | `ray(..., kind)`, uplink arrives at the seal, `downlink` uses `RayKind.Down`, `sparkPx`, `devPulse`; reduced motion uses `Still`. |
| `effects.ts` | Landing spark in `payoutLanded` (non-reduced branch); `devFund` calls `fx.devPulse()` when the moon exists. |
| `GlobeEngine.ts` | `moon.setArt(art)` in the constructor and in `setArtDirection`. |

Diffs: `clips/moon-style-delta.diff` is the style pass only (the lab engine as it was before this pass, which already had the
trail pass, against now; paths are `a/engine/...`, so `patch -p1 < clips/moon-style-delta.diff` run in `labs/globe/src/` on the pre-pass
tree reproduces the lab engine exactly, and it is the file to read when porting). `clips/moon-style-lab.diff` is
`git diff -- labs/globe/src/engine` against HEAD 43c504c (it also contains the trail pass, which the app already has as eea0241).

## 3. Techniques worth porting

**Constant-pixel ribbons that never vanish (wake, ray tails).** The vertex shader widens a strip in screen space and
compensates energy when a part would be thinner than a pixel and a half:

```glsl
float head = clamp(uHeadW * uProjScale / c.w, uWidthPx.x * uPxScale, uWidthPx.y * uPxScale); // px at this distance
float w    = head * pow(max(1.0 - u, 0.0), 1.2);          // taper to nothing
float wEff = max(w, 1.7 * uPxScale);                      // never thinner than ~1.7 css px
gl_Position.xy += perp * side * wEff * 2.0 / uViewport * c.w;
vSU.z = clamp(w / wEff, 0.0, 1.0);                        // energy kept: the fragment multiplies by it
```

**Analytic limb fade instead of a depth cut.** Anything that will pass behind the planet fades out first, so there is
no popping or aliased cut at the limb (closest approach of the camera-to-point segment to the unit sphere):

```glsl
vec3 D = P - cameraPosition;
float tt = clamp(-dot(cameraPosition, D) / max(dot(D, D), 1e-4), 0.0, 1.0);
float vis = smoothstep(1.0, 1.07, length(cameraPosition + D * tt));   // rays use 1.0 .. 1.045
```

**The wake is a comet's tail.** Root at the moon's trailing edge (`start = 0.42 * moonSize / orbit` radians behind the centre; the
pieces hide its first few percent, so nothing crosses the mark), width `head * (1 - u)^1.5`, light `(1 - u)^2.8 * smoothstep(0, 0.07, u)`,
across the ribbon a thin white core `exp(-a^2 / 0.03)`, a body `exp(-a^2 / 0.14)` and a soft glow `exp(-a^2 / 0.6)`; head half width
`0.07 * moonSize` clamped to 2.2..8 CSS px. Over 26 degrees (0.46 rad) it is gone, and about half of that is visible.

**The thin ellipse in the wide frames is the block's shockwave, not an orbit guide.** It is the Beat's ring expanding over the planet from
the producer (Virginia in the hero block), 62 degrees in 1.7 s (`fx.waveFrom`; with it switched off the ellipse is gone, switching the
rays off changes nothing). The design's front was a 1.4 px white hairline, which from far away looks like a drawn orbit. It is now a
soft swell: a 40 px swell, a 16 px shoulder, a wash that trails behind the front (smooth across the front, no step) and a sharp 5 px band
plus hot core that only the young wave has (`crisp = (1 - t)^2`), so it starts as a crisp front and ends as a glow. Nothing in the engine
draws an orbit or a HUD path in sky mode; the moon's path is implied only by the wake and the beads. The route hairline of a beam
(a persistent afterglow of its path) now cools with distance behind the head (`exp(-(headT - t) * 3.2)`), so a beam never leaves a
uniform wire across the planet. Under reduced motion the same kind of ellipse came from somewhere else: `RayKind.Still` lit the whole
uplink route from the producer to a parked moon, a thin arc around the planet's left half. A still ray now lights only the end of its
route (the tail a flight leaves at its arrival, 80 to 380 px), so no long thin curve is drawn in any mode.

**Thin lines get a floor in pixels.** Every outline uses `fwidth` for its minimum stroke (`lw = max(0.1, 1.35 * fwidth(d))` on
the bead hexagon, `max(1.4, 1.1 * g_fw)` on the Neon tube core, `max(1.15, 1.3 * g_fw)` on the Marble rim), so nothing
shimmers when it is smaller than a pixel. `g_fw` (symbol units per pixel) is computed first in `main()`.

**Walls seen edge-on must not sparkle.** A side wall collapses to a sliver at grazing angles and its bright lip lines turned
into a dotted line (seen in Neon at 2.2 s of the seal sequence). All wall lips, glints and the flare on walls are multiplied by
`graze = smoothstep(0.03, 0.26, ndv)`; the bevel highlight by `smoothstep(0.0, 0.15, ndv)`.

**Bead glyph.** Camera-facing quad, analytic pointy-top hexagon (`max(p.x, dot(p, vec2(0.5, 0.866))) - 0.866`), a second smaller
hexagon (x2.1) at 45% for "a block within the block", a soft core and halo, white flash `* 1.5` at birth. Position:
`theta - beadDrag(age) - kickRad * beadKick(age)`, with `kickRad = 0.62 * moonSize / orbit` and a cubic ease over 1.5 s.
**The kick matters:** a bead born at the moon's centre sits behind the pieces for ten seconds as a fragment of a hexagon.

**Marble.** Studio key light in the moon's own frame, `KEY = (-0.4, 0.62, 0.67)`: a diagonal gradient across each face
(`gk = 0.5 + 0.45 * dot(fromC, KDIR)`, body `0.11 + 0.2 pool + 0.52 gk^2` of a blue between Flux blue and the piece's tone), light
piping where the glass is thin (`1 - smoothstep(0, 46, inner)`), a soft-box reflection (`pow(dot(reflect(-V, N), KEY), 16)`) and a
sharp streak (`^90`), etched hexagons in two parallax layers that wake with the seal, a crisp white rim line strongest on
the key side, and chamfers lit like polished edges (`keyB = pow(max(dot(N, KEY), 0), 1.5)`; deep blue on the far side).

**Holo.** Hexagonal lattice of round dots anchored in object space (`P = 7 * 2^level` symbol units), two adjacent levels blended by
the pixel size (`want = log2(g_fw * 4.4 / 7)`) so the pitch stays near 4.5 px at any distance without a pop. Dot radius and
brightness follow a light level (rim, key, a broad diagonal band every ~9 s, a soft climbing band, the seal ring, flares); each dot
breathes on its own phase. No hard scan line: it crawled and aliased.

**Neon.** `core = exp(-(inner / wc)^2) * min(1, 1.6 / wc)` white-hot, halo1 `exp(-inner / max(9, 3 g_fw))` mixed to Flux blue,
halo2 `exp(-inner / 30)`, a second thinner tube 15 units inside, walls dark with lit lips; a saturated Flux-blue halo billboard
(1.4x) so the bloom reads blue, not white.

**Flare envelope.** `flareShape(u, a) = u < a ? 1 - (1 - u/a)^2 : (1 - (u-a)/(1-a))^2.2` with `a = clamp(0.085 / dur, 0.1, 0.35)`
(ignition about 85 ms, five frames). A retrigger starts the new envelope from the light already there
(`t0 = now - a * (1 - sqrt(1 - cur/strength)) * dur`), so overlapping flares never dip to dark first.

**A kick is a push, not a teleport.** A seal (strength 0.4) and every piece's own flare (0.7) kick the piece out along its direction
(`kick * 9` symbol units, `kick * 4` in depth) and it settles back with `kick *= exp(-dt / 0.22)`. The original applied the whole kick in
the frame it was set: 4.5 px in one frame at the wide landing shot, a teleport on glass and, on the Holo dot lattice, a one-frame change of
the picture (the mean absolute error between two frames of the moon crop was 0.25, against 0.008 at rest). `kick` is now a target that
`kickS` follows with a 25 ms time constant (`kickS += (kick - kickS) * (1 - exp(-dt / 0.025))`): the piece is pushed 2.4, 1.1 and 0.4 px
over three frames and settles as before. The gain of 1.25 keeps the original peak, the hologram recoils half as much (a projection is not
a body), and a reduced-motion viewer gets no recoil. Measured in section 6.

**Beam heads.** The head sprite is lifted 0.045 world units toward the camera (`P += normalize(uCamPos - P) * 0.045`): it does not
move on screen but it no longer sinks into the glass when it leaves or lands on a moon piece. The ribbon's head end is rounded
(`cap = sqrt(1 - x^2)` over the last 14% of the tail) and the tail narrows and fades as it drains after landing.

**Blending.** All additive layers use One/One on colour and Zero/One on alpha: the moon's exempt mask lives in alpha (`post.ts`).
In the 900 ms blend the mark flies from the companion's place to the sky while the world-space wake is anchored to the destination, so
the wake is gated to the last part of the blend (`smoothstep(0.72, 1, e)`, `e` the eased blend weight) and the companion's wake lets go
over the first (`1 - smoothstep(0, 0.3, e)`): a mark in flight has no wake, and nothing waits for it at its destination.
The beads are not attached to the mark and cross-fade with `e`.

**Reduced motion.** `uMotion = 0` freezes every time term (bands, shimmer, tumble, breathing); the wake pulse, bead kick and piece
recoil are off; world beams use `RayKind.Still` (no head flies: the tail a flight leaves at its arrival, the last third of the route,
at most 380 px, is lit at once and fades in and out, like a comet frozen at its destination); brightness flashes remain. The first
version lit the whole route, which for the uplink to a parked moon was a thin ellipse drawn around the planet's left half: never light a
whole long route.

## 4. Tuned parameters and colors

Brand colors only: Flux blue `#2B61D1`, mid `#547FD9`, light `#92ADE5`, wake body `#86A1DA`, white for hot cores. No tier color on the moon.

| Item | Value |
|---|---|
| Moon (lab defaults) | size 0.36 globe radii, orbit 2.05, inclination 27 deg, node -20 deg, period 420 s |
| Wake | length 0.46 rad (26 deg) from the root, 56 segments, root 0.42 moonSize behind the centre (the trailing edge); head half width 0.07 moonSize clamped 2.2..8 CSS px, never under 1.6 px (energy kept); width taper `(1-u)^1.5`, light taper `(1-u)^2.8` with a 7% fade-in at the root |
| Wake light | white core `exp(-a^2/0.03) * 1.7 (1-u)^2.2`; body `#86A1DA * exp(-a^2/0.14) * 0.5`; glow `#2B61D1 * exp(-a^2/0.6) * 0.55`; shimmer `1 + 0.35 sin(2pi(1.8u - 0.5 t))(0.3 + 0.7u)`; brightens 1.5x with a seal |
| Seal pulse | gaussian sigma 0.1 along the wake, runs 0.9 s to 0.9 of the length; core +1.3, body +0.7, glow white +0.2 |
| Beads | at most 24, life 0.4 of a lap (168 s); circumradius `0.078 moonSize * sizeK` (sizeK 0.78..1.18 per block hash), x1.5 at the birth flash, shrinks to 55%; pop `easeOutBack` over 0.32 s; flash `exp(-age/0.9)`; drag `0.13 (1 - e^(-age/42))` rad; kick 0.62 moonSize over 1.5 s; tumble `(seed - 0.5) 0.9 + 0.8 sign (1 - e^(-age/14))` rad; scatter `0.3 moonSize (0.1 + 0.5 f)` |
| Bead glyph | outline `max(0.1 (1 - 0.45 age), 1.35 px)`; inner hexagon 0.476 scale at 45%; hue `#86A1DA` to `#2B61D1` over age 0.1..0.9 |
| Marble | KEY `(-0.4, 0.62, 0.67)`, dome curvature 0.46, body `0.11 + 0.2 pool + 0.52 gk^2`, thin glow 46 units, soft-box `^16 * 0.55` and `^90 * 0.9`, rim `0.42 + 1.5 edgeLit`, halo x1.0 |
| Holo | dot pitch 7 units (LOD), radius `mix(0.1, 0.35, L)`, band every ~8.7 s (sigma 0.13), soft climbing band 0.3 / sigma 26, dot breathing +-10% at 0.75 rad/s, halo x0.75 |
| Neon | core width `max(1.4 units, 1.1 px)` (`wc = max(1.4, 1.1 g_fw)`, units are symbol units, `g_fw` is units per pixel), halos 9 units (floor 3 px) and 30 units, inner tube at 15 units, breathing +-7% at 0.55 rad/s, halo x1.4 |
| Idle breathing | Marble glow +-8% at 0.7 rad/s and rim +-12% at 0.43 rad/s; assembly drift (`breath` 0.3, 15 s cycle) |
| Piece kick | target 0.4 at a seal and 0.7 at a piece flare (the larger wins), decay 0.22 s; the drawn value follows with a 25 ms time constant, gain 1.25 (hologram x0.5), `* 9` symbol units out and `* 4` in depth; none under reduced motion |
| Flares | ignition 85 ms; seal `flareAll(0.55, 0.7)`; sweep sigma 0.13 of the piece, edge `exp(-inner/max(1.5, 1.3 g_fw)) * 3.4` |
| Rays | tail 34% of the route clamped 80..380 px (CSS px scaled), half width `widthPx * 1.7`, `lit = k^1.35`, hot term `k^4 * 2.6`; head sprite 32 px radius, halo `exp(-r^2/130) * 0.8 + exp(-r/14) * 0.16`, core `exp(-r^2/8) * 3.6`, star arms; route hairline `0.14 * exp(-(headT - t) * 3.2)` draining over 0.6 s; downlink ease `0.8 easeOutCubic + 0.2 linear` |
| Uplink / downlink / dev pulse | width 3.2 / 2.3 / 2.0 px, intensity 1.9 / 1.8 / 1.3 |
| Landing spark | 4 to 38 px over 0.5 s, intensity 1.6 |
| Art blend | finishes ease with a 0.3 s time constant; `setArt(art, true)` snaps |
| Companion to sky blend | 900 ms (design); sky wake alpha `smoothstep(0.72, 1, e)`, companion wake `1 - smoothstep(0, 0.3, e)`, beads cross-fade with `e` |

## 5. Frame sequences that show it

Run from `labs/globe/` with a dev server (`npm run dev -- --port 5450`):

```
node scripts/shots.mjs --base http://127.0.0.1:5450 --gpu --fresh --only '<regex>' --out <dir> --prefix <p>
```

The two numeric checks of section 6 are `scripts/moon-checks.mjs`; to compare two builds serve the old tree on another port (the
first base is printed first):

```
node scripts/moon-checks.mjs bench   --base http://127.0.0.1:5451,http://127.0.0.1:5450
node scripts/moon-checks.mjs shimmer --base http://127.0.0.1:5451,http://127.0.0.1:5450 --art all [--seal]
```

Shot names (all deterministic: virtual clock, the moon at phase 90 degrees, the recorded Virginia to Denmark / Netherlands / Finland block):

| Name | What it shows |
|---|---|
| `seal-sky-<art>`, `sealzoom-sky-<art>` | 12 frames around a seal (0.62 to 2.7 s): the wide landing frame and a close crop of the moon |
| `seal-companion-<art>`, `sealzoom-companion-<art>` | the same on the shell's companion moon |
| `seal-sky-reduced-<art>` | reduced motion in the sky (marble, dotmatrix) |
| `trail-sky-<art>`, `trailzoom-sky-<art>`, `trail-companion-<art>`, `trailzoom-companion-<art>` | the wake and the seeded chain of beads |
| `trail-blend`, `trail-blend-dense` | the 900 ms blend from companion to sky (four frames; ten frames of the part around the planet's upper left) |
| `look-night-<art>`, `look-sun-<art>` | the moon at rest, macro, night side and sunlit |
| `art-switch-*` | switching the art direction live |

Art directions: `marble`, `dotmatrix` (Holo), `neon`.

Kept in `shots/` (139 files, 22 MB, all untracked; the `*-sheet.webp` files and the compare strips are what to look at, the numbered
frames are for zooming): `style-before-*` (the lab engine before this pass; sequences are the pre-style frozen copy) and `style-after-*`
(final). Start with `style-compare-sealzoom-sky-<art>.webp` (before row over after row, frames 1, 4, 6, 8, 10, 12 of the seal),
`style-after-sealzoom-sky-<art>-sheet.webp` (12 frames of the moon around a seal), the wide `style-after-seal-sky-<art>-sheet.webp`,
`style-after-trail-blend-dense-sheet.webp` (the 900 ms blend) and `style-after-look-night-<art>.webp` / `style-after-look-sun-<art>.webp`
(the moon at rest). `style-nogate-trail-blend-dense-sheet.webp` is the same blend with the wake waiting at the destination (the previous
behavior, and what the pre-style engine did). The four `style-wip-*` files are the first strips that were sent for review, overwritten with the final frames.

## 6. Checks and results

Everything here ran on the final tree (`clips/moon-style-lab.diff`) except the GPU timings, which were taken before the last three small
edits (the piece-kick smoothing, the wake gate in the blend, the tail of a still ray: CPU-side scalars and one shader term that only
reduced motion uses, none of which can change the cost). Chromium on the real GPU (ANGLE Vulkan, RX 9070 XT, shared with other
agents), 1600x900 unless noted, on the virtual clock (`scripts/virtual-time.js`) so every frame is deterministic. The two numeric checks
are `scripts/moon-checks.mjs` (`bench`, `shimmer`), which can compare two builds served on two ports.

**Gates** (in `labs/globe/`): `npm run typecheck`, `npm run build` (only the existing chunk-size warning) and `npm run check:sink` pass.
`web/scripts/globe-check.mjs fps` was not run: the app does not have any of this.

**GPU cost** (`moon-checks.mjs bench`: `engine.benchmark(180)`, a forced render with a GPU sync per frame, 2560x1440, DPR 1, a beat in
flight 1.2 s in; ms per frame, the slower of two trials; the lab engine before this pass | after):

| | Marble | Holo | Neon |
|---|---|---|---|
| Sky (world-space moon) | 1.48 \| 1.83 | 2.09 \| 1.96 | 1.91 \| 1.94 |
| Companion | 2.29 \| 2.24 | 1.91 \| 2.30 | 1.83 \| 1.95 |

The two sides differ by less than the run-to-run noise of a shared GPU (up to 0.4 ms, no consistent direction), and a whole frame is
about 2 ms at 1440p: more than 8x of headroom for 60 fps on this card. Everything added is small quads and thin strips, so the cost
follows the moon's screen area. Not measured on a phone or an integrated GPU.

**Shimmer** (`moon-checks.mjs shimmer`). The orbit is frozen and the camera fixed, so only the moon's own shading changes from one
frame to the next. The series is the mean absolute error between consecutive frames of a 200x200 CSS px crop around the moon at DPR 2;
a crop of empty sky (the noise floor) gives 0.0037 to 0.0047. The lab engine before this pass | after:

| | Marble | Holo | Neon |
|---|---|---|---|
| At rest (90 frames), median | 0.0061 \| 0.0062 | 0.0061 \| 0.0077 | 0.0062 \| 0.0063 |
| At rest, largest step between neighbouring frames | 0.0018 \| 0.0008 | 0.0018 \| 0.0001 | 0.0019 \| 0.0001 |
| A seal (150 frames, 2.5 s), largest one-frame change | 0.125 \| 0.065 | 0.125 \| 0.136 | 0.126 \| 0.078 |

Idle breathing is invisible from frame to frame (at most 0.0016 above the pre-style moon crop) and the series is flat: no spikes, no
crawling lines. In a seal the largest change is the ignition of a flare plus the push of the pieces. It is half of what it was in Marble, 60% in
Neon and the same in Holo, where a dot lattice shows every pixel of a push (before the push was smoothed, and halved for the hologram,
the same figure was 0.255). The worst frame used to be the last piece's flare (1.1 s into the beat); it is now the seal itself, whose
ignition is meant to be sharp (35% of its height in the first of five frames).

**The planet's limb.** The moon passes behind the planet with a clean, antialiased cut; the wake and the beads fade out analytically
before the limb (no pop, no aliased depth cut); the Neon halo is not clipped by the planet.

**Flare continuity.** Sampled every frame through an ignition, the flare strength ramps over about five frames (85 ms) and overlapping
flares never dip (Marble in the sky, Neon on the companion). The previous envelope jumped from 0.08 to 0.62 in one frame.

**Reduced motion.** `seal-sky-reduced-marble` and `seal-sky-reduced-dotmatrix`: beams are `Still` (the end of the route lit at once, fading
in and out), no bead kick or tumble, no piece recoil, no shimmer, bands or breathing; the companion's ribbon and beads are static. The
beat's timing is the same.

**Art direction.** Switching live (`art-switch-marble-neon`, `art-switch-neon-dotmatrix`) eases over about a second. The dip while the
planet's own look swaps is the engine's (not the moon's).

**Found in the frame sequences and fixed.**

- Newborn bead showed as a bracket fragment behind the pieces: now kicked out of the moon (`beadKick`), smaller.
- Neon: a dotted line on a wall seen edge-on (sparkle): graze fade on lips, glints and flares.
- Companion dev pulse: the head's halo was cut square by the end of the screen-space strip: the strip runs 30 px past both ends.
- Flare ignition jumped in one frame: eased envelope with continuous retrigger.
- The uplink head sank into the glass on arrival: the head sprite is lifted toward the camera.
- Downlink heads hovered before landing: a fifth of the way at constant speed.
- The wake read as a uniform bar crossing the mark (coordinator's review): now a comet tail from the trailing edge, thinning over 26 degrees.
- The thin ellipse across the planet in the wide frames (coordinator's review): the block shockwave, restyled (section 3). The reduced-motion
  frames had a second one: the uplink route lit whole by `Still`; now only its end.
- The 900 ms blend: the wake waited at the moon's destination while the mark was still in flight; it is gated (section 3, "Blending").

## 6b. Recommended moon scale

The lab default (`size 0.36` globe radii, plus the `far` growth of up to 1.45x beyond 4.2 radii and the `nearShrink` below 2.4) is a
cinematic scale: in the wide landing shot the moon's bounding circle is about 29% of the planet's diameter. That suits ambient
close-ups and the director's shots, but it is too large for the regular shell view. Measured over a full lap of the orbit (bounding-circle
diameter, min / median / max, 1600x900; the companion's design size is 7.2% of the viewport height, 48..104 px, which is about 84 px as a
bounding circle at 900p):

| Camera (radii) | Planet | size 0.20 | size 0.24 | size 0.36 (default) |
|---|---|---|---|---|
| 2.9 | 781 px (87% of height) | 57 / 79 / 132 px (8.8% median) | 68 / 98 / 156 px (10.8%) | 103 / 143 / 237 px (15.9%) |
| 3.5 | 671 px (75%) | 56 / 69 / 113 px (7.7%) | 67 / 84 / 136 px (9.3%) | 101 / 124 / 205 px (13.8%) |
| 4.8 | 515 px (57%) | 53 / 61 / 74 px (6.7%) | 63 / 73 / 89 px (8.1%) | 95 / 109 / 135 px (12.1%) |
| 6.5 | 396 px (44%) | 44 / 56 / 58 px (6.2%) | 52 / 67 / 69 px (7.5%) | 79 / 101 / 104 px (11.2%) |

Phone (390x844, the planet is fitted to the width, 350 px): size 0.20 gives 25 / 35 / 59 px, 0.28 gives 35 / 54 / 80 px, 0.36 gives 46 / 64 / 105 px.

Recommendation:

- **Regular shell view, desktop: `size 0.22`.** Median 70 to 90 px (8 to 10% of the height) at the usual 2.9 to 3.5 radii, about 62 px on the
  far side of the orbit and about 130 px when it passes the near side; the moon is then about a tenth of the planet's diameter, the
  same presence as the companion.
- **Phone: `size 0.28`** (median 54 px; the companion's phone size is 62 px).
- **Ambient / cinematic: 0.36** with the existing `far` growth; if the wide landing frame should be calmer, 0.30.
- **Better than a constant:** derive the world size from a target on-screen size every frame (damped), about
  `size = apparent_px * dist / (1.04 * projScale)` with `apparent_px` near 80 at 900p, clamped to 0.16..0.36, where `dist` is the camera-to-moon
  distance. The wake and beads already scale with the moon's actual world height (`size * scaleNow` is what `MoonChain.update` receives),
  so they follow whatever you choose.

## 7. Porting notes for the world-space moon

- `MoonChain.update` needs the orbit basis and angle (`e1`, `e2`, `orbit`, `moonTheta`) and the moon's actual world height. If your
  moon follows a path that is not a circle on a fixed plane, replace `point(theta, ...)` (it returns the world position on the orbit
  for an angle) and keep everything else: the ribbon takes any polyline of positions (`wakePos/wakePrev/wakeNext`), the beads any
  position per block.
- The beads store the orbit angle at the seal; the lab places history with `angleAtUtc(ms)` so every viewer sees the same chain.
- The wake and beads fade at the planet's limb analytically. Keep that: a depth cut at the limb flickers.
- The moon body writes alpha 0 in tonal (companion) mode as the "exempt" mask for the composite; in world mode alpha is 1 (tone
  mapped). Additive layers must keep their alpha factors (Zero/One) or they erase the mask.
- Ray head sprites and ribbons are `depthTest: true, depthWrite: false`; the ribbon uses `polygonOffset -2` so a route that starts on
  the surface does not fight the planet.
- Anchors: `uAnchor[0..3]` pieces, `[4]` centre, `[5]` the dev pulse's target (out past the moon, away from the planet in the picture
  plane). `ANCHOR_BASE + k` addresses them from `fx.ray`.

## 8. Not done, or not verified

- No web patch (G2 owns `web/src/globe/engine/moon/**`); `web/scripts/globe-check.mjs fps` was not run because the app has none of this.
- Real phones and other GPUs: everything here was rendered on a desktop GPU (Chromium, ANGLE Vulkan, RX 9070 XT). The shaders are
  WebGL2 and use only `fwidth`, `exp`, `smoothstep`; the moon is a few hundred pixels, so cost scales with its screen area.
- The `quality=low` tier was only spot-checked (the finishes are unchanged by the tier).
- Marble's frost is procedural noise plus etched hexagons; there is no refraction of what is behind the moon.
- The 900 ms blend was rendered from companion to sky only (`trail-blend`, `trail-blend-dense`); sky to companion runs the same two gates
  in reverse and was not rendered.
- Reduced motion was rendered in the sky only; the companion's static beams and ribbons were not part of the final sequences.
- The shimmer metric cannot tell motion from flicker by itself: a dot lattice that moves two pixels in a frame changes a fifth of the
  picture. The per-frame piece displacement (2.4, 1.1, 0.4 px) and the sequences are what show that the seal's push is smooth.
