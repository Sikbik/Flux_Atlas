// The ambient director: a scene machine that turns the live network into a screensaver.
//
// Nothing here is scripted decoration. Every shot is about something the network is really doing:
// a block landing (the camera cuts to the producer, then frames producer and payees), the busiest
// region of the last minute, the biggest datacenters, an app's constellation, the mesh talking to
// itself, and the planet's own terminator. Between blocks the scenes rotate with simple pacing
// rules: never the same scene twice, never two high-energy scenes in a row, and event density
// steers the choice (a burst favors the activity drift, quiet favors the orbit and the web).
//
// The director only writes camera targets, the mesh mode and captions. It owns no rendering.

import * as THREE from 'three';
import { rangeToFit } from '../camera';
import type { GlobeEngine } from '../GlobeEngine';
import {
  angleBetween,
  clamp,
  DEG,
  easeInOutCubic,
  geoDistance,
  hash01,
  lerp,
  RAD,
  Rng,
  smoothstep,
  wrapPi,
} from '../math';
import type { AmbientCaption, BlockEvent } from '../types';

export type SceneKind =
  | 'orbit'
  | 'sweep'
  | 'hub'
  | 'landing'
  | 'web'
  | 'constellation'
  | 'flyby'
  | 'drift'
  | 'counters'
  | 'egg'
  | 'earthrise'
  | 'eclipse'
  | 'moonfollow';

export interface AmbientHooks {
  /** Picks an app to showcase: its node ids and a one-line detail ("100 instances, 18 countries"). */
  pickApp?: (rng: Rng) => { name: string; ids: ArrayLike<number>; detail: string } | null;
}

export interface AmbientOptions {
  /** Global pacing multiplier (1 = the design's durations). */
  pace?: number;
  /** Restrict the scene pool (landings always play). */
  scenes?: SceneKind[];
}

const ENERGY: Record<SceneKind, number> = {
  orbit: 0,
  sweep: 0,
  web: 0,
  counters: 0,
  moonfollow: 0,
  hub: 1,
  constellation: 1,
  drift: 1,
  egg: 1,
  earthrise: 1,
  eclipse: 1,
  flyby: 2,
  landing: 2,
};

/** Seconds at pace 1. */
const DURATION: Record<SceneKind, number> = {
  orbit: 26,
  sweep: 22,
  hub: 14,
  landing: 7.6,
  web: 18,
  constellation: 12,
  flyby: 10,
  drift: 14,
  counters: 6,
  egg: 7.5,
  earthrise: 16,
  eclipse: 16,
  moonfollow: 18,
};

/** Reduced motion (design 6.6, Ambient): still compositions that cross-fade every 20 s; the camera only cuts. */
const STILL_SECONDS = 20;
const STILL_FADE = 0.45;

/** Globe size as a fraction of the viewport height for the hero framing (the design's 92%). */
const HERO_RANGE = 2.7;

interface Pose {
  lat: number;
  lon: number;
  heading: number;
  range: number;
  tilt: number;
}

const _h = { lat: 0, lon: 0, heading: 0 };
const _hot = { lat: 0, lon: 0, score: 0 };

export class Director {
  pace = 1;
  hooks: AmbientHooks = {};
  scene: SceneKind | null = null;
  /** Scene pool (landings are always allowed). */
  private pool: SceneKind[] = [
    'orbit',
    'sweep',
    'hub',
    'web',
    'constellation',
    'flyby',
    'drift',
    'counters',
    'earthrise',
    'eclipse',
    'moonfollow',
  ];

  private running = false;
  private clock = 0;
  private sceneT = 0;
  private sceneDur = 10;
  private pausedUntil = 0;
  private readonly cam: Pose = { lat: 18, lon: 10, heading: 0, range: HERO_RANGE, tilt: 0.33 };
  private flightPending = false;
  /** Seconds left of a cross-fade out; the next scene cuts in when it reaches zero (reduced motion only). */
  private fadeWait = 0;
  private readonly history: SceneKind[] = [];
  private lastCounters = -999;
  private lastEgg = 0;
  private eggQueued = false;
  private readonly rng = new Rng(0x57ac4e);
  private readonly recentHubs: number[] = [];

  // Saved state to restore on exit
  private saved: { mesh: 'off' | 'selection' | 'flow'; spring: [number, number, number]; pose: Pose } | null =
    null;
  private touched = false;

  // Scene state
  private aLat = 0;
  private aLon = 0;
  private bLat = 0;
  private bLon = 0;
  private dir = 1;
  private heading0 = 0;
  private range0 = 0;
  private landing: {
    producer: number;
    n: number;
    slots: number[];
    rho: number;
    cLat: number;
    cLon: number;
    wide: boolean;
    phase: number;
    moon: boolean;
  } | null = null;
  /** A free-camera shot is on (released when the scene ends). */
  private freeShot = false;
  private eclipseCost = Infinity;
  private eclipseAt = -99;

