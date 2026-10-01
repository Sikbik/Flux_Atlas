# Flux Atlas v2 - Motion Language

> Status: **v1.0, built and running in `web/src/motion`** (the engine, the stylesheet, the React layer and the `/dev/motion` gallery). This is the contract for how controls and chrome respond: a press, a hover, a toggle turning on, a live arrival, a window opening. It sits under section 6 of `design-direction.md` and does not repeat it: the Beat, the boot, the moon, the globe, the odometer and the camera stay with 6.4. Section 14 lists the few places where this document is stricter than that one (the chrome has no idle loops).
>
> Clean-room: nothing here comes from v1 (`backend/`, `frontend/`). Brand: Flux Blue `#2B61D1`, its tints, and white. No emoji anywhere.
>
> Reading order: 1 and 2 (the idea and the principles), 3 (the vocabulary, the heart of it), 7 (the rules against overwhelm), 12 (the checklist). Implementers continue with 4 to 6, 8 to 10 and `web/src/motion/README.md`.

## Contents

1. [The idea](#1-the-idea)
2. [Principles](#2-principles)
3. [The vocabulary](#3-the-vocabulary): Pulse, Charge, Spark, Current, Power-on, Settle, and Slide
4. [The light](#4-the-light): one ribbon, one recipe
5. [Tokens](#5-tokens): timing, easing, colour, geometry, typed properties
6. [Modes and attributes](#6-modes-and-attributes): Full, Reduced, Off, and what the engine reads
7. [Rules against overwhelm](#7-rules-against-overwhelm): the budget, quiet zones, the rules
8. [Where it lives](#8-where-it-lives): which surface speaks which word
9. [Accessibility](#9-accessibility)
10. [Performance](#10-performance)
11. [Joining the language](#11-joining-the-language)
12. [UX simplicity checklist](#12-ux-simplicity-checklist)
13. [Reviewing motion](#13-reviewing-motion): frame sequences and the defects to look for
14. [What this narrows in the design direction](#14-what-this-narrows-in-the-design-direction)

## 1. The idea

The brief was that the interface lacked feel: it should answer a click with animation and effects that match Flux, like the electrical pulse the ambient mode draws when a block is processed, and carry that same stylised feel into how the UI is used, without overwhelming anyone.

The answer is one image used with discipline: **current**. A short run of light, a white head with a Blue Wave tail, that travels along the real outline of whatever you touched, or along the edge of whatever just arrived. It is the same ribbon the globe draws when the moon relays a block (the uplink: a white head trailing Blue Wave, with a faint halo; 6.4 I), so the chrome and the planet speak one language.

**Atlas is wired.** When you act, current runs. When the network acts, current arrives. The rest of the time nothing moves and nothing costs anything.

What that looks like in use:

- **Press a button.** A soft bloom marks the contact point and two short comets leave the nearest point of the border, one each way. They follow the button's own outline (round corners, or the primary button's hexagon-angle chamfers), meet on the far side and close the circuit with a small flare. 180 to 260 ms, once.
- **Hover a control.** Its edge warms toward the pointer and follows it. Focus it with the keyboard and the edge glows evenly inside the focus ring.
- **Turn something on.** A small white head lands on the part that moved (the end of a switch, the icon of a chip), rings once and settles.
- **A block lands.** One streak crosses the top of the rail, the new card is circled once, the number settles. Then it is still again.
- **Open a window.** A circle of light widens out of the launcher, node or moon that summoned it, and the window is revealed inside it. Closing is the same thing, shorter, back into the source.
- **At rest.** Nothing moves. The moon is the only thing in Atlas that moves without an event (6.1.9).

Three details make it Flux and not a generic glow. The light follows the shape, including the chamfer that is Flux's own hexagon angle. The light is the globe's: white head, Blue Wave body, never another colour. And the circuit closes: two comets meeting is a closed loop, which is the electrical idea, where a one-way ripple is just a ripple.

What it deliberately is not: a drawn track (an orbiting ring around a control was tried and rejected as clunky; implied motion, light that passes a point, beats a path that is drawn), a ripple, a pulsing glow, a hover wobble, or anything that loops.

## 2. Principles

1. **Energy is drawn from an event.** Every effect has a cause that a person or the network just produced: a press, a switch flipping on, a block landing, a window summoned. No cause, no light.
2. **Light follows the thing.** Current runs along the real outline, turns the real corners and sits on the real edge. A glow that ignores the shape reads as a filter; light that follows it reads as hardware.
3. **Rest is still, and free.** No idle loops, no always-on layers, no timers in the chrome. The only thing in Atlas that moves without an event is the moon (6.1.9). At rest the language costs a few passive listeners and no frames.
4. **Effects never delay the user.** Input to visible response in 100 ms or less, and the static state (the pressed ink, the new value, the opened window) is already correct when the light starts. The light is an overlay on top, interruptible at any moment, and nothing waits for it, closes late for it or is blocked by it.
5. **One effect per interaction.** A press is one Pulse, not a Pulse plus a ripple plus a glow. A toggle turning on is one Spark. When two things want to play, the one the person caused wins and the other is dropped.
6. **Quiet where it is dense.** Tables, feeds, lists and toolbars of small controls do not perform. They keep their static states and the kit's own wash for a changed value. Light is for the sparse, the important and the user's own action.
7. **Brand light only.** White head, Blue Wave body, brand-blue glow. Never a tier colour or a status colour (those are data). The one exception is Settle, where the kit may tint a changed number up or down, always beside a sign or an arrow.
8. **Motion is never the only carrier.** Whatever a motion announces is also in text, an icon or a state. Every effect can be removed without losing information.
9. **Compositor only.** Light is `transform` and `opacity` on a few tiny elements, plus gradients, masks and clips that are static while they animate. No layout, no animated shadows or filters, no per-frame JavaScript. 60 fps beside the WebGL globe. The two paint-only exceptions are named in section 10.
10. **Scarcity is the point.** A strict budget (a few effects at once, three flashes a second at most) keeps each one meaningful, and a dropped effect costs the user nothing.

## 3. The vocabulary

Six words and one optional. Each has a meaning that never changes, a trigger the engine can read from an attribute, and places where it is not used. If something does not fit a word, it does not move.

| Word | It says | Fires on | What you see | Time |
|---|---|---|---|---|
| **Pulse** | "Got it." | a press: `data-pressed` appears on a button | a bloom at the contact point, two comets run the outline both ways and meet in a flare | 180 to 260 ms |
| **Charge** | "Live under your pointer." | mouse or pen hover, and keyboard focus | the control's edge warms toward the pointer; an even edge on focus | 140 ms in and out |
| **Spark** | "It is on." | a toggle turning on: `data-state` becomes `on`, `copied` or `selected` | a small white head lands where the control moved, rings once and settles | 360 ms |
| **Current** | "Something just arrived." | `data-fresh` on an opted-in row or card, or a `<Current>` signal changing | one comet along an edge, or once around a card | 440 to 920 ms, lap 900 ms |
| **Power-on** | "Here is what you opened." | a window or panel opening or closing | a circle of light widens from the source and reveals the window; the reverse is shorter | 420 and 480 ms in, 180 ms out |
| **Settle** | "This value changed." | `data-flash`, the odometer, fresh table rows (the kit draws these) | a soft wash that decays | 1600 ms, kit |
| *Slide* (optional) | "The selection moved." | `aria-selected` changing in a tab-like list with a `<TabIndicator/>` | a line stretches to the new tab, leading edge first | 300 ms |

### 3.1 Pulse: a press

**Means** that the control took the input and the thing is happening. Fires on the press (pointer down, or Enter or Space held), not on the release, so the answer is there within a frame of the input.

**Anatomy.** A bloom at the contact point, clipped to the control's shape. Two comets leave the nearest point of the border in opposite directions, turn every corner (round or chamfered) and meet on the far side, where a small flare marks the circuit closing. A keyboard press starts at the top centre. The heads ride the control's own 1 px border (0.75 px inside the border box).

**Time and size.** The run lasts `--fx-dur-pulse` for a 600 px outline and moves 10 ms per 100 px more or less, clamped to 180 to 260 ms: a 32 px icon button about 190 ms, a 120 by 36 button 210 ms, a 300 by 40 button 245 ms. The bloom lasts `--fx-dur-seed` (180 ms) with `--ease-out`. The heads use `--fx-ease-run`. The tail is 1.15 times the short side plus 0.12 times the extra length (28 to 76 px), 3.2 px thick on controls 30 px or taller and 2.6 px below; the bloom is 36 to 88 px across.

**Colour.** White head and core, Blue Wave body and glow (`--fx-head`, `--fx-body`, `--fx-glow`). On the filled primary and danger buttons the whole light is white (the `fx-tone-hot` variant) because their face is already blue; `data-fx-tone="hot"` or `"accent"` overrides.

**Used on.** Every kit `Button` variant and `IconButton`, and `data-fx="press"` for a custom control.

**Never on.** Toggles (they Spark), a launcher that opens a window (the window opening is its answer), tabs and segments (their selection moves), menu rows, table rows, links, fields and sliders, anything in a dense zone, anything under 14 px, disabled controls and anything off screen.

**Reduced.** The control's edge flashes once for 160 ms; nothing travels. **Off.** Nothing; the kit's pressed state stays.

A 120 by 36 secondary button pressed 78 percent along its width (the run D = 210 ms):

| t (ms) | What you see |
|---|---|
| 0 | The kit's pressed state applies at once. The bloom starts at the contact point, and two heads appear on the border beside it |
| 0 to 40 | The bloom swells to 0.8 of its size at 95% opacity. The heads reach full brightness, a white core inside a blue body, 40 to 50 px tails |
| 40 to 180 | The bloom grows to 1.3 and fades out. Both comets run toward the far side along the border, brisk off the mark and steadying (`--fx-ease-run`) |
| 115 (0.55 D) | A small flare begins where the comets will meet |
| 165 (0.8 D) | The tails start to go out: they stay bright, then fall away quickly. The flare peaks at 70% |
| 210 | Everything is gone and removed from the document |

### 3.2 Charge: hover and focus

**Means** that the control is live and knows where you are. It is a state, not an event: no overlay, no animation loop, nothing at rest.

**Anatomy.** A 1 px ring on the control's own edge (`::after`, the border box masked down to its edge), lit by a radial gradient around the pointer: white at the pointer, light blue, then Blue Wave, falling to nothing at `--fx-reach` from it. The reach scales with the control (0.7 times the long side, 38 to 120 px), so a 32 px icon button gets a local glow and a long button a wide one. The engine hands the pointer position to the stylesheet (`--fx-x`, `--fx-y`) once per frame while the pointer moves over the control, and does nothing otherwise. The primary button's ring takes its chamfered shape.

**Keyboard focus.** An even, steady ring in light blue inside the kit's own focus ring (`--focus-ring` stays: it is the focus indicator, Charge only lights the edge). A custom control that says `data-fx="charge"` gets the ring plus a Blue Wave bloom (`--fx-focus-shadow`) in place of its outline.

**Time.** `--fx-dur-charge` (140 ms) in and out, `--ease-out`.

**Used on.** Every kit `Button` and `IconButton`; `data-fx="charge"` on custom controls that are not in the kit (dock launchers, bare icon buttons). **Never on.** Touch (there is no hover), disabled controls, table rows, fields (they have their own focus ring), controls that already use `::after` (the kit's copy button and chips), anything in a dense zone.

**Reduced.** A static 55% edge on hover and focus, 140 ms fade; the pointer is not followed. **Off.** The same static edge with no transition. **Forced colours.** The system draws the focus ring and the ring steps aside.

### 3.3 Spark: it is on

**Means** that a person turned something on or committed it. Turning off is quiet: a state change is its own answer.

**Fires on** `data-state` turning to `on`, `copied` or `selected` (or `aria-checked`, `aria-pressed`, `aria-selected` turning `true`) on a Switch, a toggle chip, the copy button, or any element that says `data-fx="toggle"`, and only when a pointer press or a key press landed in that control within the previous 900 ms. A setting restored on load, a value the app changed on its own, and a control turned off never spark.

**Anatomy.** A 6 px white core with a two-step bloom, and one ring that expands from 0.35 to 2.1 times its 24 px size. It lands where the control moved: the resting end of a Switch's track (after the knob has travelled: the lesser of 160 ms and 65% of the knob's own transition), the first icon of a chip or copy button, otherwise the centre of the control. `data-fx-spark="end|start|icon"` and `data-fx-delay` override.

**Time.** The core lasts `--fx-dur-spark` (360 ms, `--ease-out`), the ring 400 ms (`--fx-ease-burst`). **Colour.** A white core with a Blue Wave ring.

**Reduced.** The control's edge flashes once for 160 ms. **Off.** Nothing.

A Switch turned on (the kit's knob takes 220 ms to travel and the head waits 65% of that, about 140 ms; times are from the head's appearance):

| t (ms) | What you see |
|---|---|
| before 0 | The switch's state flips at once (kit). The knob slides; the head waits for it |
| 0 | The head appears at the end of the track at 35% scale, with the ring at 35% and 75% opacity |
| 72 | The head peaks: 130% scale, 92% opacity. The ring is expanding fast (`--fx-ease-burst`) |
| 180 | The head settles to 100% scale and 85% opacity |
| 360 | The head is gone. The ring finished at 400 ms (210% scale, no opacity) |

### 3.4 Current: something arrived

**Means** that the network did something, not the person. It is the one word that is about the world rather than about you, so it is also the one that yields: it is the live class of the budget and always gives way to the user's own effects.

**Fires on** `data-fresh` appearing on an element that opted in with `data-fx="current"` (a feed row, a card), a `<Current signal={...}>` whose signal changed (the block rail), and `<Current fireOnMount>` on a card that has just landed. Nothing on first paint, on a route change or for restored data.

**Anatomy.** On a straight edge, one ribbon (three passes: wide and faint, medium, thin and hot, the globe's beam) enters at one end, runs the straight part between the corner radii and leaves. As a lap, a chain follows the whole outline once, clockwise from the top edge.

**Time.** On an edge, `--fx-dur-current` is the run along a 700 px edge and every 100 px more or less moves it 40 ms, clamped to 440 to 920 ms (a 400 px card edge 520 ms, a 1,200 px rail 840 ms), with `--fx-ease-run`. A lap is `--fx-dur-lap` (900 ms) with `--fx-ease-lap` (nearly even, so the head reads as one steady lap). Tails: 0.1 times the edge length (56 to 160 px) on an edge, 0.14 times the perimeter (40 to 84 px) on a lap.

**Used on.** The rail's top edge once per block; the card that just landed, once around; P1 rows in the Pulse feed (a payment to a watched or owned node, 6.5), which arrive about two seconds after the block's own light is gone; toasts (as the Power-on panel's top edge).

**Never on.** The P0 block row (the rail already carries the block's light), P2 and P3 events (the rows arrive with the kit's own wash), table rows, anything that arrives more than twice a second, anything on mount that was already there.

**Reduced.** One line along the edge fades in and out over 480 ms; nothing travels. **Off.** Nothing.

A block lands on a 900 px rail (the edge run is 720 ms with a 90 px tail; the new card's lap is 900 ms):

| t (ms) | What you see |
|---|---|
| 0 | The tip number starts to settle (kit: the odometer rolls and a wash starts). A streak of light enters the left end of the rail's top edge. The new card mounts and its lap starts just right of its top-left corner |
| 0 to 360 | The streak crosses the left half of the rail, brisk off the mark. The card's lap runs along its top edge, round the top-right corner and down the right side |
| 360 to 720 | The streak crosses the right half and leaves the rail, its tail going out last. The lap passes along the bottom edge |
| 720 to 900 | The lap finishes up the left side and goes out. The light was never in two places on one element |
| 900 | Both are gone and removed. Only the kit's wash on the number is left |
| 1600 | The wash has decayed. Atlas is still |

### 3.5 Power-on: open and close

**Means** "here is what you opened", and where it came from. Everything comes from somewhere (6.1.3): the dock launcher, the clicked node, the result row, the moon.

**Window.** A plain wrapper (no clip, shadow or mask of its own; the framed, chamfered, shadowed window sits inside it) is revealed by a circle that widens from the source point to cover the window (the aperture, 6.4 A), while a surge of light, a thin white leading edge with a faint wake behind it, rides the circle's edge. The wrapper itself scales from 0.95 and fades in during the first 50 ms, so the content is live the moment it mounts and the light rides over it.

**Close** is faster than the open (180 against 420 ms, as the aperture's 220 against 660): the wrapper scales to 0.96 toward the source, fades, and the circle closes back into it. It stays invisible until its owner unmounts it, so a React unmount never flashes it back; re-opening mid-close brings it back visible.

**Panel** (toasts, the command palette): a quicker scale from 0.97 and fade (260 ms) with one comet along the top edge (420 ms, 80 px tail). No aperture.

**Time.** Entrance `--fx-dur-power-on` (420 ms, `--fx-ease-arrive`); aperture and surge `--fx-dur-surge` (480 ms, `--fx-ease-run`); exit `--fx-dur-power-off` (180 ms, `--ease-in`). This is faster than the design's `--dur-portal-open` (660 ms): the aperture idea is kept, the wait is not. `--dur-portal-open` stays in the token sheet for anything that still wants the slow version.

**Used on.** Windows, toasts and the palette. **Never on.** Menus, selects, tooltips and hover cards (tools used dozens of times a minute; the kit's own entrance is enough), tabs and in-window route changes (6.4 G).

**Reduced.** A 160 ms cross-fade in and 120 ms out; no clip, no light. **Off.** Instant. The aperture is used only when the element can be clipped safely (no shadow, mask, clip or filter of its own); otherwise the scale, fade and surge still play and the clip is skipped.

A window opening from a dock launcher (a 520 by 340 window; the launcher is 60 px left of its edge):

| t (ms) | What you see |
|---|---|
| 0 | The window mounts at 95% scale, transparent, clipped to a zero circle at the launcher. The launcher is already charged from the hover |
| 0 to 50 | The wrapper is fully opaque at 99% scale. All the eye follows now is the circle |
| 50 to 250 | The circle grows quickly (`--fx-ease-run`): 40% of the way at 130 ms, three quarters at 250 ms. A white 1.25 px leading edge rides the circle's rim with a faint blue wake 70 px deep behind it |
| 250 to 480 | The circle passes the farthest corner at about 330 ms and runs on 64 px past it, so the window's drop shadow is uncovered before the clip ends and never pops in. The surge fades (85% at 290 ms, gone at 480) |
| 420 | The scale settles to 1 |

Closing: 0 to 180 ms the same circle closes into the launcher while the wrapper scales to 0.96 and fades (`--ease-in`); at 180 ms it is invisible, then unmounted by its owner.

### 3.6 Settle: a value changed

**Means** that this number, row or state changed and the new value is the news. **The kit draws it**: `FlashOnChange` (a wash behind the value, at most 12% of the light colour, decaying over `--dur-fresh`, 1600 ms; reduced holds a steady tint for 1 s; off draws none), `AnimatedNumber` (the odometer, 6.4 D, with its direction tint) and `DataTable`'s `data-fresh` and `data-enter` rows. There is no runner for it in `web/src/motion` and none should be added: this language says when Settle is the answer and that nothing else is drawn on top of it.

**Used on.** A value that changed in place (the tip, the counters, a row's figure), a row arriving in a dense list, a status chip changing state (its label and colour change, no light). **Never** with a Current on the same element in the same moment: a row either arrives (the kit's wash) or is a P1 event that earns a Current, not both.

**Colour.** The accent for a neutral change, white for the tip (`tone="white"`), and `--div-pos` and `--div-neg` for direction (`tone="auto"`), always next to a sign or an arrow and never as colour alone. This is the one place the language lets a data colour in, because the change itself is the data.

### 3.7 Slide: the selection moved (optional)

**Means** that the selection moved from here to there. The kit's `Tabs` and `SegmentedControl` already move their own ink, and they keep it. `<TabIndicator/>` is for a tab-like list that has none (a window's tab strip drawn without the kit, a custom segmented list).

**Anatomy.** A 2 px line under the selected tab. Its leading edge arrives first (0.85 of `--fx-dur-slide`, `--fx-ease-lead`) and the trailing edge catches up (1.15 of it, `--fx-ease-trail`), so the line stretches and relaxes like current finding a new path. A white head glows on the leading end and fades over 1.3 times `--fx-dur-slide` (390 ms); a soft Blue Wave bloom sits under the line. It finds the selected tab by itself (`aria-selected`, `aria-current` or `data-selected`), watches for changes and for resizes, and costs nothing between them.

**Reduced and Off.** The line jumps to its new place. **Not compositor-only**: two registered custom properties clip a 2 px strip (paint only, never layout); see section 10.

## 4. The light

Everything that travels (a Pulse, a Current, the Power-on panel's sweep) is one ribbon with one recipe: the globe's beam morphology (6.4 I) in chrome colours. A ribbon is a head and a tail, and the tail is four overlaid passes whose brightness falls with distance from the head (u is 0 at the head and 1 at the end of the tail):

| Pass | Peak alpha | Falls as | Colour |
|---|---|---|---|
| Core | 100% | (1 - u)^2.1 | white, `--fx-head` |
| Body | 88% | (1 - u)^1.35 | Blue Wave 300, `--fx-body` |
| Glow | 62% | (1 - u)^0.9 | Blue Wave 500, `--fx-glow` |
| Halo | 15% | (1 - u)^1.1 | Blue Wave 500, wide and soft |

The white core dies fastest and the blue glow lingers, so the head burns white and the tail fades to blue. The tail also thins, to 18% of the head's thickness at its far end. The head is a bead 1.25 times the thickness with a two-step bloom (1.6 and 5 times the thickness, `--fx-glow-hot` and `--fx-glow-soft`).

**How it turns a corner.** One straight element cannot: its tail would cut across a bend and stick out of a rounded or chamfered shape. A comet here is a chain of 4 to 18 short links, spaced 3 to 6 px apart by the tightest corner on the path. Each link is a tent (dark at both ends, bright in the middle), twice as long as the spacing, centred on a point of the outline and pointing along its local chord. The keyframes are sampled along the control's exact outline (a rounded rectangle from its computed radii, or a polygon parsed from its `clip-path`, or from its `::before` where the kit draws the shape there), with the easing baked in so that the links keep their spacing along the path. Neighbouring tents overlap and the box that holds them is isolated with additive (`plus-lighter`) blending, so they sum to one continuous ribbon with no seams and no beads.

**How it fades.** In over the first 5 to 8% of the run, out over the last 12 to 22% on a power curve (bright, then out quickly), so the head never lingers as a dot at the end of its run.

**Easing for light** (`--fx-ease-run`, `cubic-bezier(0.33, 0.4, 0.5, 1)`): brisk off the mark, steady through the middle, a short settle. A strongly decelerating curve was tried and rejected: it parked the head as a grey disc at the end of the run.

## 5. Tokens

The language adds only `--fx-*` tokens, in `web/src/motion/motion.css` (the runner overlays in `web/src/motion/runners/fx.css` read the same ones). They sit on top of `styles/tokens.css` and never redefine it. The numbers in `web/src/motion/timing.ts` (`DUR`, `EASE`) mirror them for the Web Animations runners, and a test fails if the two drift apart.

### 5.1 Timing

| Token | Value | `DUR` key | Used for |
|---|---|---|---|
| `--fx-dur-pulse` | 240 ms | `pulse` | the Pulse run round a 600 px outline (180 to 260 ms by size) |
| `--fx-dur-seed` | 180 ms | `seed` | the bloom at the contact point |
| `--fx-dur-charge` | 140 ms | `charge` | hover and focus fade in and out |
| `--fx-dur-spark` | 360 ms | `spark` | the Spark's core; the ring runs 40 ms longer |
| `--fx-dur-current` | 640 ms | `current` | the Current run along a 700 px edge (440 to 920 ms by length) |
| `--fx-dur-lap` | 900 ms | `lap` | one lap round a card |
| `--fx-dur-power-on` | 420 ms | `powerOn` | a window's scale and fade in |
| `--fx-dur-surge` | 480 ms | `surge` | the aperture and the light surge across a window |
| `--fx-dur-power-off` | 180 ms | `powerOff` | a window closing: faster than it opens |
| `--fx-dur-slide` | 300 ms | `slide` | the selection line travelling |

### 5.2 Easing

| Token | Curve | Used for |
|---|---|---|
| `--fx-ease-run` | cubic-bezier(0.33, 0.4, 0.5, 1) | light along a wire, the aperture and the front of a surge |
| `--fx-ease-arrive` | cubic-bezier(0.2, 0.8, 0.2, 1) | a window or panel arriving (scale and fade) |
| `--fx-ease-burst` | cubic-bezier(0.16, 1, 0.3, 1) | a bloom that is gone (equals `--ease-out-expo`) |
| `--fx-ease-lead` | cubic-bezier(0.16, 1, 0.3, 1) | the slide's leading edge |
| `--fx-ease-trail` | cubic-bezier(0.4, 0, 0.2, 1) | the slide's trailing edge catching up |
| `--fx-ease-lap` | cubic-bezier(0.4, 0.25, 0.3, 1) | once round a card: nearly even |

Entering uses decelerate, leaving uses accelerate, as everywhere (6.2): the exit of a window is `--ease-in`.

### 5.3 Colour

All brand: white, the Blue Wave steps of `--accent-*`, nothing from the tier or status ramps.

| Token | Value | Used for |
|---|---|---|
| `--fx-head` | `--hot` (white) | the head, the core, the bloom, the surge's front |
| `--fx-body` | `--accent-300` (`#ABBEE4`) | the ribbon's body, a ring's stroke |
| `--fx-glow` | `--accent-500` (`#4F7AD4`) | the glow and halo passes |
| `--fx-glow-hot` | `rgb(174 198 255 / 0.85)` | the head's inner bloom |
| `--fx-glow-soft` | `rgb(79 122 212 / 0.5)` (20% under `prefers-contrast: more`) | the head's wide bloom |
| `--fx-focus-ring` | the kit's `--ink-0` gap and `--accent-400` ring | the focus ring, restated for custom controls |
| `--fx-focus-shadow` | `--fx-focus-ring` plus a Blue Wave bloom | the energised focus outline of `data-fx="charge"` controls |

On filled Blue Wave surfaces (the primary button) the `fx-tone-hot` variant re-points `--fx-body`, `--fx-glow`, `--fx-glow-hot` and `--fx-glow-soft` to white and the lightest accent steps, so the light reads against the blue.

### 5.4 Geometry and layer

| Token | Value | Meaning |
|---|---|---|
| `--fx-bw` | 1px | thickness of the charge ring |
| `--fx-inset` | -1px | the ring sits over the control's own 1 px border; set `0` on a control that clips its overflow |
| `--fx-reach` | 104px | how far the hover light spreads along the edge; the engine sets it per control (38 to 120 px) |
| `--fx-z` | `--z-tooltip` + 5 (135) | the light layer: fixed on `<body>`, above everything, `pointer-events: none` |

### 5.5 Typed properties and the variables the engine sets

Registered with `@property` so they can animate and inherit exactly as needed:

| Property | Syntax | Inherits | Used for |
|---|---|---|---|
| `--fx-ring` | length | no | the surge front's radius (the one custom property the Power-on surge animates) |
| `--fx-l`, `--fx-r` | length | yes | the left and right ends of the slide line (read by its pseudo-elements, so they must inherit) |
| `--fx-hl`, `--fx-hr` | number | yes | the brightness of the slide line's left and right heads |

Set by the engine on the elements it draws, never by authors: `--fx-x`, `--fx-y` (the pointer inside a charged control), `--fx-tail`, `--fx-th` (a comet's length and thickness), `--fx-c`, `--fx-b`, `--fx-g`, `--fx-h` (a link's four pass brightnesses), `--fx-seed` (a bloom's size), `--fx-ox`, `--fx-oy` (the surge's origin).

### 5.6 What it reuses

`--ease-out`, `--ease-in`, `--ease-out-expo` and `--dur-fast` from `tokens.css`; `--hot`, `--accent-300`, `--accent-400`, `--accent-500`, `--ink-0`, `--z-tooltip` and `--clip-chamfer-dual-sm` (the primary button's ring shape). Settle uses the kit's own `--dur-fresh`. In `reduced` the shared `--dur-*` tokens already shrink (6.6); this language adds its own reduced and off rules in section 6.

## 6. Modes and attributes

### 6.1 The three modes

Settings offers Motion: Full, Reduced or Off, and the OS `prefers-reduced-motion: reduce` selects Reduced unless the person chose otherwise (6.6). Every word has all three:

| Word | Full | Reduced | Off |
|---|---|---|---|
| Pulse | bloom and two comets | the edge flashes once, 160 ms, nothing travels | nothing; the kit's pressed state only |
| Charge | the edge light follows the pointer, 140 ms | a steady 55% edge, 140 ms fade, the pointer is not followed | the same edge on hover and focus, no transition |
| Spark | head and ring, 360 ms | the edge flashes once, 160 ms | nothing |
| Current | a comet, 440 to 920 ms; a lap, 900 ms | one line fades in and out, 480 ms | nothing |
| Power-on | scale, aperture, surge | a 160 ms cross-fade in, 120 ms out, no clip, no light | instant |
| Settle | the kit's wash, 1600 ms | the kit's steady tint, 1 s | none (the kit sets no flash) |
| Slide | the line stretches, 300 ms | the line jumps | the line jumps |

Reduced removes all travel and follow. Off is complete: only static states remain, and the focus ring always stays.

### 6.2 How the mode is resolved

One answer in the same order the kit's `useMotionMode()` uses, so CSS, kit components and these effects never disagree:

1. The nearest `[data-fx-mode]` on an ancestor: a subtree override (the gallery's Compare view uses it; applications do not).
2. `<html data-motion>`: a mode the page forced (a gallery, a screenshot run, an embedding shell). The kit's stylesheets and `tokens.css` switch on this attribute.
3. The stored preference (`useUi.motion`), where `system` follows the OS setting.

Nothing in the kit mirrors the stored preference to `<html data-motion>`, so `<MotionRoot/>` does: while no one has forced a mode it writes the effective mode there, follows the Settings choice and the OS setting live, and never overwrites a value it did not write. It also keeps `<html data-fx-mode>` current (the resolved mode, which this language's own CSS and runners read).

### 6.3 What the engine reads

The kit writes these attributes (`web/src/ui/README.md`, "Attach points") and the engine answers them, so a kit component joins the language by being on a list in `web/src/motion/attach.ts`, not by importing anything:

| Attribute | Where | Answer |
|---|---|---|
| `data-pressed` | appears while a pointer button or Space or Enter is held | Pulse, if the element is on the press list |
| `data-state` | turns `on`, `copied` or `selected` | Spark, if the element is on the spark list and a person just acted |
| `aria-checked`, `aria-pressed`, `aria-selected` | turn `true` | the same Spark, for controls that report through ARIA |
| `data-fresh` | appears on a row or card | Current, if the element says `data-fx="current"` |
| `data-flash`, `data-enter` | the kit's changes and arrivals | nothing from this folder: the kit's wash is Settle |
| `data-motion`, `data-fx-mode` | `<html>` and subtrees | the mode (6.2) |

For elements outside the kit, and for opting out:

| Attribute | Meaning |
|---|---|
| `data-fx="press"` | Pulse on pointer down and on Enter or Space (never in a text field) |
| `data-fx="toggle"` | Spark when `data-state` or `aria-checked` or `aria-pressed` turns on |
| `data-fx="charge"` | the hover and focus ring |
| `data-fx="current"` | Current when `data-fresh` appears (`data-fx-edge` picks the edge) |
| `data-fx="focus"` | only the energised focus ring |
| `data-fx="off"` | no effect on this element or anything inside it |
| `data-fx-density="dense"` | a dense zone: no Pulse, Charge or Current inside (section 7) |
| `data-fx-tone="hot"` or `"accent"` | the colour of the light |
| `data-fx-spark="end"`, `"start"`, `"icon"`, `data-fx-delay="ms"` | where and when a Spark lands |

Tokens combine with spaces: `data-fx="press charge"`.

## 7. Rules against overwhelm

### 7.1 The budget

Every effect asks for a lease before it creates a single node. No lease, no visuals: the control's static state is already right, so a refused effect costs the user nothing, and nothing is queued for later.

| Rule | Value |
|---|---|
| Flash rate (Pulse and Spark starts), the WCAG 2.3.1 ceiling | 3 per second, whatever elements they land on |
| Replace, never stack | a new effect on an element that has one cancels the old one first |
| At once, per kind | Pulse 3, Spark 3, Slide 3, Current 2, Power-on 2 |
| At once, in all | 10 |
| Who yields | user-class effects (Power-on, Pulse, Spark, Slide) preempt the oldest live-class effect (Current) when the room is full; live effects never preempt anything and are dropped |

Live effects therefore yield to the user's own input, and a burst of network events can never starve or stack on top of what a person is doing.

### 7.2 Quiet zones

Light is for the sparse, the important and the user's own action. These stay quiet:

- **Dense views.** `data-fx-density="dense"` on a container, and every kit `DataTable`, silence Pulse, Charge and Current inside. A Spark may still confirm the person's own toggle (it is tiny and follows an action), unless `data-fx="off"` says no. Dense means, and the shell marks it so: tables and feeds, lists of more than about eight rows, toolbars of four or more small controls, window title bars and the status bar.
- **Scaled by size.** Elsewhere the light scales with the thing: the tail follows the control's short side (28 to 76 px), the bloom is 36 to 88 px, the charge reach is 38 to 120 px, and a control under 14 px gets nothing. A small control gets a small, quick light.
- **Opt out.** `data-fx="off"` on any element silences it and everything inside.
- **Hidden.** No overlay is drawn while the page is hidden or the element is off screen.

### 7.3 The rules

1. One effect per interaction. A control that toggles answers with a Spark when it turns on, a control that does something answers with a Pulse, a launcher answers by opening its window. Never two.
2. At most three flashes in any second, in any combination.
3. Nothing stacks on one element: a second press replaces the first run.
4. Live yields to user. A block landing never delays, replaces or competes with a press; it is dropped.
5. Nothing lasts a second. Every light in the vocabulary ends within 920 ms. The only longer thing is the kit's Settle wash, which is a tint, not light.
6. Nothing fires on mount, on a route change or for restored state. A Spark needs a recent input; a Current needs an arrival; `fireOnMount` is only for a card that has just landed.
7. The same event never gets two lights. A block landing is one streak on the rail and one lap on the new card (the two Currents the budget allows) and a Settle on the number; nothing else.
8. No loops in chrome. If something needs to say "still going", it is a static state (a dot, a word), not a cycle.
9. Every effect is interruptible and leaves nothing behind: cancelling one removes all of its nodes, a window re-opened mid-close comes back visible, an unmounted `<Current>` stops.
10. A dropped effect never looks like a bug. The static state is complete without the light, so a dropped Pulse is a button that simply pressed.

## 8. Where it lives

Which surface speaks which word. A surface that is not listed does not move.

| Surface | Word | How | Notes |
|---|---|---|---|
| Kit `Button`, every variant, and `IconButton` | Pulse, Charge | automatic (`.ui-button`) | primary and danger buttons get white light; a toolbar of four or more small icon buttons is dense |
| Dock launchers | Charge, then the window's Power-on | `data-fx="charge"` on the launcher | no Pulse: the window opening is the answer; the aperture opens from the launcher's centre |
| Window title-bar controls | none | `data-fx-density="dense"` on the title bar | closing the window is their answer |
| Switch, toggle chip, copy button | Spark when on | automatic | off is quiet |
| Tabs and segmented control (kit) | their own ink | none from this folder | no Pulse on a tab |
| A tab-like list without ink | Slide | `<TabIndicator/>` | optional |
| Text fields, sliders, selects | their own focus ring | none | |
| Menus, popovers, tooltips, hover cards | none | none | used dozens of times a minute |
| Windows | Power-on | `<PowerOn open origin>` | the wrapper carries no clip or shadow |
| Toasts, the command palette | Power-on, panel variant | `<PowerOn variant="panel">` | a quick sweep along the top edge |
| `DataTable` rows | Settle | the kit | dense: no light |
| Pulse feed rows | Settle for all, Current for P1 only | the kit's `data-fresh`; `data-fx="current"` on P1 rows only | a payment to a watched or owned node; the block row settles like the rest, the rail carries the block's light |
| Block rail | Current | `<Current signal={tip} edge="top"/>`, and `<Current edge="perimeter" fireOnMount/>` in each new card | not while the rail is hover-frozen or scrolled into history |
| Status bar: tip and counters | Settle | the kit's `AnimatedNumber` and `FlashOnChange` | no light |
| Status bar: connection, freshness chips | none | a static dot and a word | the state change is its own answer |
| Beat chip | the design's own ping per block (8.4) | CSS, event-driven | not part of this language |
| Aim strip and chips | none | static states (`data-soon`, `data-late`, `data-pending`, `data-mine`) | no loops in chrome |
| The globe and the moon | their own (6.4, 7) | not this language | the renderer's |

## 9. Accessibility

- **Focus is never removed or replaced.** The kit's focus ring (`--focus-ring`: a 2 px `--ink-0` gap and a 2 px `--accent-400` ring, 7.7:1 on the slab, 10.2) stays on every control. Charge only lights the edge inside it, and for custom controls the energised outline restates the same ring plus a bloom. The focus ring is never animated away.
- **Flashing (WCAG 2.3.1).** A general flash is a pair of opposing luminance changes of 10% or more over more than a quarter of a 10-degree field. Nothing here gets near the area: the largest light is the window surge, a 1.25 px bright front over a mostly dark window for 480 ms. On top of that the budget caps Pulse and Spark starts at three a second, and a test keeps the constant at three.
- **Motion preferences.** The Motion setting and `prefers-reduced-motion` are honoured everywhere (6.1). Reduced has no travel and no pointer-follow, only 160 ms edge flashes and fades; Off has no animation at all. This also meets WCAG 2.3.3 (animation from interactions).
- **Contrast.** The light carries no information, so it has no contrast requirement of its own; the static states it accompanies do (the focus ring, the selected state) and they are the kit's. `prefers-contrast: more` lowers the soft glows (`--fx-glow-soft` to 20%). `forced-colors: active` hides the decoration and the system draws the focus outline in `Highlight`.
- **Screen readers.** Every light node is `aria-hidden`, `pointer-events: none`, never focusable and outside the layout. Nothing is announced by an effect; live regions are the kit's and the shell's (10.3).
- **Pointers.** The light layer is fixed, outside the layout, and ignores the pointer, so it cannot shift, cover or intercept a target (6.1.5). Charge never moves a control and never applies on touch. A press on touch still pulses along the edge, visible around the finger.
- **Motion is never the only carrier** (6.6): every state an effect announces (pressed, on, new, open) is also a static state with a text, icon or colour-plus-word equivalent.

## 10. Performance

- **Zero cost at rest.** Four passive capture listeners on the document, one `MutationObserver` filtered to six attributes, no timers, no animation frames, no layers. The effect runners are a separate chunk loaded on idle; the always-loaded core is a few kilobytes.
- **Compositor only.** Light is `transform` and `opacity` on tiny `will-change` elements (a Pulse is two chains of 4 to 18 links and two blooms, for 180 to 260 ms), plus gradients, masks and clips that are static while they run. Every node is removed when its effect ends.
- **Two named exceptions, both paint-only and bounded.** The slide line animates two registered custom properties on a 2 px strip for 300 ms. The window surge animates one registered length (`--fx-ring`) through a radial gradient on a window-sized, mostly transparent layer for 480 ms, at most two at once; its box is `contain: layout style`.
- **Lite tier.** Under `data-perf="lite"` the heads lose their wide bloom and the slide line its blurred glow.
- **Measured** at 1600 by 900, device pixel ratio 1 and 2, with the globe running: frame times at rest and during about 25 interactions in 8 seconds (presses, switches, window opens and closes, simulated blocks) hold 16.7 ms at the median and 16.8 ms at the 99th percentile, and no frame over 25 ms belongs to an effect. `web/src/motion/tools/frametime.mjs` repeats the measurement and attributes every frame over 25 ms to the script that held it, so a long frame from elsewhere in the app is never mistaken for one of ours (and the reverse).

## 11. Joining the language

For a new component, in order:

1. **Which word is it?** Does it do something (Pulse), turn something on (Spark), receive something live (Current), open (Power-on), or change a value (Settle)? One answer, or none.
2. **Is it dense?** If it is a table, a feed, a toolbar of small controls or a title bar, it is quiet, and the answer is none.
3. **Can the kit say it?** If the component is a kit component its attributes already do it. If it is a custom control, add `data-fx` tokens in JSX, or add its selector to the right list in `attach.ts` (the integration guide in `web/src/motion/README.md` has the code).
4. **Run the checklist** in section 12, in the gallery's three modes.

## 12. UX simplicity checklist

Every new use of the language passes all of these. A single no sends it back.

1. **Cause.** Did a person or the network just cause this? If not, remove it.
2. **Static state first.** With the light removed, is the control's state already complete (pressed, on, open, new)? If something is missing, the missing thing is the bug.
3. **One.** Count everything that moves when this is pressed, including the kit's own transition and the window's. One thing carries the answer.
4. **Brief.** Is it under a second, and does the next input work at once? Press it ten times in five seconds: it must stay pleasant, and a cut by the budget must not look broken.
5. **Layout.** Does it leave the layout alone: no shift, no reflow, no change of size or hit target?
6. **Dense.** Is it silent in dense places and small where it is small?
7. **Shape.** Does the light follow the thing's outline (corners, chamfers) and sit on its edge, not over its label?
8. **Brand.** Is it white, Blue Wave and brand blue only? No tier or status colour.
9. **Modes.** Does it work in Reduced (no travel) and Off (nothing but the state)? Compare in `/dev/motion` with all three side by side.
10. **Meaning.** Is what it announces also in text, an icon or a state?
11. **Cost.** Compositor only, nodes removed when it ends, nothing running at rest, no frame over 25 ms beside the globe?
12. **Squint test.** At arm's length, does it read as a quick thin line of light, not a flash? The first time it should delight; the hundredth time it should be invisible.
13. **Five-second test.** Click through the whole screen at normal speed for five seconds. If it feels busy, cut something. If a first-time user would ask "what was that", cut it.

## 13. Reviewing motion

Motion is judged as frame sequences, never as stills and never by feel alone.

`web/src/motion/tools/frames.mjs` drives `/dev/motion` with real mouse and keyboard input, freezes the Web Animations the interaction started, seeks them to chosen times and screenshots a clip at each one, so a filmstrip is deterministic whatever the capture speed. It writes a contact sheet per scenario to `/home/stache/.cache/flux-atlas/shots/m1/frames/` (`<scenario>-<mode>.png`, with the individual frames beside it).

```
node src/motion/tools/frames.mjs --list
node src/motion/tools/frames.mjs --only pulse-primary,window-open --mode full --dpr 3
```

| Scenario | Samples (ms) | What to look for |
|---|---|---|
| `pulse-primary`, `pulse-secondary`, `pulse-icon`, `pulse-key` | 0 to 260 every 20 | the bloom at the contact point; both heads on the border and never off it; corners turned (the primary's chamfers); a flare where they meet; nothing left at the end |
| `spark-switch`, `spark-watch`, `spark-copy` | 0 to 560, 440, 480 every 40 | the head lands on the track end or the icon, not on the control's centre; one ring; gone by 400 ms |
| `tabs-slide` | 0 to 480 every 40 | the line stretches (leading edge first) and relaxes, and lands exactly under the new tab |
| `settle-values`, `fresh-row` | 0 to 900, 0 to 1600 | the kit's wash, calm; no light on top of it |
| `window-open`, `window-close`, `toast` | 0 to 560, 0 to 200, 0 to 440 | the circle grows from the launcher; the white edge rides its rim; the content is live from 50 ms; the close is shorter |
| `block-arrives` | 0, 60, 120, 200, 300, 420, 560, 700, 860, 1000 | one streak on the rail, the card circled once, the number settling; nothing else; still by 1 s |

Each is captured in `full`, and the ones that matter in `reduced` and `off` (`--mode`). Defects found while building this, which every capture is checked for:

- A straight tail sticking out of a corner (an X-shaped antenna): the light must bend with the outline.
- Bright ticks, beading or seams along a tail: the ribbon must be continuous.
- A head lingering as a grey disc at the end of its run: it must go out quickly while still bright.
- A thick white crescent instead of a thin bright front on a surge.
- An over-exposed blob where a Spark lands on a small icon.
- Light outside the control's shape, or over its label.
- Any node left in the document after the effect ends.

## 14. What this narrows in the design direction

Section 6 of the design direction describes motion across the product, and this language is its chrome half. Where they differ, this document governs controls and chrome (the globe and the moon stay with 6.4 and 7), and the direction should be brought in line at its next revision.

| Design direction | Says | This language |
|---|---|---|
| 6.4 C and 8.3 (focused window) | the focused rim sweeps a highlight along the top edge every 9 s (`--sweep`) | No loop in chrome (principle 3). The one-time arrival flare of 6.4 C stays: it is an event. The sweep is dropped |
| 6.5 Connection indicator | the Live dot carries a slow 2.4 s ping ring | A static dot and the words. The per-block ping already belongs to the Beat chip (8.4) |
| 6.4 A and `--dur-portal-open` | a 660 ms aperture, a 1.5 px mouth ring at the source, a 2 px rim ring, a 220 ms close | Power-on: a 420 and 480 ms open, the rim is the surge's leading edge, the mouth ring is dropped (a launcher is already charged from the hover), a 180 ms close. Same aperture, faster |
| 6.6 table row "Loops" | rim sweep, live ping, anticipation glow, aim breath are off in Reduced and Off | In chrome there are none in Full either. The aim breath and the moon's anticipation glow are the globe's (6.4 M, 7.10) and unchanged; their chrome mirrors (`data-soon` on the aim strip) are static states |
| 6.1 principle 2 (one loud motion) | a single loud effect in view, quiet motion may coexist | Unchanged. Power-on is the aperture, one of the loud effects (at most two alive, and a window opens one at a time); Pulse, Charge, Spark, Current and Slide are quiet and budgeted (section 7) |
| 8.5 dock hover | scale 1.08 with a spring | Unchanged. Charge adds the ring; scale and ring are one hover state, not two effects |
