// Placeholder views for every route in the design IA (section 2.2). Each shows real data from the
// API hooks or the live store so the whole pipeline is exercised; the designed windows replace them.

import {
  useAddress,
  useAddressNodes,
  useAppDetail,
  useAppHistory,
  useBlock,
  useMempool,
  useMetrics,
  useNetworkCapacity,
  useNetworkGeo,
  useNetworkProviders,
  useNetworkSummary,
  useNetworkVersions,
  useNodeDetail,
  useNodes,
  useOperator,
  useRichList,
  useSearch,
  useSupply,
  useTimeline,
  useTx,
} from '../../api/queries';
import { formatAgo, formatHeight, formatInt, formatUtcTime } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import { GLOBE_ARTS, type MotionPref, type PerfPref, useUi } from '../../store/ui';
import { useMempoolEntries, useNetwork, useNextPayees, useRuntime, useSummary, useTip } from '../context';
import type { AnalyticsTab, QueueTier } from '../search';
import { Panel, QueryState } from './Panel';

export function NodeView({ nodeKey }: { nodeKey: string }) {
  return (
    <Panel title={`Node ${nodeKey}`} kind="node">
      <QueryState q={useNodeDetail(nodeKey)} />
    </Panel>
  );
}

export function HostView({ ip }: { ip: string }) {
  return (
    <Panel title={`Host ${ip}`} kind="host">
      <QueryState q={useNodes({ q: ip, limit: 8 })}>
        {(page) => <p className="tabular">{formatInt(page.total)} nodes on this host</p>}
      </QueryState>
    </Panel>
  );
}

export function AppView({ name }: { name: string }) {
  return (
    <Panel title={`App ${name}`} kind="app">
      <QueryState q={useAppDetail(name)} />
    </Panel>
  );
}

export function AppHistoryView({ name, n }: { name: string; n: number }) {
  return (
    <Panel title={`App ${name}, spec version ${n}`} kind="app">
      <QueryState q={useAppHistory(name)} />
    </Panel>
  );
}

export function BlockView({ blockKey }: { blockKey: string }) {
  return (
    <Panel title={`Block ${blockKey}`} kind="explorer">
      <QueryState q={useBlock(blockKey)} />
    </Panel>
  );
}

export function TxView({ txid }: { txid: string }) {
  return (
    <Panel title="Transaction" kind="explorer">
      <p className="mono">{txid}</p>
      <QueryState q={useTx(txid)} />
    </Panel>
  );
}

export function AddressView({ addr }: { addr: string }) {
  return (
    <Panel title="Address" kind="explorer">
      <p className="mono">{addr}</p>
      <QueryState q={useAddress(addr)} />
      <QueryState q={useAddressNodes(addr)}>
        {(d) => <p className="tabular">{formatInt(d.nodes.length)} nodes paid to this address</p>}
      </QueryState>
    </Panel>
  );
}

export function MempoolView() {
  const live = useMempoolEntries();
  return (
    <Panel title="Mempool" kind="explorer">
      <p className="tabular">{formatInt(live.length)} pending transactions seen live</p>
      <QueryState q={useMempool()} />
    </Panel>
  );
}

export function SupplyView() {
  return (
    <Panel title="Supply and emission" kind="explorer">
      <QueryState q={useSupply()} />
    </Panel>
  );
}

export function RichListView() {
  return (
    <Panel title="Rich list" kind="explorer">
      <QueryState q={useRichList()} />
    </Panel>
  );
}

export function QueueView({ tier }: { tier?: QueueTier }) {
  const next = useNextPayees();
  const tiers = useNetwork((s) => s.tierStats);
  return (
    <Panel title={tier ? `Payment queue, ${tier}` : 'Payment queue'} kind="queue">
      <dl className="kv">
        {tiers
          .filter((t) => !tier || t.tier === tier)
          .map((t) => (
            <div key={t.tier} className="kv-row">
              <dt>{t.tier}</dt>
              <dd className="tabular">
                {formatInt(t.count)} nodes, cycle {formatInt(t.cycle_blocks)} blocks
              </dd>
            </div>
          ))}
      </dl>
      {next ? (
        <p className="tabular">
          Next payees for block {formatHeight(next.height)}:{' '}
          {next.payees.map((p) => `${p.tier} ${p.node ?? 'unknown'}`).join(', ')}
        </p>
      ) : (
        <p className="muted">Waiting for the next payees</p>
      )}
    </Panel>
  );
}

const OverviewTab = () => <QueryState q={useNetworkSummary()} />;
const GeographyTab = () => <QueryState q={useNetworkGeo()} />;
const HostingTab = () => <QueryState q={useNetworkProviders()} />;
const CapacityTab = () => <QueryState q={useNetworkCapacity()} />;
const VersionsTab = () => <QueryState q={useNetworkVersions()} />;
const ArchaeologyTab = () => <QueryState q={useTimeline()} />;
function ChurnTab() {
  const to = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const q = useMetrics({
    series: ['node_count', 'cumulus', 'nimbus', 'stratus'],
    from: to - 86_400_000,
    to,
    step: '1h',
  });
  return <QueryState q={q}>{(d) => <p className="tabular">{formatInt(d.t.length)} points</p>}</QueryState>;
}

const TABS: Record<AnalyticsTab, () => React.JSX.Element> = {
  overview: OverviewTab,
  geography: GeographyTab,
  hosting: HostingTab,
  capacity: CapacityTab,
  versions: VersionsTab,
  churn: ChurnTab,
  archaeology: ArchaeologyTab,
};