  constructor(private readonly e: GlobeEngine) {}

  /** Reduced motion: still compositions, cuts instead of camera moves, a cross-fade between scenes. */
  private get still(): boolean {
    return this.e.reduced;
  }

  // ---- lifecycle --------------------------------------------------------------------------

  start(opts: AmbientOptions = {}): void {
    if (this.running) return;
    this.running = true;
    this.pace = opts.pace ?? this.pace;
    if (opts.scenes) this.pool = opts.scenes.filter((s) => s !== 'landing');
    const e = this.e;
    const rig = e.rig;
    rig.getLatLonHeading(_h);
    this.saved = {
      mesh: e.meshMode,
      spring: [rig.springPos, rig.springRange, rig.springTilt],
      pose: { lat: _h.lat, lon: _h.lon, heading: _h.heading, range: rig.range, tilt: rig.tilt },
    };
    rig.springPos = 2.6;
    rig.springRange = 2.4;
    rig.springTilt = 2.4;
    e.setMeshMode('flow');
    this.touched = false;
    this.clock = 0;
    this.pausedUntil = 0;
    this.history.length = 0;
    this.startScene('orbit', true);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const e = this.e;
    const rig = e.rig;
    this.endScene();
    e.ambientBoost.mesh = 1;
    e.ambientBoost.bloom = 1;
    e.ambientBoost.atmo = 1;
    if (this.saved) {
      rig.springPos = this.saved.spring[0];
      rig.springRange = this.saved.spring[1];
      rig.springTilt = this.saved.spring[2];
      e.setMeshMode(this.saved.mesh);
      if (!this.touched) {
        const p = this.saved.pose;
        rig.flyTo(p.lat, p.lon, p.range, { tilt: p.tilt, heading: p.heading, duration: 1.2 });
      }
    }
    this.saved = null;
    this.scene = null;
    this.landing = null;
    this.fadeWait = 0;
    e.fadeTo(1, STILL_FADE);
    if (this.freeShot) {
      this.freeShot = false;
      e.rig.releaseFree(1.6);
    }
  }

  /** The user (or the host) moved the camera: hold still for a while and do not fly back on exit. */
  interrupt(): void {
    if (!this.running) return;
    this.touched = true;
    this.pausedUntil = this.clock + 20;
  }

  /** A forced scene change (or a block landing) takes over from a pending cross-fade. */
  private cancelFade(): void {
    if (this.fadeWait <= 0) return;
    this.fadeWait = 0;
    this.e.fadeTo(1, 0.15);
  }

  /** Skips to the next scene. */
  next(): void {
    if (!this.running) return;
    this.cancelFade();
    this.pausedUntil = 0;
    this.endScene();
    this.startScene(this.choose(), false);
  }

  /** Forces a scene right now (for demos and tests). */
  play(kind: SceneKind): void {
    if (!this.running) return;
    this.cancelFade();
    this.pausedUntil = 0;
    this.endScene();
    this.startScene(kind, false);
  }

  /** Plays the easter egg at the next scene boundary (or right away when `now`). */
  queueEgg(now = false): void {
    this.eggQueued = true;
    if (now && this.running && this.scene !== 'landing') this.next();
  }

  // ---- events -----------------------------------------------------------------------------

  /**
   * A block is about to play. Starts a landing shot and returns how long the choreography should
   * wait (seconds) so the camera is already on its way when the flare goes off.
   */
  onBlockIncoming(ev: BlockEvent): number {
    if (!this.running || this.clock < this.pausedUntil) return 0;
    const e = this.e;
    const s = e.nodes;
    const ps = s.slotOf(ev.producer);
    if (ps < 0 || !Number.isFinite(s.lat[ps])) return 0;
    const slots: number[] = [ps];
    for (const p of ev.payees) {
      const k = s.slotOf(p.id);
      if (k >= 0 && Number.isFinite(s.lat[k])) slots.push(k);
    }
    this.endScene();
    this.startLanding(ev, slots);
    return e.moon.enabled ? 1.2 : 0.9;
  }

  // ---- scene machine ----------------------------------------------------------------------

  private name(lat: number, lon: number): string {
    return this.e.nameOf(lat, lon) || `${lat.toFixed(0)}, ${lon.toFixed(0)}`;
  }

  private caption(c: Omit<AmbientCaption, 'duration'> & { duration?: number }): void {
    this.e.emit('caption', { duration: c.duration ?? this.sceneDur, ...c } as AmbientCaption);
  }

