// The top bar's menus, built from the UI kit (design 2.7, 8.4): View (a small panel of layers, mesh and art
// style: a form, so a Popover with switches and segmented controls that stay open while you set them), Go (the
// launchers and places to fly to) and Window (the open windows and the arrange actions), both Menus with
// their keys. This module is its own chunk: the three triggers in the bar (topmenus.tsx) load it on first use.

import { MapPin } from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import { useRuntime } from '../../app/context';
import {
  type LayerKey,
  layerOn,
  layersWithMesh,
  type MeshMode,
  meshModeOf,
  useLayerParam,
  withLayer,
} from '../../features/chrome/layers';
import { computePlaces } from '../../features/chrome/placelabels';
import { useGlobeEngine } from '../../globe';
import { GLOBE_ARTS, type GlobeArtPref, useUi } from '../../store/ui';
import { Menu, type MenuItem, Popover, SegmentedControl, Switch } from '../../ui';
import { snapWindow } from '../wm/arrange';
import { WINDOW_ICON } from '../wm/glyphs';
import { visibleWindows } from '../wm/machine';
import { listEqual, useWindowManager, useWm } from '../wm/react';
import { WINDOW_SPECS } from '../wm/specs';
import type { WindowState } from '../wm/types';
import { useShellActions } from './actions';
import { keyCaps, LAUNCHERS, type LauncherId } from './launchers';
import { useShellNav } from './nav';
import './menus.css';

export type MenuKind = 'view' | 'go' | 'window' | 'layers';

export interface MenuImplProps {
  which: MenuKind;
  /** The trigger's text, or its accessible name when it has an icon child. */
  label: string;
  className: string;
  title?: string;
  /** An icon in place of the text label. */
  children?: ReactNode;
}

/** The trigger every menu shares: the bar's own text (or icon) button. */
function trigger({ label, className, title, children }: MenuImplProps) {
  return (
    <button type="button" className={className} aria-label={children ? label : undefined} title={title}>
      {children ?? label}
    </button>
  );
}

/** The menu a trigger asks for: it opens as it mounts, because the click that loaded this chunk was its click. */
export function MenuImpl(props: MenuImplProps) {
  switch (props.which) {
    case 'view':
    case 'layers':
      return <LayersPopover {...props} />;
    case 'go':
      return <GoMenu {...props} />;
    case 'window':
      return <WindowMenu {...props} />;
  }
}

// ---- layers --------------------------------------------------------------------------------------

const LAYERS: readonly { key: LayerKey; label: string }[] = [
  { key: 'terminator', label: 'Day and night' },
  { key: 'lights', label: 'Night lights' },
  { key: 'clouds', label: 'Clouds' },
  { key: 'towers', label: 'Stack towers' },
  { key: 'labels', label: 'Place labels' },
];

const MESH: readonly { value: MeshMode; label: string }[] = [
  { value: 'selection', label: 'Selection' },
  { value: 'flow', label: 'Flow' },
  { value: 'off', label: 'Off' },
];

const ART_LABEL: Record<GlobeArtPref, string> = { marble: 'Marble', holo: 'Holo', neon: 'Neon' };

function LayersPopover(props: MenuImplProps) {
  return (
    <Popover
      aria-label="Layers"
      placement={props.which === 'layers' ? 'bottom-end' : 'bottom-start'}
      width={288}
      defaultOpen
      trigger={trigger(props)}
      content={<LayersPanel />}
    />
  );
}

/** Layers, mesh and art style: each change applies at once and the panel stays open for the next. */
function LayersPanel() {
  const nav = useShellNav();
  const art = useUi((s) => s.globeArt);
  const setArt = useUi((s) => s.setGlobeArt);
  const l = useLayerParam();
  const mesh = meshModeOf(l);
  return (
    <div className="layers-panel">
      <section className="lp-group" aria-labelledby="lp-layers">
        <h3 className="lp-head" id="lp-layers">
          Layers
        </h3>
        {LAYERS.map(({ key, label }) => (
          <Switch
            key={key}
            layout="row"
            label={label}
            checked={layerOn(l, key)}
            onChange={(on) => nav.patchSearch({ l: withLayer(l, key, on) })}
          />
        ))}
      </section>
      <section className="lp-group" aria-labelledby="lp-mesh">
        <h3 className="lp-head" id="lp-mesh">
          Peer links
        </h3>
        <SegmentedControl
          aria-labelledby="lp-mesh"
          size="sm"
          fullWidth
          options={MESH}
          value={mesh}
          onChange={(m) => nav.patchSearch({ l: layersWithMesh(l, m) })}
        />
      </section>
      <section className="lp-group" aria-labelledby="lp-art">
        <h3 className="lp-head" id="lp-art">
          Art style
        </h3>
        <SegmentedControl
          aria-labelledby="lp-art"
          size="sm"
          fullWidth
          options={GLOBE_ARTS.map((a) => ({ value: a, label: ART_LABEL[a] }))}
          value={art}
          onChange={setArt}
        />
      </section>
    </div>
  );
}

