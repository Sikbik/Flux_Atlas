// Globe lab entry point. Wires the engine to data, the fake live feed, the dev HUD and overlays.
//
// URL parameters (handy for screenshots):
//   art=dotmatrix|marble|neon   quality=auto|high|medium|low   nodes=real|synth15|synth30
//   ambient=1  feed=0  speed=N  hud=0  labels=0  intro=0  dpr=N  mesh=off|selection|flow
//   cam=lat,lon,range[,tilt]    sun=ISO-8601 UTC (freezes the sun)
//   select=<node id>            app=<app index>          sound=1 (still needs a click)
//   driver=sink (blocks and next payees through engine.sink instead of engine.enqueue)
//   boot=1 (play the boot: the symbol assembles, the planet is revealed, it lifts off and becomes the moon)
//   moon=0 (off)  moonmode=auto|companion|orbit  moonphase=<deg> (frozen, orbit mode)  moonclock=<s along the orbit>
//   moonview=portrait|earthrise|eclipse|follow  moonat=<s>  moondur=<s>

import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './fonts.css';
import './design-tokens.css';
import './styles.css';

import { GlobeEngine } from '../engine/GlobeEngine';
import { tokensFromCss } from '../engine/tokens';
import type { ArtDirection, QualityLevel } from '../engine/types';
import { Rng } from '../engine/math';
import { AmbientSound } from '../engine/ambient/sound';
import { AimLabels } from './aimLabels';
import { applyBoot, bootState, nearestNode, playBoot } from './boot';
import { AmbientOverlay } from './ambientOverlay';
import { loadRealSnapshot, synthesize, appInstances, type LabData } from './data';
import { ExploreOverlay } from './explore';
import { Feed } from './feed';
import { placeName } from './gazetteer';
import { Hud } from './hud';
import { SinkDriver } from './sinkDriver';

const params = new URLSearchParams(location.search);
const base = import.meta.env.BASE_URL;
const canvas = document.getElementById('globe') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;

interface Lab {
  engine: GlobeEngine;
  feed: Feed | null;
  data: LabData;
  hud: Hud | null;
  ambient: AmbientOverlay;
  sound: AmbientSound;
  explore: ExploreOverlay;
  aim: AimLabels;
  /** Plays the boot sequence in real time. */
  boot: () => Promise<void>;
  /** Applies the boot's state `t` seconds in (for deterministic screenshots), with the reveal starting at the node nearest `lat`, `lon`. */
  bootAt: (t: number, lat?: number, lon?: number) => void;
}
declare global {
  interface Window {
    __lab?: Lab;
    engine?: GlobeEngine;
  }
}

async function makeData(kind: string): Promise<LabData> {
  if (kind === 'synth15') return synthesize(15000, 3);
  if (kind === 'synth30') return synthesize(30000, 4);
  try {
    return await loadRealSnapshot(base);
  } catch (e) {
    console.warn('[lab] real snapshot unavailable, using synthetic data', e);
    return synthesize(6700, 2);
  }
}

/** The apps the ambient director may showcase: the biggest ones, with a readable spread. */
function makeAppPicker(getData: () => LabData): (rng: Rng) => { name: string; ids: ArrayLike<number>; detail: string } | null {
  return (rng) => {
    const d = getData();
    const n = d.apps.names.length;
    if (n === 0) return null;
    const top: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = d.apps.offsets[i + 1] - d.apps.offsets[i];
      if (c >= 3) top.push(i);
    }
    top.sort((a, b) => d.apps.offsets[b + 1] - d.apps.offsets[b] - (d.apps.offsets[a + 1] - d.apps.offsets[a]));
    const pool = top.slice(0, 20);
    if (pool.length === 0) return null;
    const i = pool[rng.int(pool.length)];
    const ids = appInstances(d.apps, i);
    let detail = `${ids.length} instances`;
    if (d.countryIdx) {
      const idx = new Map<number, number>();
      for (let k = 0; k < d.cols.ids.length; k++) idx.set(d.cols.ids[k], k);
      const seen = new Set<number>();
      for (const id of ids) {
        const k = idx.get(id);
        if (k !== undefined) seen.add(d.countryIdx[k]);
      }
      detail = `${ids.length} instances, ${seen.size} ${seen.size === 1 ? 'country' : 'countries'}`;
    }
    return { name: d.apps.names[i], ids, detail };
  };
}

