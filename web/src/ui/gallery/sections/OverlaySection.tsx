import {
  Cloud,
  Copy,
  EllipsisVertical,
  ExternalLink,
  Globe,
  Layers,
  ListFilter,
  Server,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNetworkProviders, useNodes } from '../../../api/queries';
import { formatInt } from '../../../lib/format';
import { Button, IconButton } from '../../controls';
import { Select, type SelectOption, Slider, Switch } from '../../forms';
import { SegmentedControl } from '../../nav';
import { Menu, type MenuItem, Popover } from '../../popover';
import { GallerySection, SpecGrid, Specimen } from '../primitives';
import './controls.css';
import { Pinned } from './Pinned';

const TIERS = [
  { value: 'all', label: 'All' },
  { value: 'cumulus', label: 'Cumulus' },
  { value: 'nimbus', label: 'Nimbus' },
  { value: 'stratus', label: 'Stratus' },
] as const;

const SYNTHETIC_PROVIDERS: SelectOption[] = [
  { value: 'ovh', label: 'OVH SAS', description: 'Synthetic: 1,240 nodes', icon: Cloud },
  { value: 'hetzner', label: 'Hetzner Online GmbH', description: 'Synthetic: 910 nodes', icon: Cloud },
  { value: 'contabo', label: 'Contabo GmbH', description: 'Synthetic: 402 nodes', icon: Cloud },
];

const noop = () => {};

/** A small filter form: the content of the filter popover, with a Select that opens a nested list. */
function FilterPanel({ providers, onApply }: { providers: SelectOption[]; onApply: () => void }) {
  const [tier, setTier] = useState<string>('all');
  const [online, setOnline] = useState(true);
  const [uptime, setUptime] = useState(95);
  return (
    <div className="kgc-filter">
      <SegmentedControl
        aria-label="Tier"
        size="sm"
        fullWidth
        options={TIERS}
        value={tier}
        onChange={setTier}
      />
      <Select size="sm" aria-label="Provider" options={providers} placeholder="Any provider" />
      <Switch label="Only nodes that are online" checked={online} onChange={setOnline} />
      <Slider
        label="Minimum uptime"
        min={80}
        max={100}
        value={uptime}
        onChange={setUptime}
        valueText={(v) => `${v}%`}
      />
      <div className="kgc-filter__foot">
        <Button variant="ghost" size="sm" onClick={onApply}>
          Reset
        </Button>
        <Button variant="primary" size="sm" onClick={onApply}>
          Apply
        </Button>
      </div>
    </div>
  );
}

