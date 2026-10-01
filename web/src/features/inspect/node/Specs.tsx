import { Cpu, GitBranch, RadioTower } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useNetworkCapacity, useNetworkVersions } from '../../../api/queries';
import { useNetwork, useRuntime } from '../../../app/context';
import { formatAgo, formatBandwidth, formatInt, formatUtcDateTime } from '../../../lib/format';
import { useUi } from '../../../store/ui';
import { describePercentile, medianOf, percentileOf } from '../derive/percentile';
import { latestVersion, mostCommon, shareOf, versionStanding } from '../derive/versions';
import { tierColumnsFor } from '../sources/live';
import { Alert, Chip, Grid, Meter, Section, StatusChip, Tile, tierLabel } from '../ui';
import { useNodeCtx } from './context';

/** Sorted benchmark columns of a tier, rebuilt at most once per node-slice change and shared by views. */
function usePercentiles(tier: string) {
  return useNetwork((s) => tierColumnsFor(s, tier));
}

const pctVar = (p: number | null) => ({ '--ix-p': p === null ? 0 : p / 100 }) as CSSProperties;

/** Benchmarked hardware with its standing inside the node's own tier. */
export function HardwareSection() {
  const { node, live, tier } = useNodeCtx();
  const hw = node?.hardware ?? null;
  const cap = useNetworkCapacity();
  const pcts = usePercentiles(tier);
  const { clock } = useRuntime();

  const cores = hw?.cores || live?.cores || 0;
  const ram = hw?.ram_gb || live?.ramGb || 0;
  const ssd = hw?.ssd_gb || live?.ssdGb || 0;
  const tierName = tierLabel(tier);

  const row = (value: number, sorted: Float64Array | undefined) => {
    const p = sorted ? percentileOf(sorted, value) : null;
    return { p, text: describePercentile(p, tierName), median: sorted ? medianOf(sorted) : null };
  };
  const c = row(cores, pcts?.cores);
  const r = row(ram, pcts?.ramGb);
  const s = row(ssd, pcts?.ssdGb);

  const tierCap = cap.data?.by_tier.find((x) => x.tier === tier)?.totals;
  const avgDown = tierCap && tierCap.nodes > 0 ? tierCap.down_mbps / tierCap.nodes : null;
  const avgUp = tierCap && tierCap.nodes > 0 ? tierCap.up_mbps / tierCap.nodes : null;
  const benchAt = hw && hw.bench_time_ms > 0 ? hw.bench_time_ms : null;
  const now = clock.now();

  const bench = hw?.bench_status ?? 'unknown';
  const benchTone =
    bench === 'passed' ? 'ok' : bench === 'failed' ? 'crit' : bench === 'running' ? 'pending' : 'off';
  const benchLabel =
    bench === 'passed'
      ? 'Benchmark passed'
      : bench === 'failed'
        ? 'Benchmark failed'
        : bench === 'running'
          ? 'Benchmark running'
          : 'No benchmark seen';

  return (
    <Section
      title="Hardware"
      icon={<Cpu size={16} strokeWidth={1.75} />}
      index={5}
      aside={
        <StatusChip
          tone={benchTone}
          icon={
            bench === 'passed'
              ? 'check'
              : bench === 'failed'
                ? 'x'
                : bench === 'running'
                  ? 'pending'
                  : 'dashed'
          }
          size="sm"
        >
          {benchLabel}
        </StatusChip>
      }
    >
      {bench === 'failed' && hw?.bench_error ? (
        <div className="ix-gap">
          <Alert tone="crit" title="The last benchmark failed">
            <span className="ix-mono">{hw.bench_error}</span>
          </Alert>
        </div>
      ) : null}
      <Grid>
        <Tile
          label="CPU"
          value={cores > 0 ? cores : 'Unknown'}
          unit={cores > 0 ? 'cores' : undefined}
          detail={hw ? `${formatInt(Math.round(hw.eps))} eps` : undefined}
        >
          <Meter
            value={c.p === null ? null : c.p / 100}
            kind="locked"
            label="Standing among the tier's cores"
          />
          <div className="ix-tile-d" style={pctVar(c.p)}>
            {c.text ?? ' '}
          </div>
        </Tile>
        <Tile
          label="Memory"
          value={ram > 0 ? formatInt(Math.round(ram)) : 'Unknown'}
          unit={ram > 0 ? 'GB' : undefined}
        >
          <Meter
            value={r.p === null ? null : r.p / 100}
            kind="locked"
            label="Standing among the tier's memory"
          />
          <div className="ix-tile-d">{r.text ?? ' '}</div>
        </Tile>
        <Tile
          label="SSD"
          value={ssd > 0 ? formatInt(Math.round(ssd)) : 'Unknown'}
          unit={ssd > 0 ? 'GB' : undefined}
        >
          <Meter
            value={s.p === null ? null : s.p / 100}
            kind="locked"
            label="Standing among the tier's storage"
          />
          <div className="ix-tile-d">
            {hw ? `${formatInt(Math.round(hw.disk_write_mbs))} MB/s write` : (s.text ?? ' ')}
          </div>
        </Tile>
        <Tile
          label="Network"
          value={hw ? formatBandwidth(hw.down_mbps).replace(/ Mbps| Gbps/, '') : 'Unknown'}
          unit={hw ? (hw.down_mbps >= 1000 ? 'Gbps down' : 'Mbps down') : undefined}
          detail={hw ? `${formatBandwidth(hw.up_mbps)} up, ${hw.ping_ms.toFixed(1)} ms` : undefined}
        >
          <Meter
            value={hw && avgDown ? Math.min(1, hw.down_mbps / (avgDown * 2)) : null}
            kind="locked"
            label="Download against twice the tier average"
          />
          <div className="ix-tile-d">
            {hw && avgDown && avgUp ? `tier average ${formatBandwidth(avgDown)} down` : ' '}
          </div>
        </Tile>
      </Grid>
      <p className="ix-cap">
        {pcts
          ? `Standing is measured against every ${tierName} node with a benchmark. `
          : 'No tier to compare against. '}
        Speed tests and EPS are the node's own report.
        {benchAt ? ` Benchmarked ${formatAgo(now - benchAt)} (${formatUtcDateTime(benchAt)}).` : ''}
        {hw?.system_secure === false ? ' The system is reported as not secure.' : ''}
      </p>
      {hw && hw.bench_tier !== 'unknown' && hw.bench_tier !== tier ? (
        <p className="ix-cap" data-tone="warn">
          The benchmark qualified this node for {tierLabel(hw.bench_tier)}, not {tierName}.
        </p>
      ) : null}
    </Section>
  );
}

