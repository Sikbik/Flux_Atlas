import {
  Activity,
  Blocks,
  Boxes,
  Globe,
  Layers,
  LayoutGrid,
  List,
  Server,
  Table2,
  UserRoundCheck,
  Wallet,
} from 'lucide-react';
import { useState } from 'react';
import { useSummary } from '../../../app/context';
import { SegmentedControl, type SegmentedOption, type TabItem, TabPanel, Tabs } from '../../nav';
import { GallerySection, SpecGrid, Specimen } from '../primitives';
import './controls.css';

const FILTER: readonly SegmentedOption[] = [
  { value: 'all', label: 'All' },
  { value: 'blocks', label: 'Blocks' },
  { value: 'nodes', label: 'Nodes' },
  { value: 'apps', label: 'Apps' },
  { value: 'mine', label: 'Mine' },
];

const FILTER_ICONS: readonly SegmentedOption[] = [
  { value: 'all', label: 'All', icon: Globe },
  { value: 'blocks', label: 'Blocks', icon: Blocks },
  { value: 'nodes', label: 'Nodes', icon: Server },
  { value: 'apps', label: 'Apps', icon: Boxes },
  { value: 'mine', label: 'Mine', icon: UserRoundCheck },
];

const VIEW_MODE: readonly SegmentedOption[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'grid', label: 'Grid', icon: LayoutGrid },
];

const PERIOD: readonly SegmentedOption[] = [
  { value: '1h', label: '1h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
];

const TX_TABS: readonly TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'io', label: 'Inputs and outputs' },
  { id: 'raw', label: 'Raw' },
  { id: 'script', label: 'Script', disabled: true },
];

const OVERFLOW_TABS: readonly TabItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'payments', label: 'Payments', badge: 1204 },
  { id: 'peers', label: 'Peers', badge: 24 },
  { id: 'apps', label: 'Apps', badge: 6 },
  { id: 'uptime', label: 'Uptime' },
  { id: 'benchmarks', label: 'Benchmarks' },
  { id: 'history', label: 'History' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'raw', label: 'Raw' },
];

const INSPECTOR_TABS: readonly TabItem[] = [
  { id: 'overview', label: 'Overview', icon: Layers },
  { id: 'payments', label: 'Payments', icon: Wallet, badge: 18 },
  { id: 'peers', label: 'Peers', icon: Activity, badge: 24 },
  { id: 'apps', label: 'Apps', icon: Boxes },
];