  private choose(): SceneKind {
    const last = this.history[this.history.length - 1];
    const lastEnergy = last ? ENERGY[last] : 0;
    const act = this.e.activity.total();
    const busy = clamp(act / 40, 0, 1);
    if (this.eggQueued) {
      this.eggQueued = false;
      return 'egg';
    }
    const w: [SceneKind, number][] = [];
    for (const k of this.pool) {
      if (k === last) continue;
      if (ENERGY[k] >= 2 && lastEnergy >= 2) continue;
      // The moon is parked under reduced motion: a follow shot or an eclipse has nothing to follow.
      if (this.still && (k === 'eclipse' || k === 'moonfollow')) continue;
      let wt = 1;
      switch (k) {
        case 'orbit':
          wt = 1.0 + (1 - busy) * 0.8;
          break;
        case 'sweep':
          wt = 0.85;
          break;
        case 'hub':
          wt = 1.2;
          break;
        case 'web':
          wt = 0.7 + (1 - busy) * 0.7;
          break;
        case 'constellation':
          wt = this.hooks.pickApp ? 0.9 : 0;
          break;
        case 'flyby':
          wt = 0.6;
          break;
        case 'drift':
          wt = busy > 0.15 ? 0.6 + busy * 1.6 : 0;
          break;
        case 'counters':
          wt = this.clock - this.lastCounters > 110 ? 1.1 : 0;
          break;
        case 'earthrise':
          wt = this.e.moon.enabled ? 0.8 : 0;
          break;
        case 'moonfollow':
          wt = this.e.moon.enabled ? 0.7 : 0;
          break;
        case 'eclipse':
          wt = this.e.moon.enabled && this.eclipseOk() ? 1.7 : 0;
          break;
        default:
          wt = 0;
      }
      if (this.history.slice(-3).includes(k)) wt *= 0.4;
      if (wt > 0) w.push([k, wt]);
    }
    if (w.length === 0) return 'orbit';
    let sum = 0;
    for (const [, x] of w) sum += x;
    let r = this.rng.next() * sum;
    for (const [k, x] of w) {
      r -= x;
      if (r <= 0) return k;
    }
    return w[w.length - 1]![0];
  }

  private startScene(kind: SceneKind, first: boolean): void {
    const e = this.e;
    this.scene = kind;
    this.sceneT = 0;
    this.sceneDur =
      (this.still && kind !== 'egg' ? STILL_SECONDS : DURATION[kind]) *
      this.pace *
      (0.9 + hash01(this.clock * 7.7) * 0.25);
    this.dir = this.rng.next() < 0.5 ? 1 : -1;
    this.history.push(kind);
    if (this.history.length > 8) this.history.shift();
    e.ambientBoost.mesh = 1;
    e.ambientBoost.bloom = 1;
    e.ambientBoost.atmo = 1;
    this.syncFromRig();
    switch (kind) {
      case 'orbit':
        this.beginOrbit(first);
        break;
      case 'sweep':
        this.beginSweep();
        break;
      case 'hub':
        if (!this.beginHub()) {
          this.endScene();
          this.startScene('orbit', false);
        }
        break;
      case 'web':
        this.beginWeb();
        break;
      case 'constellation':
        if (!this.beginConstellation()) {
          this.endScene();
          this.startScene('orbit', false);
        }
        break;
      case 'flyby':
        if (!this.beginFlyby()) {
          this.endScene();
          this.startScene('orbit', false);
        }
        break;
      case 'drift':
        if (!this.beginDrift()) {
          this.endScene();
          this.startScene('orbit', false);
        }
        break;
      case 'counters':
        this.beginCounters();
        break;
      case 'egg':
        this.beginEgg();
        break;
      case 'earthrise':
        if (!this.beginEarthrise()) {
          this.endScene();
          this.startScene('orbit', false);
        }
        break;
      case 'eclipse':
        if (!this.beginEclipse()) {
          this.endScene();
          this.startScene('orbit', false);
        }
        break;
      case 'moonfollow':
        if (!this.beginMoonFollow()) {
          this.endScene();
          this.startScene('orbit', false);
        }
        break;
      case 'landing':
        break;
    }
  }

  /** The night-side eclipse needs the moon near the anti-sun side; ask the planner (cached for a few seconds). */
  private eclipseOk(): boolean {
    if (this.clock - this.eclipseAt > 4) {
      const e = this.e;
      this.eclipseCost = e.shots.planEclipse(
        e.moon,
        e.u.uSunDir.value,
        2 + DURATION.eclipse * this.pace * 0.5,
      );
      this.eclipseAt = this.clock;
    }
    return this.eclipseCost < 0.6;
  }

  private endScene(): void {
    const e = this.e;
    if (this.freeShot) {
      this.freeShot = false;
      if (this.still) e.rig.snapFree(false);
      else e.rig.releaseFree(1.5);
    }
    e.moon.dim = 0;
    e.ambientBoost.atmo = 1;
    if (this.scene === 'constellation') {
      e.clearAppConstellation();
      e.setMeshMode('flow');
    }
    e.ambientBoost.mesh = 1;
    e.ambientBoost.bloom = 1;
  }

