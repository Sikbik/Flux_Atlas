import { Cloud, Copy, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNetworkProviders, useNodes } from '../../../api/queries';
import { formatBytes, formatInt } from '../../../lib/format';
import { IconButton } from '../../controls';
import { SearchField, Select, type SelectOption, Slider, Switch, TextField } from '../../forms';
import { SegmentedControl } from '../../nav';
import { GallerySection, SpecGrid, Specimen } from '../primitives';
import './controls.css';
import { Pinned } from './Pinned';

const SIZE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'cumulus', label: 'Cumulus' },
  { value: 'nimbus', label: 'Nimbus' },
  { value: 'stratus', label: 'Stratus' },
] as const;

const SYNTHETIC_PROVIDERS: SelectOption[] = [
  { value: 'ovh', label: 'OVH SAS', description: 'Synthetic: 1,240 nodes, 14 countries', icon: Cloud },
  {
    value: 'hetzner',
    label: 'Hetzner Online GmbH',
    description: 'Synthetic: 910 nodes, 3 countries',
    icon: Cloud,
  },
  { value: 'contabo', label: 'Contabo GmbH', description: 'Synthetic: 402 nodes, 4 countries', icon: Cloud },
  {
    value: 'home',
    label: 'Residential ISPs',
    description: 'Synthetic: 118 nodes, 22 countries',
    icon: Cloud,
  },
];

const TIER_OPTIONS: SelectOption[] = [
  { value: 'cumulus', label: 'Cumulus' },
  { value: 'nimbus', label: 'Nimbus' },
  { value: 'stratus', label: 'Stratus', disabled: true },
];

