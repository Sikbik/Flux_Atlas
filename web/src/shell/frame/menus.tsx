// The top bar's three menus (design 2.7, 8.4): View (layers and art style), Go (the launchers and
// places to fly to) and Window (the open windows and the arrange actions). Every item that has a key
// shows it.

import { Layers2, MapPin } from 'lucide-react';
import { useMemo } from 'react';
import { useRuntime } from '../../app/context';
import { FluxMarkWhite } from '../../features/chrome/brand';
import {
  type LayerKey,
  layerOn,
  layersWithMesh,
  type MeshMode,
  meshModeOf,
  useLayerParam,
  withLayer,
} from '../../features/chrome/layers';
import { useGlobeEngine } from '../../globe';
import { computePlaces } from '../../globe/overlays';
import { formatInt } from '../../lib/format';
import { GLOBE_ARTS, type GlobeArtPref, useUi } from '../../store/ui';
import { snapWindow } from '../wm/arrange';
import { WINDOW_ICON, WindowGlyph } from '../wm/glyphs';
import { visibleWindows } from '../wm/machine';
import { listEqual, useWindowManager, useWm } from '../wm/react';
import { WINDOW_SPECS } from '../wm/specs';
import type { WindowState } from '../wm/types';
import { useShellActions } from './actions';
import { keyCaps, LAUNCHERS, type LauncherId } from './launchers';
import { MenuButton, type MenuItemDef } from './Menu';
import { useShellNav } from './nav';

const ART_LABEL: Record<GlobeArtPref, string> = { marble: 'Marble', holo: 'Holo', neon: 'Neon' };

const MESH: { mode: MeshMode; label: string }[] = [
  { mode: 'selection', label: 'Selection peers' },
  { mode: 'flow', label: 'Network flow' },
  { mode: 'off', label: 'Off' },
];

/** The layer, mesh and art items of the View menu (also the layers button in the top bar). */
function useViewItems(withLaunchers: boolean): MenuItemDef[] {
  const nav = useShellNav();
  const art = useUi((s) => s.globeArt);
  const setArt = useUi((s) => s.setGlobeArt);
  const l = useLayerParam();
  const mesh = meshModeOf(l);
  const { launch } = useShellActions();
  const toggle = (key: LayerKey, label: string): MenuItemDef => {
    const on = layerOn(l, key);
    return {
      kind: 'item',
      id: key,
      label,
      checked: on,
      keepOpen: true,
      onSelect: () => nav.patchSearch({ l: withLayer(l, key, !on) }),
    };
  };
  const items: MenuItemDef[] = [
    { kind: 'heading', id: 'h-layers', label: 'Layers' },
    toggle('terminator', 'Day and night'),
    toggle('lights', 'Night lights'),
    toggle('clouds', 'Clouds'),
    toggle('towers', 'Stack towers'),
    toggle('labels', 'Place labels'),
    { kind: 'separator', id: 's1' },
    { kind: 'heading', id: 'h-mesh', label: 'Mesh' },
    ...MESH.map(
      (m): MenuItemDef => ({
        kind: 'item',
        id: `mesh-${m.mode}`,
        label: m.label,
        checked: mesh === m.mode,
        radio: true,
        keepOpen: true,
        onSelect: () => nav.patchSearch({ l: layersWithMesh(l, m.mode) }),
      }),
    ),
    { kind: 'separator', id: 's2' },
    { kind: 'heading', id: 'h-art', label: 'Art style' },
    ...GLOBE_ARTS.map(
      (a): MenuItemDef => ({
        kind: 'item',
        id: `art-${a}`,
        label: ART_LABEL[a],
        checked: art === a,
        radio: true,
        keepOpen: true,
        onSelect: () => setArt(a),
      }),
    ),
  ];
  if (withLaunchers)
    items.push(
      { kind: 'separator', id: 's3' },
      {
        kind: 'item',
        id: 'ambient',
        label: LAUNCHERS.ambient.label,
        icon: <LaunchIcon id="ambient" />,
        keys: keyCaps(LAUNCHERS.ambient),
        onSelect: () => launch('ambient'),
      },
      {
        kind: 'item',
        id: 'settings',
        label: 'Settings',
        icon: <LaunchIcon id="settings" />,
        onSelect: () => launch('settings'),
      },
    );
  return items;
}

export function ViewMenu() {
  return <MenuButton label="View" items={useViewItems(true)} />;
}

/** The top bar's layers button: the same layer and art items without the launchers. */
export function LayersButton() {
  return (
    <MenuButton label="Layers" items={useViewItems(false)} align="end" className="iconbtn" title="Layers">
      <Layers2 size={19} strokeWidth={1.5} aria-hidden="true" />
    </MenuButton>
  );
}

function LaunchIcon({ id }: { id: LauncherId }) {
  const l = LAUNCHERS[id];
  if (!l.icon) return <FluxMarkWhite size={14} />;
  const Icon = l.icon;
  return <Icon size={16} strokeWidth={1.5} aria-hidden="true" />;
}

const GO_ORDER: LauncherId[] = [
  'globe',
  'nodes',
  'apps',
  'explorer',
  'queue',
  'analytics',
  'time',
  'operator',
  'terminal',
  'weather',
  'about',
];

