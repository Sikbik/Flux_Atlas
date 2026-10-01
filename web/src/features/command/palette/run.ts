// Running a row or an action. Every command surface ends here: opening something is a navigation (the
// globe follows the URL), flying is the engine's camera, and settings are the stores. The palette and the
// terminal share this file so "layer mesh flow" does the same thing wherever it is typed.

import type { AnyRouter } from '@tanstack/react-router';
import { toast } from '../../../app/toasts';
import type { EffectSink } from '../../../choreo/effects';
import type { GlobeTarget } from '../../../globe';
import type { NetworkStore } from '../../../store/network';
import { effectiveMotion, type GlobeArtPref, type MotionPref, type PerfPref, useUi } from '../../../store/ui';
import { track } from '../../achievements/events';
import { enterAmbient, hrefWithoutPalette } from '../../ambient/enter';
import { usePrefs } from '../../settings/prefs';
import { activeFilters, FILTER_KEYS, type FilterLookup, parseFilterExpr } from '../filters';
import type { MeshMode } from '../layers';
import { withLayer, withMeshMode } from '../layers';
import { type NavTarget, navigateTo } from '../navigation';
import type { ActionEnv } from './actions';
import { GM_ACTION, playGm } from './egg';
import { getLocalIndex } from './local';
import { rememberRow } from './recents';
import type { FlyView, PaletteRow } from './types';

export interface RunCtx {
  router: AnyRouter;
  store: NetworkStore;
  engine: () => GlobeTarget | null;
  /** Closes the surface after an action that does not navigate (the palette removes its `q`). */
  dismiss: () => void;
  /**
   * The results page and the terminal run rows from a route of their own: opening pushes an entry (Back
   * returns to the list), and rows that would only change the search of the current route (filters)
   * go to the globe instead.
   */
  page?: boolean;
  /** The effect sink the moon answers to (the hidden greeting flashes it); absent where there is no globe. */
  effects?: Pick<EffectSink, 'moonFlare'>;
}

export type RunMode = 'open' | 'alongside' | 'fly';

export type RunResult = { kind: 'closed' } | { kind: 'text'; text: string } | { kind: 'stay' };

type SearchRecord = Record<string, unknown>;

/** What the catalogue needs to describe the app right now. */
export function readActionEnv(router: AnyRouter): ActionEnv {
  const loc = router.state.location;
  const ui = useUi.getState();
  const prefs = usePrefs.getState();
  return {
    search: loc.search as SearchRecord,
    pathname: loc.pathname,
    motion: ui.motion,
    perf: ui.perf,
    art: ui.globeArt,
    ambientIdleMin: prefs.ambientIdleMin,
    sound: prefs.ambientSound,
  };
}

export function parseFlyArg(arg: string | undefined): FlyView | null {
  if (!arg) return null;
  const [lat, lon, alt] = arg.split(',').map(Number);
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, alt: Number.isFinite(alt) && alt !== undefined ? alt : 1 };
}

function lookupOf(store: NetworkStore): FilterLookup {
  const i = getLocalIndex(store);
  return { countries: i.countries, providers: i.providers, versions: i.versions };
}

/** Flies the camera; says so when there is no globe to fly. */
export function flyTo(ctx: RunCtx, v: FlyView): boolean {
  const e = ctx.engine();
  if (!e) {
    toast({
      kind: 'info',
      title: 'The globe is not running here',
      body: 'There is nothing to fly the camera over.',
    });
    return false;
  }
  void e.flyTo(v.lat, v.lon, v.alt);
  track({ type: 'ui', what: 'fly' });
  return true;
}

function stay(ctx: RunCtx, patch: { search?: SearchRecord; clear?: readonly string[] }): void {
  const target: NavTarget = { to: '.', stay: true, ...patch };
  navigateTo(ctx.router, target, 'open', { replace: true });
}

function filterTarget(parsed: ReturnType<typeof parseFilterExpr>): { search: SearchRecord; clear: string[] } {
  return {
    search: parsed.patch.set as SearchRecord,
    clear: [...parsed.patch.clear, ...(parsed.clearAll ? FILTER_KEYS : [])],
  };
}

/** Applies a filter expression; a catalogue toggle removes what is already in force. */
function applyFilters(ctx: RunCtx, expr: string, toggle: boolean): void {
  const parsed = parseFilterExpr(expr, lookupOf(ctx.store));
  const search = ctx.router.state.location.search as SearchRecord;
  if (toggle) {
    const cur = activeFilters(search);
    const keys = Object.keys(parsed.patch.set) as (keyof typeof cur)[];
    const inForce = keys.length > 0 && keys.every((k) => cur[k] === (parsed.patch.set as SearchRecord)[k]);
    if (inForce) {
      stay(ctx, { clear: keys });
      track({ type: 'ui', what: 'filter', value: 'off' });
      return;
    }
  }
  if (parsed.unknown.length > 0) {
    toast({
      kind: 'info',
      title: 'Part of that filter was not understood',
      body: `Ignored: ${parsed.unknown.join(', ')}`,
    });
  }
  stay(ctx, filterTarget(parsed));
  track({ type: 'ui', what: 'filter', value: 'on' });
}