  private syncFromRig(): void {
    const rig = this.e.rig;
    rig.getLatLonHeading(_h, true);
    this.cam.lat = _h.lat;
    this.cam.lon = _h.lon;
    this.cam.heading = _h.heading;
    this.cam.range = rig.rangeD;
    this.cam.tilt = rig.tiltD;
  }

  private fly(
    lat: number,
    lon: number,
    range: number,
    tilt: number,
    heading: number,
    duration: number,
  ): void {
    const rig = this.e.rig;
    if (this.still) {
      // A cut: the composition is simply there.
      rig.setPose(lat, lon, heading, range, tilt);
      this.flightPending = false;
      this.syncFromRig();
      return;
    }
    this.flightPending = true;
    rig.flyTo(lat, lon, range, { tilt, heading, duration, arc: 0.7 }).then((done) => {
      this.flightPending = false;
      if (done) this.syncFromRig();
    });
  }

  /** Hands the camera to a procedural move, damped so scene changes never snap. */
  private push(lat: number, lon: number, heading: number, range: number, tilt: number): void {
    const c = this.cam;
    c.lat = lat;
    c.lon = lon;
    c.heading = heading;
    c.range = range;
    c.tilt = tilt;
    if (this.still) return; // a still composition: nothing drifts
    this.e.rig.setDesired(lat, lon, heading, range, tilt);
  }

  // ---- the frame --------------------------------------------------------------------------

  update(dt: number): void {
    if (!this.running) return;
    this.clock += dt;
    if (this.clock < this.pausedUntil) return;
    if (this.fadeWait > 0) {
      // Reduced motion: the picture is fading out; cut to the next composition when it is black.
      this.fadeWait -= dt;
      if (this.fadeWait <= 0) {
        this.endScene();
        this.startScene(this.choose(), false);
        this.e.fadeTo(1, STILL_FADE);
      }
      return;
    }
    this.sceneT += dt;
    const k = this.scene;
    if (!k) return;
    const t = this.sceneT;
    const c = this.cam;
    const e = this.e;
    switch (k) {
      case 'orbit': {
        if (this.flightPending) break;
        const sp = 2.2 * this.dir;
        this.push(
          c.lat + Math.sin(t * 0.14) * 0.9 * dt,
          wrapLon(c.lon + sp * dt),
          c.heading * (1 - 0.6 * dt),
          lerp(c.range, this.range0 - 0.2, 1 - Math.exp(-0.2 * dt)),
          0.36 + 0.055 * Math.sin(t * 0.22 + 1.3),
        );
        break;
      }
      case 'sweep': {
        if (this.flightPending) break;
        // Slide along the terminator from north to south, tilted so the atmosphere backlights the limb.
        const p = smoothstep(0, this.sceneDur, t);
        const lat = lerp(this.aLat, this.bLat, p);
        const lon = wrapLon(this.aLon + wrapLon(e.sub.lon - this.heading0)); // follow the terminator if the sun clock is sped up
        this.push(lat, lon, c.heading * (1 - 0.6 * dt), 2.0 - 0.15 * p, 0.5 + 0.04 * Math.sin(t * 0.3));
        break;
      }
      case 'hub': {
        if (this.flightPending) break;
        const p = smoothstep(0, this.sceneDur - 2.6, t);
        this.push(c.lat, c.lon, c.heading + 0.1 * dt * this.dir, lerp(0.62, 0.44, p), lerp(0.55, 0.68, p));
        break;
      }
      case 'web': {
        if (this.flightPending) break;
        e.ambientBoost.mesh = 1.5;
        e.ambientBoost.bloom = 1.15;
        this.push(
          c.lat + Math.sin(t * 0.12) * 0.6 * dt,
          wrapLon(c.lon + 3.0 * this.dir * dt),
          0,
          3.3,
          0.22 + 0.03 * Math.sin(t * 0.2),
        );
        break;
      }
      case 'constellation': {
        if (this.flightPending) break;
        const p = smoothstep(0, this.sceneDur, t);
        this.push(
          c.lat,
          c.lon,
          c.heading * (1 - 0.5 * dt),
          lerp(this.range0, this.range0 * 0.86, p),
          0.12 + 0.12 * p,
        );
        break;
      }
      case 'flyby': {
        if (this.flightPending) break;
        const fly = Math.max(0, t - 2.6);
        const d = Math.max(1, this.sceneDur - 2.6);
        const p = clamp(fly / d, 0, 1);
        const q = easeInOutCubic(p);
        slerpLatLon(this.aLat, this.aLon, this.bLat, this.bLon, q, _h);
        // Heading follows the direction of travel (screen up = forward).
        this.push(_h.lat, _h.lon, this.heading0, 0.24 + 0.05 * Math.sin(p * Math.PI), 0.92);
        break;
      }
      case 'drift': {
        if (this.flightPending) break;
        const p = smoothstep(0, this.sceneDur, t);
        this.push(
          c.lat,
          wrapLon(c.lon + 1.5 * this.dir * dt),
          c.heading * (1 - 0.4 * dt),
          lerp(1.25, 1.05, p),
          0.42,
        );
        break;
      }
      case 'counters': {
        if (this.flightPending) break;
        this.push(
          c.lat + Math.sin(t * 0.14) * 0.9 * dt,
          wrapLon(c.lon + 2.2 * this.dir * dt),
          c.heading * (1 - 0.6 * dt),
          c.range,
          c.tilt,
        );
        break;
      }
      case 'landing':
        this.updateLanding(dt);
        break;
      case 'earthrise': {
        const pose = e.shots.earthrise(e.moon, this.still ? 0.55 : t / this.sceneDur);
        this.setFreeShot(pose, 1.0, 7);
        break;
      }
      case 'eclipse': {
        e.ambientBoost.bloom = 1.12;
        e.ambientBoost.atmo = 1.5;
        // The moon goes dark as it crosses the lit limb (a black symbol against the glow), then relights.
        const pe = t / this.sceneDur;
        e.moon.dim = smoothstep(0.18, 0.4, pe) * (1 - smoothstep(0.6, 0.85, pe));
        const pose = e.shots.eclipse(pe);
        this.setFreeShot(pose, 0.9, 5);
        break;
      }
      case 'moonfollow': {
        const pose = e.shots.follow(e.moon, this.still ? 3 : t);
        this.setFreeShot(pose, 1.0, 7);
        break;
      }
      case 'egg': {
        if (this.flightPending) break;
        this.push(c.lat, c.lon, 0, lerp(2.3, 2.15, smoothstep(0, this.sceneDur, t)), 0.12);
        break;
      }
    }
    if (t >= this.sceneDur) {
      if (this.still && this.scene !== 'landing') {
        this.fadeWait = STILL_FADE;
        this.e.fadeTo(0, STILL_FADE);
      } else {
        this.endScene();
        this.startScene(this.choose(), false);
      }
    }
  }