function AnalyticsBody({ tab }: { tab: AnalyticsTab }) {
  const Tab = TABS[tab];
  return <Tab />;
}

export function AnalyticsView({ tab }: { tab: AnalyticsTab }) {
  return (
    <Panel title={`Analytics, ${tab}`} kind="analytics">
      <AnalyticsBody tab={tab} />
    </Panel>
  );
}

export function OperatorView({ addr }: { addr: string }) {
  return (
    <Panel title="Operator" kind="operator">
      <p className="mono">{addr}</p>
      <QueryState q={useOperator(addr)} />
    </Panel>
  );
}

export function TimeMachineView({ t, speed }: { t?: string | undefined; speed?: number | undefined }) {
  return (
    <Panel title="Time machine" kind="time">
      <p className="tabular">
        {t ? `At ${t}` : 'Live'}
        {speed ? `, ${speed}x` : ''}
      </p>
      <QueryState q={useTimeline()} />
    </Panel>
  );
}

export function WeatherView() {
  const summary = useSummary();
  return (
    <Panel title="Network weather" kind="weather">
      <p className="tabular">
        {summary
          ? `${formatInt(summary.unreachable_count)} unreachable of ${formatInt(summary.node_count)}`
          : 'Waiting for data'}
      </p>
    </Panel>
  );
}

export function TerminalView({ cmd }: { cmd?: string | undefined }) {
  return (
    <Panel title="Terminal" kind="terminal">
      <p className="mono">{cmd ? `> ${cmd}` : '>'}</p>
    </Panel>
  );
}

export function AmbientView() {
  const { clock } = useRuntime();
  const now = useNow(clock);
  const tip = useTip();
  // Placeholder until the ambient team's view lands: a quiet caption in the corner, never over the
  // globe (the user found the full-screen clock ruined the presentation).
  return (
    <div
      data-testid="ambient"
      style={{
        position: 'fixed',
        left: 24,
        bottom: 20,
        zIndex: 10,
        pointerEvents: 'none',
        font: '500 12px/1.5 var(--font-mono)',
        letterSpacing: '0.04em',
        color: 'var(--text-2)',
        opacity: 0.75,
      }}
    >
      <span className="tabular">
        {tip ? `Block ${formatHeight(tip.height)} · ${formatAgo(now - tip.time_ms)}` : ''}
      </span>
      <span className="tabular" style={{ marginLeft: 16, opacity: 0.6 }}>
        {formatUtcTime(now)}
      </span>
    </div>
  );
}

export function AboutView() {
  const summary = useSummary();
  return (
    <Panel title="About Flux" kind="about">
      {summary ? (
        <dl className="kv">
          <div className="kv-row">
            <dt>Nodes</dt>
            <dd className="tabular">{formatInt(summary.node_count)}</dd>
          </div>
          <div className="kv-row">
            <dt>Apps</dt>
            <dd className="tabular">{formatInt(summary.app_count)}</dd>
          </div>
          <div className="kv-row">
            <dt>Countries</dt>
            <dd className="tabular">{formatInt(summary.country_count)}</dd>
          </div>
        </dl>
      ) : (
        <p className="muted">Loading</p>
      )}
    </Panel>
  );
}

const MOTIONS: MotionPref[] = ['system', 'full', 'reduced', 'off'];
const PERFS: PerfPref[] = ['auto', 'high', 'balanced', 'lite'];

export function SettingsView() {
  const motion = useUi((s) => s.motion);
  const setMotion = useUi((s) => s.setMotion);
  const perf = useUi((s) => s.perf);
  const setPerf = useUi((s) => s.setPerf);
  const art = useUi((s) => s.globeArt);
  const setArt = useUi((s) => s.setGlobeArt);
  return (
    <Panel title="Settings" kind="settings">
      <fieldset className="field">
        <legend>Motion</legend>
        {MOTIONS.map((m) => (
          <label key={m} className="radio">
            <input
              type="radio"
              name="motion"
              value={m}
              checked={motion === m}
              onChange={() => setMotion(m)}
            />{' '}
            {m}
          </label>
        ))}
      </fieldset>
      <fieldset className="field">
        <legend>Globe style</legend>
        {GLOBE_ARTS.map((a) => (
          <label key={a} className="radio">
            <input type="radio" name="globe-art" value={a} checked={art === a} onChange={() => setArt(a)} />{' '}
            {a}
          </label>
        ))}
      </fieldset>
      <fieldset className="field">
        <legend>Performance</legend>
        {PERFS.map((p) => (
          <label key={p} className="radio">
            <input type="radio" name="perf" value={p} checked={perf === p} onChange={() => setPerf(p)} /> {p}
          </label>
        ))}
      </fieldset>
    </Panel>
  );
}

export function SearchResultsView({ text }: { text: string }) {
  return (
    <Panel title={`Results for ${text}`} kind="search">
      <QueryState q={useSearch(text)}>
        {(r) =>
          r.hits.length === 0 ? (
            <p className="muted">No match</p>
          ) : (
            <ul className="list">
              {r.hits.map((h) => (
                <li key={`${h.kind}:${h.key}`}>
                  <span className="mono">{h.kind}</span> {h.label}{' '}
                  {h.sublabel ? <span className="muted">{h.sublabel}</span> : null}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Panel>
  );
}