export function GoMenu() {
  const { launch } = useShellActions();
  const engine = useGlobeEngine();
  const { store } = useRuntime();
  const items = (): MenuItemDef[] => {
    // City labels when the data has them, otherwise the biggest countries.
    const all = store.loaded ? computePlaces(store) : { cities: [], countries: [] };
    const places = (all.cities.length > 0 ? all.cities : all.countries).slice(0, 8);
    return [
      { kind: 'heading', id: 'h-views', label: 'Views' },
      ...GO_ORDER.map(
        (id): MenuItemDef => ({
          kind: 'item',
          id,
          label: LAUNCHERS[id].label,
          icon: <LaunchIcon id={id} />,
          keys: keyCaps(LAUNCHERS[id]),
          onSelect: () => launch(id),
        }),
      ),
      ...(places.length
        ? ([
            { kind: 'separator', id: 's1' },
            { kind: 'heading', id: 'h-places', label: 'Places' },
            ...places.map(
              (p): MenuItemDef => ({
                kind: 'item',
                id: p.id,
                label: p.text,
                hint: `${formatInt(p.count)} nodes`,
                icon: <MapPin size={16} strokeWidth={1.5} aria-hidden="true" />,
                disabled: !engine,
                onSelect: () => {
                  void engine?.flyTo(p.lat, p.lon, 0.7);
                },
              }),
            ),
          ] as MenuItemDef[])
        : []),
    ];
  };
  return <MenuButton label="Go" items={items} />;
}

const same = (a: readonly WindowState[], b: readonly WindowState[]) => listEqual(a, b);

export function WindowMenu() {
  const wm = useWindowManager();
  const { requestClose, focusWindow, launch } = useShellActions();
  const wins = useWm(
    (s) =>
      s.order
        .map((id) => s.windows[id])
        .filter((w): w is WindowState => !!w && WINDOW_SPECS[w.type].chrome === 'window'),
    same,
  );
  const focusedId = useWm((s) => s.focused);
  const focused = wins.find((w) => w.id === focusedId) ?? null;
  const visibleCount = useWm((s) => visibleWindows(s).length);
  const floating = useMemo(
    () => wins.filter((w) => w.placement === 'floating' && w.mode !== 'minimized'),
    [wins],
  );

  const act = (
    label: string,
    id: string,
    run: () => void,
    extra: Partial<Extract<MenuItemDef, { kind: 'item' }>> = {},
  ): MenuItemDef => ({
    kind: 'item',
    id,
    label,
    disabled: !focused,
    onSelect: run,
    ...extra,
  });

  const items: MenuItemDef[] = [
    { kind: 'heading', id: 'h-open', label: 'Open windows' },
    ...(wins.length
      ? wins.map((w): MenuItemDef => {
          const Icon = WINDOW_ICON[w.type];
          return {
            kind: 'item',
            id: `w-${w.id}`,
            label: w.title,
            icon: Icon ? (
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <WindowGlyph type={w.type} size={14} />
            ),
            hint: w.mode === 'minimized' ? 'minimized' : w.id === focusedId ? 'focused' : undefined,
            onSelect: () => {
              if (w.binding === 'extra') focusWindow(w);
              else wm.dispatch({ t: 'focus', id: w.id });
            },
          };
        })
      : [
          {
            kind: 'item',
            id: 'none',
            label: 'No windows open',
            disabled: true,
            onSelect: () => {},
          } as MenuItemDef,
        ]),
    { kind: 'separator', id: 's1' },
    { kind: 'heading', id: 'h-arrange', label: 'Arrange' },
    act('Snap left', 'snap-left', () => focused && snapWindow(wm, focused.id, 'left'), {
      disabled: !focused || focused.placement === 'docked',
    }),
    act('Snap right', 'snap-right', () => focused && snapWindow(wm, focused.id, 'right')),
    act(
      focused?.placement === 'docked' ? 'Float' : 'Dock right',
      'dock',
      () => focused && wm.dispatch({ t: 'toggleDock', id: focused.id }),
      { keys: ['alt', 'D'], disabled: !focused || !WINDOW_SPECS[focused.type].dockable },
    ),
    act(
      focused?.mode === 'maximized' ? 'Restore' : 'Maximize',
      'max',
      () =>
        focused &&
        wm.dispatch(
          focused.mode === 'maximized' ? { t: 'restore', id: focused.id } : { t: 'maximize', id: focused.id },
        ),
      { keys: ['alt', 'enter'] },
    ),
    act('Minimize', 'min', () => focused && wm.dispatch({ t: 'minimize', id: focused.id }), {
      keys: ['alt', 'M'],
    }),
    act('Tile side by side', 'tile', () => tileFloating(wm, floating), { disabled: floating.length < 2 }),
    { kind: 'separator', id: 's2' },
    act('Close window', 'close', () => focused && requestClose(focused), { keys: ['esc'] }),
    {
      kind: 'item',
      id: 'close-all',
      label: 'Close all windows',
      disabled: visibleCount === 0 && wins.length === 0,
      onSelect: () => {
        for (const w of wins) if (w.binding === 'free') wm.dispatch({ t: 'close', id: w.id });
        launch('globe');
      },
    },
  ];
  return <MenuButton label="Window" items={items} />;
}

function tileFloating(wm: ReturnType<typeof useWindowManager>, list: readonly WindowState[]): void {
  const two = list.slice(-2);
  const [a, b] = two;
  if (!a || !b) return;
  snapWindow(wm, a.id, 'left');
  snapWindow(wm, b.id, 'right');
}