  /** A free-camera pose: blended in normally, a cut under reduced motion. */
  private setFreeShot(
    pose: { pos: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3 },
    rate: number,
    glide: number,
  ): void {
    const rig = this.e.rig;
    rig.setFree(pose.pos, pose.look, pose.up, rate, glide);
    if (this.still) rig.snapFree(true);
  }

  // ---- scenes -----------------------------------------------------------------------------

  private beginOrbit(first: boolean): void {
    const e = this.e;
    this.range0 = HERO_RANGE;
    if (this.still) {
      // A still has to carry the picture on its own: hold on a region where the network actually is.
      const hubs = e.getHubs(10);
      const h = hubs.length > 0 ? hubs[Math.floor(this.rng.next() * hubs.length)] : null;
      const lat = h ? clamp(h.lat * 0.7 + 8, -10, 52) : 24;
      const lon = h ? wrapLon(h.lon + (this.rng.next() - 0.5) * 36) : this.cam.lon;
      this.fly(lat, lon, HERO_RANGE, 0.3, 0, 0);
      this.caption({ kind: 'shot', title: 'Orbit', subtitle: 'The network as it lives', duration: 5 });
      return;
    }
    // Quiet orbits favor the night side, where the nodes and the city lights pop.
    const night = this.rng.next() < 0.6;
    const lon = night
      ? wrapLon(e.sub.lon + 180 + (this.rng.next() - 0.5) * 80)
      : wrapLon(this.cam.lon + this.dir * 40);
    const lat = 12 + this.rng.next() * 22;
    this.fly(lat, lon, HERO_RANGE, 0.34, 0, first ? 1.6 : 2.4);
    this.caption({
      kind: 'shot',
      title: night ? 'Night side' : 'Orbit',
      subtitle: 'The network as it lives',
      duration: 5,
    });
  }

  private beginSweep(): void {
    const e = this.e;
    const dusk = this.rng.next() < 0.5;
    const lon = wrapLon(e.sub.lon + (dusk ? 90 : -90) + (dusk ? -5 : 5));
    this.aLat = 46;
    this.bLat = -12;
    this.aLon = lon;
    this.heading0 = e.sub.lon;
    this.fly(this.aLat, lon, 2.0, 0.5, 0, 2.6);
    this.caption({
      kind: 'shot',
      title: dusk ? 'Dusk line' : 'Dawn line',
      subtitle: 'Where the sun meets the network',
      duration: 6,
    });
  }