function setMesh(ctx: RunCtx, mode: MeshMode): void {
  const l = (ctx.router.state.location.search as SearchRecord).l;
  const next = withMeshMode(typeof l === 'string' ? l : undefined, mode);
  stay(ctx, next === undefined ? { clear: ['l'] } : { search: { l: next } });
  track({ type: 'ui', what: 'layer', value: `mesh.${mode}` });
}

function setLabels(ctx: RunCtx, on: boolean): void {
  const l = (ctx.router.state.location.search as SearchRecord).l;
  const next = withLayer(typeof l === 'string' ? l : undefined, 'labels', on);
  stay(ctx, next === undefined ? { clear: ['l'] } : { search: { l: next } });
  track({ type: 'ui', what: 'layer', value: on ? 'labels.on' : 'labels.off' });
}

async function copyLink(ctx: RunCtx): Promise<void> {
  const href = new URL(hrefWithoutPalette(ctx.router), window.location.origin).toString();
  try {
    await navigator.clipboard.writeText(href);
    toast({
      kind: 'success',
      title: 'Link copied',
      body: 'It holds this exact view: camera, filters and windows.',
    });
    track({ type: 'ui', what: 'copy' });
  } catch {
    toast({
      kind: 'warning',
      title: 'Could not copy the link',
      body: 'The browser blocked clipboard access.',
    });
  }
}

/** The hidden greeting: the moon's pieces answer in turn, and the visitor has found the egg. */
function sayGm(ctx: RunCtx): void {
  playGm(ctx.effects, ctx.store.tip?.height ?? 0, effectiveMotion(useUi.getState().motion));
  track({ type: 'egg' });
}

/** Runs an action by id. Navigating actions replace the palette's history entry; the rest dismiss it. */
export function runAction(id: string, arg: string | undefined, ctx: RunCtx): void {
  const ui = useUi.getState();
  const prefs = usePrefs.getState();
  if (id === GM_ACTION) {
    ctx.dismiss();
    sayGm(ctx);
    return;
  }
  if (id === 'fly') {
    const v = parseFlyArg(arg);
    if (v) flyTo(ctx, v);
    ctx.dismiss();
    return;
  }
  if (id === 'ambient.enter') {
    ctx.dismiss();
    enterAmbient(ctx.router, 'manual');
    return;
  }
  if (id.startsWith('art.')) {
    ui.setGlobeArt(id.slice(4) as GlobeArtPref);
    track({ type: 'ui', what: 'art', value: id.slice(4) });
    ctx.dismiss();
    return;
  }
  if (id.startsWith('motion.')) {
    ui.setMotion(id.slice(7) as MotionPref);
    track({ type: 'ui', what: 'motion', value: id.slice(7) });
    ctx.dismiss();
    return;
  }
  if (id.startsWith('perf.')) {
    ui.setPerf(id.slice(5) as PerfPref);
    track({ type: 'ui', what: 'perf', value: id.slice(5) });
    ctx.dismiss();
    return;
  }
  if (id === 'sound.toggle') {
    const on = !prefs.ambientSound;
    prefs.setAmbientSound(on);
    track({ type: 'ui', what: 'sound', value: on ? 'on' : 'off' });
    toast({
      kind: 'info',
      title: on ? 'Ambient sound on' : 'Ambient sound off',
      ...(on ? { body: 'A quiet pad plays only while ambient mode runs.' } : {}),
    });
    ctx.dismiss();
    return;
  }
  if (id === 'copy.link') {
    ctx.dismiss();
    void copyLink(ctx);
    return;
  }
  if (id.startsWith('layer.mesh.')) {
    setMesh(ctx, id.slice(11) as MeshMode);
    return;
  }
  if (id === 'layer.labels.on' || id === 'layer.labels.off') {
    setLabels(ctx, id.endsWith('.on'));
    return;
  }
  if (id === 'filter.clear') {
    stay(ctx, { clear: FILTER_KEYS });
    track({ type: 'ui', what: 'filter', value: 'off' });
    return;
  }
  if (id === 'filter.apply') {
    applyFilters(ctx, arg ?? '', false);
    return;
  }
  if (id.startsWith('filter.')) {
    applyFilters(ctx, arg ?? '', true);
    return;
  }
  ctx.dismiss();
}

/** Runs a row the way its key asked: Enter opens, Shift+Enter opens alongside, Alt+Enter only flies. */
export function runRow(row: PaletteRow, mode: RunMode, ctx: RunCtx): RunResult {
  const a = row.action;
  if (a.type === 'type') return { kind: 'text', text: a.text };
  if (a.type === 'none') return { kind: 'stay' };
  if (mode === 'fly' && row.fly) {
    flyTo(ctx, row.fly);
    ctx.dismiss();
    rememberRow(row);
    track({ type: 'palette', action: 'run', kind: row.kind });
    return { kind: 'closed' };
  }
  if (a.type === 'go') {
    const target: NavTarget = ctx.page && a.target.stay ? { ...a.target, stay: false, to: '/' } : a.target;
    navigateTo(ctx.router, target, mode === 'alongside' && row.alongside ? 'alongside' : 'open', {
      replace: !ctx.page,
    });
    if (row.alsoFly && row.fly) flyTo(ctx, row.fly);
  } else {
    runAction(a.id, a.arg, ctx);
  }
  rememberRow(row);
  track({ type: 'palette', action: 'run', kind: row.kind });
  return { kind: 'closed' };
}