// ---- versions ---------------------------------------------------------------------------------------

function VersionRow({
  label,
  value,
  latest,
  share,
  note,
}: {
  label: string;
  value: string | null | undefined;
  latest?: string | null;
  share?: number | null;
  note?: string;
}) {
  const standing = versionStanding(value, latest ?? null);
  return (
    <div className="ix-vrow">
      <dt>{label}</dt>
      <dd>
        <span className="ix-mono">{value || 'Unknown'}</span>
        {standing === 'latest' ? (
          <StatusChip
            tone="ok"
            icon="check"
            size="sm"
            title={`The newest release the network runs (${latest})`}
          >
            latest
          </StatusChip>
        ) : standing === 'behind' ? (
          <StatusChip tone="warn" icon="alert" size="sm" title={`The newest release is ${latest}`}>
            behind {latest}
          </StatusChip>
        ) : standing === 'ahead' ? (
          <Chip size="sm" title={`Newer than the release most nodes run (${latest})`}>
            ahead
          </Chip>
        ) : note ? (
          <Chip size="sm">{note}</Chip>
        ) : null}
        {share != null ? (
          <span className="ix-dim ix-mono">{(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of nodes</span>
        ) : null}
      </dd>
    </div>
  );
}

/** Every software version on the node with a "latest" marker where there is one. */
export function VersionsSection() {
  const { node, live } = useNodeCtx();
  const v = useNetworkVersions();
  const flux = node?.versions.flux_os ?? (live?.fluxOs || null);
  const d = v.data;

  const latestOs = d ? latestVersion(d.flux_os) : null;
  const latestDaemon = d ? latestVersion(d.daemon) : null;
  const latestBench = d ? latestVersion(d.bench) : null;
  const arcaneCurrent = d ? mostCommon(d.arcane) : null;
  const arcane = node?.versions.arcane ?? null;

  return (
    <Section title="Versions" icon={<GitBranch size={16} strokeWidth={1.75} />} index={6}>
      <dl className="ix-vlist">
        <VersionRow
          label="FluxOS"
          value={flux}
          latest={latestOs}
          share={d ? shareOf(d.flux_os, flux) : null}
        />
        <VersionRow
          label="Daemon"
          value={node?.versions.daemon}
          latest={latestDaemon}
          share={d ? shareOf(d.daemon, node?.versions.daemon) : null}
        />
        <VersionRow
          label="Benchmark"
          value={node?.versions.bench}
          latest={latestBench}
          share={d ? shareOf(d.bench, node?.versions.bench) : null}
        />
        <VersionRow
          label="ArcaneOS"
          value={node ? (node.arcane ? (arcane ?? 'Unknown release') : 'Not ArcaneOS') : null}
          note={
            arcane && arcaneCurrent
              ? arcane === arcaneCurrent
                ? 'current release'
                : `current is ${arcaneCurrent}`
              : undefined
          }
          share={d ? shareOf(d.arcane, arcane) : null}
        />
        <VersionRow label="Docker" value={null} note="not reported" />
        <VersionRow
          label="OS"
          value={node?.versions.os}
          share={d ? shareOf(d.os, node?.versions.os) : null}
        />
      </dl>
      <p className="ix-cap">
        The latest release is the newest version that a real share of the network runs, so a single test build
        never counts.
      </p>
    </Section>
  );
}

// ---- reachability -----------------------------------------------------------------------------------

/** The node's reachability from the stats round, and whether Atlas is probing it live. */
export function ReachSection() {
  const { id, node, live } = useNodeCtx();
  const { clock } = useRuntime();
  const watched = useUi((s) => id !== null && s.watched.includes(id));
  const reachable = live?.reachable ?? node?.reachable ?? null;
  const now = clock.now();
  const swept = node?.last_swept_ms ?? null;

  return (
    <Section title="Reachability" icon={<RadioTower size={16} strokeWidth={1.75} />} index={7}>
      <dl className="ix-kv">
        <dt>Stats round</dt>
        <dd data-sans="">
          {reachable === true ? (
            <StatusChip tone="ok" icon="check" size="sm">
              Reachable
            </StatusChip>
          ) : reachable === false ? (
            <StatusChip tone="off" icon="dashed" size="sm">
              Unreachable
            </StatusChip>
          ) : (
            <StatusChip tone="off" icon="dashed" size="sm">
              Not checked yet
            </StatusChip>
          )}
        </dd>
        <dt>Last checked</dt>
        <dd>{swept ? `${formatAgo(now - swept)}` : 'Unknown'}</dd>
        <dt>WatchProbe</dt>
        <dd data-sans="">
          {watched ? (
            <StatusChip
              tone="ok"
              icon="check"
              size="sm"
              title="Atlas probes this node ahead of the regular sweep"
            >
              Probing live
            </StatusChip>
          ) : (
            <span className="ix-dim">Watch the node to probe it live</span>
          )}
        </dd>
        <dt>First seen</dt>
        <dd>{node ? formatUtcDateTime(node.first_seen_ms) : 'Unknown'}</dd>
        <dt>Last seen</dt>
        <dd>{node ? formatAgo(now - node.last_seen_ms) : 'Unknown'}</dd>
      </dl>
    </Section>
  );
}