  private beginHub(): boolean {
    const e = this.e;
    const hubs = e.getHubs(40);
    if (hubs.length === 0) return false;
    let total = 0;
    const wts: number[] = [];
    for (let i = 0; i < hubs.length; i++) {
      const w = this.recentHubs.includes(hubs[i]!.cluster) ? 0 : hubs[i]!.count ** 0.7;
      wts.push(w);
      total += w;
    }
    if (total <= 0) return false;
    let r = this.rng.next() * total;
    let pick = 0;
    for (let i = 0; i < hubs.length; i++) {
      r -= wts[i]!;
      if (r <= 0) {
        pick = i;
        break;
      }
    }
    const h = hubs[pick]!;
    this.recentHubs.push(h.cluster);
    if (this.recentHubs.length > 6) this.recentHubs.shift();
    this.fly(h.lat, h.lon, 0.62, 0.55, (this.rng.next() - 0.5) * 1.4, 2.8);
    const place = this.name(h.lat, h.lon);
    this.caption({
      kind: 'shot',
      title: place,
      subtitle: `${h.count.toLocaleString('en-US')} nodes at one site`,
      duration: Math.max(6, this.sceneDur - 2),
    });
    return true;
  }

  private beginWeb(): void {
    this.fly(14 + this.rng.next() * 16, wrapLon(this.cam.lon + this.dir * 50), 3.3, 0.22, 0, 2.6);
    this.caption({ kind: 'shot', title: 'The mesh', subtitle: 'Nodes talking to their peers', duration: 7 });
  }

  private beginConstellation(): boolean {
    const e = this.e;
    const pick = this.hooks.pickApp?.(this.rng);
    if (!pick) return false;
    const s = e.nodes;
    let n = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const slots: number[] = [];
    for (let i = 0; i < pick.ids.length; i++) {
      const k = s.slotOf(pick.ids[i]!);
      if (k < 0 || !Number.isFinite(s.lat[k])) continue;
      slots.push(k);
      cx += s.dir[k * 3]!;
      cy += s.dir[k * 3 + 1]!;
      cz += s.dir[k * 3 + 2]!;
      n++;
    }
    if (n < 2) return false;
    const l = Math.hypot(cx, cy, cz) || 1;
    cx /= l;
    cy /= l;
    cz /= l;
    let rho = 0.05;
    for (const k of slots)
      rho = Math.max(rho, angleBetween(cx, cy, cz, s.dir[k * 3]!, s.dir[k * 3 + 1]!, s.dir[k * 3 + 2]!));
    const range = clamp(rangeToFit(rho, e.rig.fovV, e.rig.aspect, 1.45), 0.8, 3.4);
    const lat = Math.asin(clamp(cy, -1, 1)) * RAD;
    const lon = Math.atan2(cx, cz) * RAD;
    this.range0 = range;
    // The app's own links are the subject: the rolling mesh steps aside until the scene ends.
    e.setMeshMode('selection');
    e.showAppConstellation(pick.ids, { name: pick.name, fly: false });
    this.fly(lat, lon, range, 0.1, 0, 2.6);
    this.caption({
      kind: 'app',
      title: pick.name,
      subtitle: pick.detail,
      duration: Math.max(6, this.sceneDur - 2),
    });
    return true;
  }