/** Gallery section: Tabs and SegmentedControl. */
export function NavSection() {
  const summary = useSummary();
  const tiers = summary?.tiers;
  const tierTabs: readonly TabItem[] = [
    { id: 'cumulus', label: 'Cumulus', badge: tiers?.cumulus },
    { id: 'nimbus', label: 'Nimbus', badge: tiers?.nimbus },
    { id: 'stratus', label: 'Stratus', badge: tiers?.stratus },
  ];

  const [tierTab, setTierTab] = useState('cumulus');
  const [txTab, setTxTab] = useState('overview');
  const [inspector, setInspector] = useState('overview');
  const [overflow, setOverflow] = useState('overview');
  const [manual, setManual] = useState('overview');
  const [appAccent, setAppAccent] = useState('overview');
  const [tierAccent, setTierAccent] = useState('overview');

  const [filter, setFilter] = useState('all');
  const [filterSm, setFilterSm] = useState('blocks');
  const [icons, setIcons] = useState('nodes');
  const [mode, setMode] = useState('table');
  const [period, setPeriod] = useState('24h');
  const [wide, setWide] = useState('apps');

  return (
    <GallerySection
      id="nav"
      title="Tabs and segmented controls"
      lead="Tabs switch between sections of one thing; a segmented control picks one of a few exclusive options for the current view. Both are controlled (value and onChange) with plain string ids, so they map straight onto route params. Arrow keys, Home and End work on both."
    >
      <SpecGrid min={440}>
        <Specimen
          title="Tabs on live counts, 420 px."
          caption="Badges are mono and tabular; the counts come from the live network summary."
          layout="stack"
          width={420}
        >
          <Tabs aria-label="Nodes by tier" items={tierTabs} value={tierTab} onChange={setTierTab} />
        </Specimen>

        <Specimen
          title="Inspector tabs with icons."
          caption="Selected tab: white label, accent icon, a 2 px line that glides on a transform and a faint band above it. Hover and keyboard focus are drawn too."
          layout="stack"
          width={420}
        >
          <Tabs aria-label="Node sections" items={INSPECTOR_TABS} value={inspector} onChange={setInspector} />
        </Specimen>

        <Specimen
          title="Overflow, 420 px."
          caption="Nine tabs in a narrow window scroll sideways under an edge fade. Arrow keys and Home or End keep the focused tab in view."
          layout="stack"
          width={420}
        >
          <Tabs
            aria-label="Node detail sections"
            items={OVERFLOW_TABS}
            value={overflow}
            onChange={setOverflow}
          />
        </Specimen>

        <Specimen
          title="Window tabs in an explorer window, 820 px."
          caption="size sm: 30 px, Montserrat 600 12.5 px. The underline takes the window accent (data-accent). The panels below are real TabPanels, wired with aria-controls."
          layout="stack"
          span={2}
          width={820}
        >
          <div data-accent="chain" className="kgc-window">
            <Tabs
              id="kit-tx-tabs"
              aria-label="Transaction sections"
              size="sm"
              items={TX_TABS}
              value={txTab}
              onChange={setTxTab}
            />
            <TabPanel id="overview" value={txTab} tabsId="kit-tx-tabs" className="kgc-panel">
              Overview: value moved, fee, size and confirmations.
            </TabPanel>
            <TabPanel id="io" value={txTab} tabsId="kit-tx-tabs" className="kgc-panel">
              Inputs and outputs: where the value went.
            </TabPanel>
            <TabPanel id="raw" value={txTab} tabsId="kit-tx-tabs" className="kgc-panel">
              Raw: the serialized transaction.
            </TabPanel>
          </div>
        </Specimen>

        <Specimen
          title="Accent follows the window."
          caption="The mark reads --accent: app windows are pale blue, node windows wear their tier colour."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack kgc-stack--wide">
            <div data-accent="app">
              <Tabs
                aria-label="App sections"
                size="sm"
                items={TX_TABS.slice(0, 3)}
                value={appAccent}
                onChange={setAppAccent}
              />
            </div>
            <div data-tier="cumulus">
              <Tabs
                aria-label="Cumulus node sections"
                size="sm"
                items={TX_TABS.slice(0, 3)}
                value={tierAccent}
                onChange={setTierAccent}
              />
            </div>
            <div data-tier="stratus">
              <Tabs
                aria-label="Stratus node sections"
                size="sm"
                items={TX_TABS.slice(0, 3)}
                value={tierAccent}
                onChange={setTierAccent}
              />
            </div>
          </div>
        </Specimen>

        <Specimen
          title="Manual activation and a disabled tab."
          caption="activation=manual: arrows only move focus; Enter or Space selects. The disabled tab is skipped."
          layout="stack"
          width={420}
        >
          <Tabs
            aria-label="Manual tabs"
            activation="manual"
            items={TX_TABS}
            value={manual}
            onChange={setManual}
          />
        </Specimen>

        <Specimen
          title="Segmented control, md and sm."
          caption="A 3 px padded capsule; segments share one width. The pill glides on a transform and is instant under reduced motion."
          layout="stack"
        >
          <SegmentedControl aria-label="Filter" options={FILTER} value={filter} onChange={setFilter} />
          <SegmentedControl
            aria-label="Filter, small"
            size="sm"
            options={FILTER}
            value={filterSm}
            onChange={setFilterSm}
          />
        </Specimen>

        <Specimen
          title="With icons, and icons only."
          caption="Icon-only segments keep their labels as accessible names and tooltips."
          layout="stack"
        >
          <SegmentedControl aria-label="Kind" options={FILTER_ICONS} value={icons} onChange={setIcons} />
          <SegmentedControl
            aria-label="View mode"
            iconOnly
            options={VIEW_MODE}
            value={mode}
            onChange={setMode}
          />
        </Specimen>

        <Specimen
          title="Period picker, full width in a 420 px inspector."
          caption="fullWidth stretches the capsule; the segments stay equal."
          layout="stack"
          width={420}
        >
          <div className="kgc-stack">
            <SegmentedControl
              aria-label="Period"
              fullWidth
              options={PERIOD}
              value={period}
              onChange={setPeriod}
            />
            <SegmentedControl
              aria-label="Filter, full width"
              fullWidth
              size="sm"
              options={FILTER}
              value={wide}
              onChange={setWide}
            />
          </div>
        </Specimen>

        <Specimen
          title="Disabled option, disabled control, no selection."
          caption="Arrow keys skip a disabled option. With no matching value the pill hides and the first enabled option takes the tab stop."
          layout="stack"
        >
          <SegmentedControl
            aria-label="With a disabled option"
            options={[
              { value: 'all', label: 'All' },
              { value: 'mine', label: 'Mine', disabled: true },
              { value: 'apps', label: 'Apps' },
            ]}
            value="all"
            onChange={() => {}}
          />
          <SegmentedControl
            aria-label="Disabled"
            disabled
            options={FILTER}
            value="blocks"
            onChange={() => {}}
          />
          <SegmentedControl
            aria-label="No selection"
            options={FILTER.slice(0, 3)}
            value="none"
            onChange={() => {}}
          />
        </Specimen>
      </SpecGrid>
    </GallerySection>
  );
}