/** Gallery section: TextField, SearchField, Select, Switch, Slider. */
export function FormsSection() {
  const nodes = useNodes({ limit: 16 });
  const providers = useNetworkProviders();
  const node = nodes.data?.items[0];
  const endpoint = node?.endpoint ?? undefined;
  const address = node?.payment_address ?? undefined;

  const providerOptions = useMemo<SelectOption[]>(() => {
    const live = (providers.data?.providers ?? []).slice(0, 14).map<SelectOption>((p) => ({
      value: String(p.asn ?? p.org),
      label: p.org,
      description: `${formatInt(p.nodes)} nodes, ${formatInt(p.countries)} ${p.countries === 1 ? 'country' : 'countries'}`,
      icon: Cloud,
    }));
    return live.length > 0 ? live : SYNTHETIC_PROVIDERS;
  }, [providers.data]);
  const providersLive = (providers.data?.providers.length ?? 0) > 0;

  const endpointOptions = useMemo<SelectOption[]>(
    () =>
      (nodes.data?.items ?? [])
        .filter((n) => n.endpoint)
        .map((n) => ({ value: n.endpoint ?? '', label: n.endpoint ?? '', description: n.tier })),
    [nodes.data],
  );

  const [provider, setProvider] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [tier, setTier] = useState<string>('all');
  const [uptime, setUptime] = useState(97.5);
  const [storage, setStorage] = useState(400);
  const [peers, setPeers] = useState(true);

  return (
    <GallerySection
      id="forms"
      title="Form controls"
      lead="A visible label, a control, and one message line that is always there once a hint or an error is in play, so nothing moves when an error appears. Data goes in Plex Mono; focus is the Flux-blue border with a soft halo; every control has hover and keyboard focus states."
    >
      <SpecGrid min={440}>
        <Specimen
          title="Text field: rest and filled, 420 px."
          caption="Label above, hint below. The filled field shows a live node endpoint in Plex Mono."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <TextField
              label="Node"
              placeholder="IP and port, or collateral outpoint"
              hint="Atlas resolves IPs, ports and collateral outpoints."
            />
            <TextField
              label="Endpoint"
              mono
              defaultValue={endpoint ?? '65.109.26.93:16147'}
              hint={endpoint ? 'A live node from the network.' : 'Synthetic example while the server loads.'}
            />
          </div>
        </Specimen>

        <Specimen
          title="Error, disabled and read-only."
          caption="Error: critical border, a 3 px halo at 14%, icon and words in the message line, which takes the hint's place without moving anything."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <TextField
              label="Payment address"
              mono
              defaultValue="t1nonsense"
              error="Not a Flux address. Addresses start with t1."
            />
            <TextField label="Operator" defaultValue="Read only while offline" disabled reserveMessage />
            <TextField
              label="Payment address"
              mono
              readOnly
              defaultValue={address ?? 't1cz5PxM3Zk9Y6ftqUtAqD5Cj4JXWEWDg9'}
              hint="Select to copy. Nothing leaves this browser."
              trailing={<IconButton icon={Copy} label="Copy address" size="sm" />}
            />
          </div>
        </Specimen>

        <Specimen
          title="Icon, prefix, suffix and key caps."
          caption="The leading icon turns Flux blue while focused; key caps are one cap per key and hide on touch."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <TextField
              icon={Search}
              aria-label="Search"
              placeholder="Search nodes, apps, blocks"
              kbd={['ctrl', 'K']}
            />
            <TextField label="API host" prefix="https://" suffix=".runonflux.io" mono placeholder="api" />
            <TextField label="Timeout" suffix="ms" mono defaultValue="5000" />
          </div>
        </Specimen>

        <Specimen
          title="Search field."
          caption="Role search. Escape clears while there is text, and only then; Enter submits; typing is debounced 300 ms. Try it."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <SearchField
              placeholder="Search nodes, apps, blocks"
              kbd={['ctrl', 'K']}
              value={query}
              onValueChange={setQuery}
              onDebouncedChange={setDebounced}
              onSubmit={setSubmitted}
              delayMs={300}
            />
            <p className="kgc-note">
              Typed: <code>{query || 'nothing yet'}</code>. Debounced:{' '}
              <code>{debounced || 'nothing yet'}</code>. Submitted: <code>{submitted ?? 'nothing yet'}</code>.
            </p>
            <SearchField defaultValue="Helsinki" loading aria-label="Search, loading" />
            <SearchField aria-label="Search, disabled" disabled placeholder="Search is offline" />
          </div>
        </Specimen>

        <Specimen
          title="Small fields in a toolbar, 30 px."
          caption="size sm lines up with a small segmented control, a small select and small buttons: one height ladder, 30 px and 36 px, 44 px on touch."
          layout="stack"
          width={420}
        >
          <div className="kgc-toolbar">
            <SearchField size="sm" aria-label="Filter nodes" placeholder="Filter" />
            <SegmentedControl
              aria-label="Tier"
              size="sm"
              options={SIZE_OPTIONS}
              value={tier}
              onChange={setTier}
            />
          </div>
        </Specimen>

        <Specimen
          title="Narrow and long content, 240 px."
          caption="Long values truncate with an ellipsis inside the field; the label and message wrap."
          layout="stack"
          width={240}
        >
          <div className="kgc-stack kgc-stack--wide">
            <TextField
              label="Collateral outpoint"
              mono
              defaultValue="2c9937a64f7a0e6e0f8a7d4f1c3b5a9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a:0"
              hint="The transaction id and output index."
            />
          </div>
        </Specimen>

        <Specimen
          title="Select: rest, chosen, error and disabled."
          caption={
            providersLive
              ? 'Options are the live hosting providers from the network, with their node counts as descriptions. The trigger is a combobox; focus stays on it while the list is open.'
              : 'Options are synthetic while the server loads. The trigger is a combobox; focus stays on it while the list is open.'
          }
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <Select
              label="Provider"
              options={providerOptions}
              value={provider}
              onChange={setProvider}
              placeholder="Choose a provider"
              hint="Grouped by network (ASN)."
            />
            <Select
              key={providersLive ? 'live' : 'synthetic'}
              label="Provider"
              options={providerOptions}
              defaultValue={providerOptions[0]?.value}
            />
            <Select label="Tier" options={TIER_OPTIONS} error="Choose a tier to continue." />
            <Select label="Tier" options={TIER_OPTIONS} defaultValue="nimbus" disabled reserveMessage />
          </div>
        </Specimen>

        <Specimen
          title="Select, open: icons, descriptions, a check and a highlighted row."
          caption="Pinned open while this specimen is on screen. Arrow keys, Home, End and PageUp and PageDown move the highlight; typing jumps; Enter or Space chooses; Escape closes. The list is at least as wide as the trigger and scrolls when long."
          layout="stack"
          width={420}
        >
          <Pinned height={430}>
            {(open) => (
              <Select
                key={providersLive ? 'live' : 'synthetic'}
                label="Provider"
                options={providerOptions}
                defaultValue={providerOptions[1]?.value}
                open={open}
                onOpenChange={() => {}}
              />
            )}
          </Pinned>
        </Specimen>

        <Specimen
          title="Select: small, mono, native and loading."
          caption="size sm is 30 px for toolbars. mono sets data options (live endpoints) in Plex Mono. native renders a styled native select, for the OS picker on phones; icons and descriptions are not shown there."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <div className="kgc-toolbar">
              <SearchField size="sm" aria-label="Filter providers" placeholder="Filter" />
              <Select
                size="sm"
                aria-label="Provider"
                options={providerOptions}
                placeholder="Any provider"
                style={{ width: 170 }}
              />
            </div>
            <Select
              key={endpointOptions.length > 0 ? 'live' : 'empty'}
              label="Endpoint"
              mono
              options={endpointOptions}
              defaultValue={endpointOptions[0]?.value}
              placeholder="Choose an endpoint"
              loading={nodes.isPending}
              emptyText="No live endpoints"
            />
            <Select
              native
              label="Provider (native)"
              options={providerOptions}
              placeholder="Choose a provider"
            />
            <Select label="Provider" options={[]} loading placeholder="Loading providers" />
          </div>
        </Specimen>

        <Specimen
          title="Switch."
          caption="Off, on, disabled, with a description, and as a full-width settings row. The label is always clickable; the knob glides on a transform."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <Switch label="Reveal peers on the globe" checked={peers} onChange={setPeers} />
            <Switch label="Show the weather layer" />
            <Switch label="Weather layer" defaultChecked />
            <Switch label="Ambient mode" disabled />
            <Switch label="Ambient mode" disabled defaultChecked />
            <Switch
              layout="row"
              label="Reduce motion"
              description="Cross-fades only; the moon parks where it is."
              defaultChecked
            />
          </div>
        </Specimen>

        <Specimen
          title="Slider."
          caption="A filled Flux-blue track, a 16 px thumb and a tabular mono readout. Marks are optional; valueText formats the readout and what a screen reader hears."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <Slider
              label="Minimum uptime"
              min={90}
              max={100}
              step={0.5}
              value={uptime}
              onChange={setUptime}
              valueText={(v) => `${v.toFixed(1)}%`}
              marks={[
                { value: 90, label: '90' },
                { value: 95, label: '95' },
                { value: 99, label: '99' },
                { value: 100, label: '100' },
              ]}
            />
            <Slider
              label="Minimum storage"
              min={0}
              max={2000}
              step={50}
              value={storage}
              onChange={setStorage}
              valueText={(v) => formatBytes(v * 1_000_000_000)}
            />
            <Slider label="Block history" min={0} max={2996914} defaultValue={1450000} />
            <Slider label="Disabled" defaultValue={30} disabled />
          </div>
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