  private beginFlyby(): boolean {
    const e = this.e;
    const hubs = e.getHubs(30);
    if (hubs.length < 2) return false;
    const a = hubs[Math.floor(this.rng.next() * Math.min(12, hubs.length))]!;
    // A second site 3 to 20 degrees away, so the pass crosses real infrastructure.
    let best: (typeof hubs)[number] | null = null;
    let bestScore = -1;
    for (const h of hubs) {
      if (h === a) continue;
      const d = geoDistance(a.lat, a.lon, h.lat, h.lon);
      if (d < 0.05 || d > 0.4) continue;
      const score = h.count * (0.6 + this.rng.next() * 0.8);
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    if (!best) return false;
    this.aLat = a.lat;
    this.aLon = a.lon;
    this.bLat = best.lat;
    this.bLon = best.lon;
    this.heading0 = bearing(a.lat, a.lon, best.lat, best.lon);
    this.fly(a.lat, a.lon, 0.3, 0.92, this.heading0, 2.6);
    this.caption({
      kind: 'shot',
      title: `${this.name(a.lat, a.lon)} to ${this.name(best.lat, best.lon)}`,
      subtitle: 'A low pass between two sites',
      duration: this.sceneDur - 1,
    });
    return true;
  }

  private beginDrift(): boolean {
    const e = this.e;
    if (!e.activity.hottest(_hot)) return false;
    this.fly(_hot.lat, _hot.lon, 1.25, 0.42, 0, 2.6);
    this.caption({
      kind: 'region',
      title: `Activity over ${this.name(_hot.lat, _hot.lon)}`,
      subtitle: 'Where the last minute happened',
      duration: this.sceneDur - 1,
    });
    return true;
  }

  // The Flux moon shots. Each is a free camera that follows the moon (or waits for it, for the eclipse).

  private beginEarthrise(): boolean {
    const e = this.e;
    if (!e.moon.enabled) return false;
    this.freeShot = true;
    const pose = e.shots.earthrise(e.moon, this.still ? 0.55 : 0);
    this.setFreeShot(pose, 1.0, 7);
    this.caption({
      kind: 'shot',
      title: 'Earthrise',
      subtitle: 'Seen from the Flux moon',
      duration: Math.max(6, this.sceneDur - 3),
    });
    return true;
  }

  private beginEclipse(): boolean {
    const e = this.e;
    if (!e.moon.enabled) return false;
    // Plan for the middle of the shot (the blend-in takes about two seconds).
    const cost = e.shots.planEclipse(e.moon, e.u.uSunDir.value, 2 + this.sceneDur * 0.5);
    if (cost > 0.8) return false;
    this.freeShot = true;
    const pose = e.shots.eclipse(0);
    this.setFreeShot(pose, 0.9, 5);
    this.caption({
      kind: 'shot',
      title: 'Eclipse',
      subtitle: 'The Flux moon crosses the sunlit limb',
      duration: Math.max(6, this.sceneDur - 3),
    });
    return true;
  }

  private beginMoonFollow(): boolean {
    const e = this.e;
    if (!e.moon.enabled) return false;
    this.freeShot = true;
    const pose = e.shots.follow(e.moon, this.still ? 3 : 0);
    this.setFreeShot(pose, 1.0, 7);
    this.caption({
      kind: 'shot',
      title: 'The Flux moon',
      subtitle: 'Every block is sealed here, then paid out',
      duration: Math.max(6, this.sceneDur - 3),
    });
    return true;
  }

  private beginCounters(): void {
    this.lastCounters = this.clock;
    this.range0 = this.cam.range;
    this.caption({ kind: 'stats', title: 'The network now', duration: this.sceneDur });
  }

  private beginEgg(): void {
    const lat = 47;
    const lon = 9;
    this.lastEgg = this.clock;
    this.fly(lat, lon, 2.3, 0.12, 0, 2.2);
    this.caption({
      kind: 'egg',
      title: 'stache.beer',
      subtitle: 'brewed, not hosted',
      duration: this.sceneDur - 0.5,
    });
    this.e.playEgg(lat, lon);
  }

  // ---- landing ----------------------------------------------------------------------------

  private startLanding(ev: BlockEvent, slots: number[]): void {
    const e = this.e;
    const s = e.nodes;
    this.cancelFade();
    this.scene = 'landing';
    this.sceneT = 0;
    this.sceneDur = DURATION.landing * this.pace;
    this.history.push('landing');
    if (this.history.length > 8) this.history.shift();
    e.ambientBoost.mesh = 1;
    e.ambientBoost.bloom = 1;
    const ps = slots[0]!;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const k of slots) {
      cx += s.dir[k * 3]!;
      cy += s.dir[k * 3 + 1]!;
      cz += s.dir[k * 3 + 2]!;
    }
    const l = Math.hypot(cx, cy, cz);
    let cLat: number;
    let cLon: number;
    let rho = 0.05;
    if (l < 0.15) {
      cLat = s.lat[ps]!;
      cLon = s.lon[ps]!;
      rho = 1.6;
    } else {
      cx /= l;
      cy /= l;
      cz /= l;
      cLat = Math.asin(clamp(cy, -1, 1)) * RAD;
      cLon = Math.atan2(cx, cz) * RAD;
      for (const k of slots)
        rho = Math.max(rho, angleBetween(cx, cy, cz, s.dir[k * 3]!, s.dir[k * 3 + 1]!, s.dir[k * 3 + 2]!));
    }
    const wide = rho > 0.45;
    const moon = e.moon.enabled && !this.still ? e.moon : null;
    this.landing = {
      producer: ps,
      n: slots.length,
      slots,
      rho,
      cLat,
      cLon,
      wide,
      phase: 0,
      moon: moon !== null,
    };
    const pl = s.lat[ps]!;
    const po = s.lon[ps]!;
    if (moon) {
      // Shot 1 frames the whole route: producer, the moon that relays the block, and the payees.
      const pts: THREE.Vector3[] = slots.map(
        (k) => new THREE.Vector3(s.dir[k * 3], s.dir[k * 3 + 1], s.dir[k * 3 + 2]),
      );
      const pose = e.shots.planWide(moon, pts, 1.7, e.rig.fovV, e.rig.aspect);
      this.freeShot = true;
      e.rig.setFree(pose.pos, pose.look, pose.up, 2.6, 2.6);
      // Meanwhile the standard camera heads for the payees, ready for shot 2.
      const range = wide
        ? rho > 1.25
          ? 3.3
          : clamp(rangeToFit(rho + 0.1, e.rig.fovV, e.rig.aspect, 1.6), 0.9, 3.3)
        : clamp(rangeToFit(rho + 0.06, e.rig.fovV, e.rig.aspect, 1.7), 0.5, 2.4);
      this.fly(cLat, cLon, range, 0.3, 0, 3.8);
      // The beams are the subject of this shot: thin out the mesh veil behind them.
      e.ambientBoost.mesh = 0.35;
    } else if (wide) {
      // Shot 1: cut in to the producer, 1.2 s, so the flare and shockwave are in frame.
      this.fly(pl, po, 1.15, 0.4, (this.rng.next() - 0.5) * 0.5, 1.2);
    } else {
      this.fly(
        cLat,
        cLon,
        clamp(rangeToFit(rho + 0.06, e.rig.fovV, e.rig.aspect, 1.7), 0.5, 2.4),
        0.36,
        (this.rng.next() - 0.5) * 0.5,
        1.3,
      );
    }
    // The caption names the route: producer to payees.
    const producerName = this.name(pl, po);
    const payeeNames: string[] = [];
    const payees: { name: string; tier: number; amount: number }[] = [];
    for (let i = 1; i < slots.length; i++) {
      const k = slots[i]!;
      const nm = this.name(s.lat[k]!, s.lon[k]!);
      payeeNames.push(nm);
      const match = ev.payees.find((p) => p.id === s.id[k]);
      payees.push({ name: nm, tier: s.tier[k]!, amount: match?.amount ?? 0 });
    }
    this.caption({
      kind: 'block',
      title: `Block ${ev.height.toLocaleString('en-US')}`,
      subtitle: `${producerName} to ${payeeNames.join(', ')}`,
      height: ev.height,
      producerName,
      payeeNames,
      payees,
      duration: 9,
    });
  }