// ---- Go ------------------------------------------------------------------------------------------

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

function GoMenu(props: MenuImplProps) {
  const { launch } = useShellActions();
  const engine = useGlobeEngine();
  const { store } = useRuntime();
  const items = useMemo((): MenuItem[] => {
    // City labels when the data has them, otherwise the biggest countries.
    const all = store.loaded ? computePlaces(store) : { cities: [], countries: [] };
    const places = (all.cities.length > 0 ? all.cities : all.countries).slice(0, 8);
    return [
      { type: 'label', label: 'Views' },
      ...GO_ORDER.map(
        (id): MenuItem => ({
          id,
          label: LAUNCHERS[id].label,
          icon: LAUNCHERS[id].icon ?? undefined,
          shortcut: keyCaps(LAUNCHERS[id]),
          onSelect: () => launch(id),
        }),
      ),
      ...(places.length
        ? ([
            { type: 'separator' },
            { type: 'label', label: 'Places' },
            ...places.map(
              (p): MenuItem => ({
                id: p.id,
                label: p.text,
                icon: MapPin,
                disabled: !engine,
                onSelect: () => {
                  void engine?.flyTo(p.lat, p.lon, 0.7);
                },
              }),
            ),
          ] as MenuItem[])
        : []),
    ];
  }, [store, engine, launch]);
  return <Menu aria-label="Go" defaultOpen trigger={trigger(props)} items={items} />;
}

// ---- Window --------------------------------------------------------------------------------------

const same = (a: readonly WindowState[], b: readonly WindowState[]) => listEqual(a, b);

function WindowMenu(props: MenuImplProps) {
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
    extra: Partial<Extract<MenuItem, { onSelect: () => void }>> = {},
  ): MenuItem => ({
    id,
    label,
    disabled: !focused,
    onSelect: run,
    ...extra,
  });

  const items: MenuItem[] = [
    { type: 'label', label: 'Open windows' },
    ...(wins.length
      ? wins.map(
          (w): MenuItem => ({
            id: `w-${w.id}`,
            label: w.mode === 'minimized' ? `${w.title} (minimized)` : w.title,
            icon: WINDOW_ICON[w.type] ?? undefined,
            checked: w.id === focusedId,
            onSelect: () => {
              if (w.binding === 'extra') focusWindow(w);
              else wm.dispatch({ t: 'focus', id: w.id });
            },
          }),
        )
      : [{ id: 'none', label: 'No windows open', disabled: true, onSelect: () => {} } as MenuItem]),
    { type: 'separator' },
    { type: 'label', label: 'Arrange' },
    act('Snap left', 'snap-left', () => focused && snapWindow(wm, focused.id, 'left'), {
      disabled: !focused || focused.placement === 'docked',
    }),
    act('Snap right', 'snap-right', () => focused && snapWindow(wm, focused.id, 'right')),
    act(
      focused?.placement === 'docked' ? 'Float' : 'Dock right',
      'dock',
      () => focused && wm.dispatch({ t: 'toggleDock', id: focused.id }),
      { shortcut: ['alt', 'D'], disabled: !focused || !WINDOW_SPECS[focused.type].dockable },
    ),
    act(
      focused?.mode === 'maximized' ? 'Restore' : 'Maximize',
      'max',
      () =>
        focused &&
        wm.dispatch(
          focused.mode === 'maximized' ? { t: 'restore', id: focused.id } : { t: 'maximize', id: focused.id },
        ),
      { shortcut: ['alt', 'enter'] },
    ),
    act('Minimize', 'min', () => focused && wm.dispatch({ t: 'minimize', id: focused.id }), {
      shortcut: ['alt', 'M'],
    }),
    act('Tile side by side', 'tile', () => tileFloating(wm, floating), { disabled: floating.length < 2 }),
    { type: 'separator' },
    act('Close window', 'close', () => focused && requestClose(focused), { shortcut: ['esc'] }),
    {
      id: 'close-all',
      label: 'Close all windows',
      disabled: visibleCount === 0 && wins.length === 0,
      onSelect: () => {
        for (const w of wins) if (w.binding === 'free') wm.dispatch({ t: 'close', id: w.id });
        launch('globe');
      },
    },
  ];
  return <Menu aria-label="Window" defaultOpen trigger={trigger(props)} items={items} />;
}

function tileFloating(wm: ReturnType<typeof useWindowManager>, list: readonly WindowState[]): void {
  const two = list.slice(-2);
  const [a, b] = two;
  if (!a || !b) return;
  snapWindow(wm, a.id, 'left');
  snapWindow(wm, b.id, 'right');
}