/** Gallery section: Popover and Menu. */
export function OverlaySection() {
  const nodes = useNodes({ limit: 4 });
  const providers = useNetworkProviders();
  const node = nodes.data?.items[0];
  const endpoint = node?.endpoint ?? '65.109.26.93:16147';
  const tier = node?.tier ?? 'nimbus';
  const live = Boolean(node);

  const providerOptions = useMemo<SelectOption[]>(() => {
    const rows = (providers.data?.providers ?? []).slice(0, 10).map<SelectOption>((p) => ({
      value: String(p.asn ?? p.org),
      label: p.org,
      description: `${formatInt(p.nodes)} nodes`,
      icon: Cloud,
    }));
    return rows.length > 0 ? rows : SYNTHETIC_PROVIDERS;
  }, [providers.data]);

  const [last, setLast] = useState<string | null>(null);
  const [weather, setWeather] = useState(true);
  const [peers, setPeers] = useState(false);

  const viewItems: MenuItem[] = [
    { type: 'label', label: 'Window' },
    { id: 'globe', label: 'Globe', icon: Globe, shortcut: ['G'], onSelect: () => setLast('Globe') },
    { id: 'nodes', label: 'Nodes', icon: Server, shortcut: ['N'], onSelect: () => setLast('Nodes') },
    { id: 'explorer', label: 'Explorer', icon: Layers, shortcut: ['E'], onSelect: () => setLast('Explorer') },
    { type: 'separator' },
    { type: 'label', label: 'Layers' },
    { id: 'weather', label: 'Weather', checked: weather, onSelect: () => setWeather((v) => !v) },
    { id: 'peers', label: 'Peers', checked: peers, onSelect: () => setPeers((v) => !v) },
    { type: 'separator' },
    { id: 'reset', label: 'Reset view', shortcut: ['shift', 'R'], disabled: true, onSelect: noop },
  ];

  const rowItems: MenuItem[] = [
    { id: 'open', label: 'Open node', icon: ExternalLink, onSelect: () => setLast('Open node') },
    { id: 'copy-endpoint', label: 'Copy endpoint', icon: Copy, onSelect: () => setLast('Copy endpoint') },
    {
      id: 'copy-address',
      label: 'Copy payment address',
      icon: Copy,
      onSelect: () => setLast('Copy payment address'),
    },
    { type: 'separator' },
    {
      id: 'unwatch',
      label: 'Remove from watchlist',
      icon: Trash2,
      danger: true,
      onSelect: () => setLast('Remove'),
    },
  ];

  return (
    <GallerySection
      id="overlays"
      title="Popovers and menus"
      lead="One glass surface behind both: measured before it is shown, so it never flashes in the corner, then a 4 px drift and a fade. Escape closes the top-most layer and returns focus to the trigger; a press outside closes without taking focus; a Select inside a popover opens its own layer without closing the popover."
    >
      <SpecGrid min={440}>
        <Specimen
          title="Popover: a filter set, open."
          caption="Pinned open while this specimen is on screen. Glass-strong, non-modal, a dialog with a required name. The provider select opens a nested list."
          layout="stack"
          width={420}
        >
          <Pinned height={440}>
            {(open) => (
              <Popover
                open={open}
                onOpenChange={noop}
                autoFocus={false}
                aria-label="Filter nodes"
                width={340}
                trigger={<Button icon={ListFilter}>Filters</Button>}
                content={<FilterPanel providers={providerOptions} onApply={noop} />}
              />
            )}
          </Pinned>
        </Specimen>

        <Specimen
          title="Menu: the top bar's View menu, open."
          caption="Group labels, a separator, icons, key caps pinned right, checkable layers and a disabled row. The highlighted row is a quiet accent wash with a 3 px bar; the pointer and the arrow keys move it."
          layout="stack"
          width={420}
        >
          <Pinned height={400}>
            {(open) => (
              <Menu
                open={open}
                onOpenChange={noop}
                autoFocus={false}
                aria-label="View"
                trigger={<Button>View</Button>}
                items={viewItems}
              />
            )}
          </Pinned>
        </Specimen>

        <Specimen
          title="Menu: row actions behind a kebab, open."
          caption={
            live
              ? 'A live node row. The menu is anchored to the kebab and flips or clamps to stay on screen. The danger row is last, after a separator (synthetic action).'
              : 'A synthetic node row while the server loads. The danger row is last, after a separator.'
          }
          layout="stack"
          width={420}
        >
          <Pinned height={300}>
            {(open) => (
              <>
                <div className="kgc-row">
                  <span className="kgc-row__main">{endpoint}</span>
                  <span className="kgc-row__meta">{tier}</span>
                  <Menu
                    open={open}
                    onOpenChange={noop}
                    autoFocus={false}
                    aria-label="Node actions"
                    placement="bottom-end"
                    trigger={<IconButton icon={EllipsisVertical} label="Node actions" />}
                    items={rowItems}
                  />
                </div>
              </>
            )}
          </Pinned>
        </Specimen>

        <Specimen
          title="Live: try them."
          caption="Click, or Tab to a trigger and press Enter, Space or an arrow key. Arrow keys, Home, End and typing move through the menu; Enter chooses; Escape closes and returns focus."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <div className="kgc-toolbar">
              <Menu trigger={<Button>View</Button>} items={viewItems} aria-label="View" />
              <Popover
                aria-label="Filter nodes"
                width={340}
                trigger={<Button icon={ListFilter}>Filters</Button>}
                content={({ close }) => <FilterPanel providers={providerOptions} onApply={close} />}
              />
              <Menu
                placement="bottom-end"
                aria-label="Node actions"
                trigger={<IconButton icon={EllipsisVertical} label="Node actions" />}
                items={rowItems}
              />
            </div>
            <p className="kgc-note">
              Last action: <code>{last ?? 'nothing yet'}</code>. Weather layer{' '}
              <code>{weather ? 'on' : 'off'}</code>, peers <code>{peers ? 'on' : 'off'}</code>.
            </p>
          </div>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