  private updateLanding(dt: number): void {
    const L = this.landing;
    if (!L) return;
    const t = this.sceneT;
    const c = this.cam;
    const e = this.e;
    if (L.moon) {
      // Shot 2: leave the wide frame and come down onto the payees while their pulses play.
      if (L.phase === 0 && t > 3.7) {
        L.phase = 1;
        this.freeShot = false;
        e.rig.releaseFree(1.3);
        e.ambientBoost.mesh = 0.8;
      }
      if (this.flightPending) return;
      this.push(c.lat, c.lon, c.heading * (1 - 0.3 * dt), c.range * (1 - 0.012 * dt), c.tilt);
      return;
    }
    // Shot 2 (wide routes only): after the flare, pull back and frame producer and payees.
    if (L.wide && L.phase === 0 && t > 2.1) {
      L.phase = 1;
      const range =
        L.rho > 1.25 ? 3.3 : clamp(rangeToFit(L.rho + 0.1, e.rig.fovV, e.rig.aspect, 1.6), 0.9, 3.3);
      this.fly(L.cLat, L.cLon, range, L.rho > 1.25 ? 0.22 : 0.3, 0, 1.9);
    }
    if (this.flightPending) return;
    // Hold with a slow push-in; the choreography (shockwave, beams, pulses) plays out in frame.
    this.push(c.lat, c.lon, c.heading * (1 - 0.3 * dt), c.range * (1 - 0.012 * dt), c.tilt);
  }

  get idleFor(): number {
    return this.clock - this.lastEgg;
  }
}

// ---- helpers ------------------------------------------------------------------------------

function wrapLon(l: number): number {
  return ((((l + 180) % 360) + 360) % 360) - 180;
}

function latLonXyz(lat: number, lon: number): [number, number, number] {
  const la = lat * DEG;
  const lo = lon * DEG;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * DEG;
  const p2 = lat2 * DEG;
  const dl = (lon2 - lon1) * DEG;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return wrapPi(Math.atan2(y, x));
}

function slerpLatLon(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  t: number,
  out: { lat: number; lon: number },
): void {
  const [x1, y1, z1] = latLonXyz(lat1, lon1);
  const [x2, y2, z2] = latLonXyz(lat2, lon2);
  const d = Math.acos(clamp(x1 * x2 + y1 * y2 + z1 * z2, -1, 1));
  if (d < 1e-5) {
    out.lat = lat1;
    out.lon = lon1;
    return;
  }
  const a = Math.sin((1 - t) * d) / Math.sin(d);
  const b = Math.sin(t * d) / Math.sin(d);
  const x = a * x1 + b * x2;
  const y = a * y1 + b * y2;
  const z = a * z1 + b * z2;
  out.lat = Math.asin(clamp(y, -1, 1)) * RAD;
  out.lon = Math.atan2(x, z) * RAD;
}