async function boot(): Promise<void> {
  const art = (params.get('art') as ArtDirection | null) ?? 'marble';
  const quality = (params.get('quality') as QualityLevel | null) ?? 'auto';
  let engine: GlobeEngine;
  try {
    engine = new GlobeEngine(canvas, {
      assetBase: base,
      artDirection: art,
      quality,
      maxDpr: params.get('dpr') ? Number(params.get('dpr')) : 2,
    });
  } catch (e) {
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;font:14px/1.5 var(--font-mono, monospace);color:#9799a8;text-align:center;padding:24px';
    msg.textContent = `This browser cannot run the globe (${(e as Error).message}).`;
    document.body.append(msg);
    throw e;
  }
  engine.nameOf = placeName;
  engine.setEffects({ labels: params.get('labels') !== '0' });
  // The design system is the source of the globe's colors: read the live `--globe-*` tokens.
  engine.setDesignTokens(tokensFromCss(document.documentElement, engine.tokens));
  const meshParam = params.get('mesh');
  if (meshParam === 'off' || meshParam === 'selection' || meshParam === 'flow') engine.setMeshMode(meshParam);
  else engine.setMeshMode('selection');

  const rig = engine.rig;
  const cam = params.get('cam');
  if (cam) {
    const [la, lo, r, t] = cam.split(',').map(Number);
    rig.setPose(la, lo, 0, r ?? 3.4, t ?? 0);
  }
  const sun = params.get('sun');
  if (sun) engine.setSunTime(Date.parse(sun));
  if (params.get('moon') === '0') engine.setMoon({ enabled: false });
  const moonMode = params.get('moonmode');
  if (moonMode === 'auto' || moonMode === 'companion' || moonMode === 'orbit') engine.setMoon({ mode: moonMode });
  if (params.get('moonphase')) engine.setMoon({ phase: Number(params.get('moonphase')) });
  if (params.get('moonclock')) engine.moon.clock = Number(params.get('moonclock'));

  // The phone's moon is 0.86 of the desktop's (design 7.10.2).
  const fitMoon = (): void => engine.setMoon({ scale: window.innerWidth < 720 ? 0.86 : 1 });
  fitMoon();
  window.addEventListener('resize', fitMoon);

  let data = await makeData(params.get('nodes') ?? 'real');
  const bootOn = params.get('boot') === '1';
  engine.setNodes(data.cols, { intro: params.get('intro') !== '0' && !bootOn });
  engine.setMesh(data.meshA, data.meshB);

  const explore = new ExploreOverlay(engine, overlay);
  explore.setData(data);
  explore.labels = params.get('labels') !== '0';
  explore.chain = () => ({ height: feed?.height ?? data.tip, nextIn: feed?.nextIn ?? 18 });
  const aim = new AimLabels(engine, overlay);
  const sound = new AmbientSound(engine);

  let feed: Feed | null = null;
  const ambient = new AmbientOverlay(engine, overlay, () => data, () => feed?.height ?? data.tip);
  // The boot: the reveal wave starts at the node nearest the camera target.
  const bootOrigin = (lat?: number, lon?: number): number | null => {
    if (lat !== undefined && lon !== undefined) return nearestNode(engine, lat, lon);
    const ll = { lat: 0, lon: 0, heading: 0 };
    engine.rig.getLatLonHeading(ll);
    return nearestNode(engine, ll.lat, ll.lon);
  };
  const runBoot = async (): Promise<void> => {
    // The labels belong to the planet: they come back when the moon has taken over.
    explore.enabled = false;
    await playBoot(engine, { origin: bootOrigin() });
    explore.enabled = engine.mode === 'explore';
  };
  const bootAt = (t: number, lat?: number, lon?: number): void => {
    applyBoot(engine, bootState(t, engine.reduced), { origin: bootOrigin(lat, lon) });
  };
  const lab: Lab = { engine, feed, data, hud: null, ambient, sound, explore, aim, boot: runBoot, bootAt };
  window.__lab = lab;
  window.engine = engine;

  const startFeed = (): void => {
    feed?.stop();
    // `?driver=sink` plays blocks through the effect sink, like an app with its own choreographer.
    feed = new Feed(engine, data, 5, params.get('driver') === 'sink' ? new SinkDriver(engine) : null);
    if (params.get('speed')) feed.setSpeed(Number(params.get('speed')));
    lab.feed = feed;
    feed.onLog = (l) => lab.hud?.log(l);
    if (params.get('feed') !== '0') feed.start();
  };
  startFeed();

  // The moon's chain: the last dozen blocks of history, one every ~30 s, each at the moon's angle
  // when it was sealed. (The app passes real recent blocks here.)
  {
    const tip = lab.feed?.height ?? data.tip;
    const now = Date.now();
    const rr = new Rng(0x3a11);
    const past: { height: number; time: number }[] = [];
    for (let k = 1; k <= 12; k++) past.push({ height: tip - k + 1, time: now - k * 30000 + Math.round((rr.next() - 0.5) * 14000) });
    engine.seedMoonChain(past);
  }

  const pickApp = makeAppPicker(() => data);
  const setAmbient = (on: boolean): void => {
    engine.setMode(on ? 'ambient' : 'explore');
    if (on && engine.director) engine.director.hooks.pickApp = pickApp;
    ambient.setActive(on);
    explore.enabled = !on;
    aim.enabled = true;
    lab.hud?.refresh();
  };

  if (params.get('hud') !== '0') {
    lab.hud = new Hud(
      engine,
      () => feed,
      {
        setData: async (kind) => {
          data = await makeData(kind);
          lab.data = data;
          engine.select(null);
          engine.clearAppConstellation();
          engine.setNodes(data.cols, { animate: false, intro: true });
          engine.setMesh(data.meshA, data.meshB);
          explore.setData(data);
          lab.hud?.setApps(data);
          startFeed();
          lab.hud?.log(`loaded ${data.label}`);
        },
        setAmbient,
        showApp: (i) => {
          engine.showAppConstellation(appInstances(data.apps, i), { name: data.apps.names[i] });
          lab.hud?.log(`constellation ${data.apps.names[i]}`);
        },
        clearApp: () => engine.clearAppConstellation(),
        onSound: (on) => sound.setEnabled(on),
        boot: () => void runBoot(),
      },
      overlay,
    );
    lab.hud.setApps(data);
    lab.hud.log(data.label);
  }

  // Keyboard: A toggles ambient, H toggles the HUD, M is the moon's click, Escape clears selection.
  // Typing "stache" is a small greeting.
  let typed = '';
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'SELECT' || tag === 'INPUT') return;
    engine.notifyKey();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    typed = (typed + e.key.toLowerCase()).slice(-6);
    if (typed === 'stache') {
      engine.ambient.egg();
      typed = '';
      return;
    }
    if (engine.mode === 'ambient') return; // any other key just wakes (handled by the wake event)
    if (e.key === 'a' || e.key === 'A') setAmbient(true);
    else if (e.key === 'h' || e.key === 'H') lab.hud?.root.classList.toggle('collapsed');
    else if (e.key === 'm' || e.key === 'M') engine.moonClick();
    else if (e.key === 'Escape') {
      engine.select(null);
      engine.clearAppConstellation();
    }
  });
  // The selection card is docked UI: the moon's orbit gives way to it (and comes back when it closes).
  engine.on('select', (p) => {
    const phone = window.innerWidth < 720;
    engine.setInset(p && !p.isCluster ? (phone ? { left: 0, right: 0, top: 0, bottom: 250 } : { left: 0, right: 298, top: 0, bottom: 0 }) : { left: 0, right: 0, top: 0, bottom: 0 });
  });
  // Any input wakes the screensaver.
  engine.on('wake', () => {
    if (engine.mode === 'ambient' && ambient.canWake()) setAmbient(false);
  });

  if (params.get('select')) engine.select(Number(params.get('select')), { fly: params.get('fly') !== '0' });
  if (params.get('app')) {
    const i = Number(params.get('app'));
    engine.showAppConstellation(appInstances(data.apps, i), { name: data.apps.names[i], fly: params.get('fly') !== '0' });
  }
  if (bootOn) void runBoot();
  if (params.get('ambient') === '1') setAmbient(true);
  const moonView = params.get('moonview');
  if (moonView && params.get('ambient') !== '1') {
    engine.viewMoon(moonView as 'portrait' | 'earthrise' | 'eclipse' | 'follow', { at: params.get('moonat') ? Number(params.get('moonat')) : undefined, duration: params.get('moondur') ? Number(params.get('moondur')) : undefined, rate: 30 });
  }
  if (params.get('sound') === '1') {
    // Browsers only start audio after a gesture: arm it for the first click or key.
    const arm = (): void => {
      sound.setEnabled(true);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
    window.addEventListener('pointerdown', arm);
    window.addEventListener('keydown', arm);
  }

  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    engine.setBeat(feed?.beat ?? 0);
    explore.update(dt);
    aim.update();
    lab.hud?.update(dt);
    ambient.update(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

void boot();
