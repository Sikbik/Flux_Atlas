import { useNetworkCapacity, useNetworkVersions } from '../../../api/queries';
import { useNetwork, useRuntime } from '../../../app/context';
import { formatAgo, formatBandwidth, formatInt, formatUtcDateTime } from '../../../lib/format';
import { Chip, KeyValue, type KeyValueItem, Meter, StatusChip, tierLabel, Unknown } from '../../../ui';
import { describePercentile, medianOf, percentileOf } from '../derive/percentile';
import { latestVersion, mostCommon, shareOf, versionStanding } from '../derive/versions';
import { tierColumnsFor } from '../sources/live';
import { Callout } from '../ui/callout';
import { useNodeCtx } from './context';

/** Sorted benchmark columns of a tier, rebuilt at most once per node-slice change and shared by views. */
function usePercentiles(tier: string) {
  return useNetwork((s) => tierColumnsFor(s, tier));
}

/** A figure with a small gauge of where it stands among the node's tier. */
function Spec({ text, standing, label }: { text: string | null; standing: number | null; label: string }) {
  if (text === null) return <Unknown />;
  return (
    <span className="ix-spec">
      <span className="ui-mono">{text}</span>
      {standing !== null ? <Meter className="ix-spec-m" label={label} value={standing / 100} /> : null}
    </span>
  );
}

/** Benchmarked hardware with its standing inside the node's own tier. */
export function HardwareBody() {
  const { node, live, tier } = useNodeCtx();
  const hw = node?.hardware ?? null;
  const cap = useNetworkCapacity();
  const pcts = usePercentiles(tier);
  const { clock } = useRuntime();

  const cores = hw?.cores || live?.cores || 0;
  const ram = hw?.ram_gb || live?.ramGb || 0;
  const ssd = hw?.ssd_gb || live?.ssdGb || 0;
  const named = tier === 'unknown' ? 'its tier' : tierLabel(tier);

  const stand = (value: number, sorted: Float64Array | undefined) => {
    const p = sorted && value > 0 ? percentileOf(sorted, value) : null;
    return { p, text: describePercentile(p, named), median: sorted ? medianOf(sorted) : null };
  };
  const c = stand(cores, pcts?.cores);
  const r = stand(ram, pcts?.ramGb);
  const s = stand(ssd, pcts?.ssdGb);

  const tierCap = cap.data?.by_tier.find((x) => x.tier === tier)?.totals;
  const avgDown = tierCap && tierCap.nodes > 0 ? tierCap.down_mbps / tierCap.nodes : null;
  const downStanding = hw && avgDown ? Math.min(1, hw.down_mbps / (avgDown * 2)) * 100 : null;
  const benchAt = hw && hw.bench_time_ms > 0 ? hw.bench_time_ms : null;
  const now = clock.now();
  const bench = hw?.bench_status ?? 'unknown';

  const items: KeyValueItem[] = [
    {
      label: 'CPU',
      value: (
        <Spec
          text={cores > 0 ? `${cores} cores` : null}
          standing={c.p}
          label="Standing among the tier's cores"
        />
      ),
      note:
        [c.text, hw ? `${formatInt(Math.round(hw.eps))} eps` : null].filter(Boolean).join(' · ') || undefined,
    },
    {
      label: 'Memory',
      value: (
        <Spec
          text={ram > 0 ? `${formatInt(Math.round(ram))} GB` : null}
          standing={r.p}
          label="Standing among the tier's memory"
        />
      ),
      note: r.text ?? undefined,
    },
    {
      label: 'SSD',
      value: (
        <Spec
          text={ssd > 0 ? `${formatInt(Math.round(ssd))} GB` : null}
          standing={s.p}
          label="Standing among the tier's storage"
        />
      ),
      note:
        [s.text, hw ? `${formatInt(Math.round(hw.disk_write_mbs))} MB/s write` : null]
          .filter(Boolean)
          .join(' · ') || undefined,
    },
    {
      label: 'Network',
      value: (
        <Spec
          text={hw ? `${formatBandwidth(hw.down_mbps)} down` : null}
          standing={downStanding}
          label="Download against twice the tier average"
        />
      ),
      note: hw
        ? `${formatBandwidth(hw.up_mbps)} up, ${hw.ping_ms.toFixed(1)} ms${avgDown ? `, tier average ${formatBandwidth(avgDown)} down` : ''}`
        : undefined,
    },
  ];

  return (
    <div className="ix-stack">
      <div className="ix-bench">
        <StatusChip
          size="sm"
          status={
            bench === 'passed'
              ? 'confirmed'
              : bench === 'failed'
                ? 'error'
                : bench === 'running'
                  ? 'syncing'
                  : 'unknown'
          }
          label={
            bench === 'passed'
              ? 'Benchmark passed'
              : bench === 'failed'
                ? 'Benchmark failed'
                : bench === 'running'
                  ? 'Benchmark running'
                  : 'No benchmark seen'
          }
        />
        {benchAt ? (
          <span className="ix-dim" title={formatUtcDateTime(benchAt)}>
            {formatAgo(now - benchAt)}
          </span>
        ) : null}
      </div>
      {bench === 'failed' && hw?.bench_error ? (
        <Callout tone="crit" title="The last benchmark failed">
          <span className="ui-mono">{hw.bench_error}</span>
        </Callout>
      ) : null}
      <KeyValue items={items} />
      <p className="ix-cap">
        {pcts
          ? `Standing is measured against every ${named} node with a benchmark. `
          : 'No tier to compare against. '}
        Speed tests and EPS are the node's own report.
        {hw?.system_secure === false ? ' The system is reported as not secure.' : ''}
      </p>
      {hw && hw.bench_tier !== 'unknown' && hw.bench_tier !== tier ? (
        <p className="ix-cap" data-tone="warn">
          The benchmark qualified this node for {tierLabel(hw.bench_tier)}, not {named}.
        </p>
      ) : null}
    </div>
  );
}

// ---- versions ---------------------------------------------------------------------------------------

function VersionValue({
  value,
  latest,
  share,
  note,
}: {
  value: string | null | undefined;
  latest?: string | null;
  share?: number | null;
  note?: string;
}) {
  if (!value) return <Unknown />;
  const standing = versionStanding(value, latest ?? null);
  return (
    <span className="ix-ver">
      <span className="ui-mono">{value}</span>
      {standing === 'latest' ? (
        <StatusChip
          size="sm"
          status="confirmed"
          label="latest"
          title={`The newest release the network runs (${latest})`}
        />
      ) : standing === 'behind' ? (
        <StatusChip
          size="sm"
          status="at-risk"
          label={`behind ${latest}`}
          title={`The newest release is ${latest}`}
        />
      ) : standing === 'ahead' ? (
        <Chip size="sm" title={`Newer than the release most nodes run (${latest})`}>
          ahead
        </Chip>
      ) : note ? (
        <Chip size="sm">{note}</Chip>
      ) : null}
      {share != null ? (
        <span className="ix-dim ui-mono">{(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of nodes</span>
      ) : null}
    </span>
  );
}

/** Every software version on the node with a "latest" marker where there is one. */
export function VersionsBody() {
  const { node, live } = useNodeCtx();
  const v = useNetworkVersions();
  const flux = node?.versions.flux_os ?? (live?.fluxOs || null);
  const d = v.data;

  const latestOs = d ? latestVersion(d.flux_os) : null;
  const latestDaemon = d ? latestVersion(d.daemon) : null;
  const latestBench = d ? latestVersion(d.bench) : null;
  const arcaneCurrent = d ? mostCommon(d.arcane) : null;
  const arcane = node?.versions.arcane ?? null;

  const items: KeyValueItem[] = [
    {
      label: 'FluxOS',
      value: <VersionValue value={flux} latest={latestOs} share={d ? shareOf(d.flux_os, flux) : null} />,
    },
    {
      label: 'Daemon',
      value: (
        <VersionValue
          value={node?.versions.daemon}
          latest={latestDaemon}
          share={d ? shareOf(d.daemon, node?.versions.daemon) : null}
        />
      ),
    },
    {
      label: 'Benchmark',
      value: (
        <VersionValue
          value={node?.versions.bench}
          latest={latestBench}
          share={d ? shareOf(d.bench, node?.versions.bench) : null}
        />
      ),
    },
    {
      label: 'ArcaneOS',
      // `arcane` is true, false or not known (a node no sweep has reached): only an explicit false says "not ArcaneOS".
      value: node ? (
        node.arcane === null ? null : node.arcane ? (
          <VersionValue
            value={arcane ?? 'Unknown release'}
            note={
              arcane && arcaneCurrent
                ? arcane === arcaneCurrent
                  ? 'current release'
                  : `current is ${arcaneCurrent}`
                : undefined
            }
            share={d ? shareOf(d.arcane, arcane) : null}
          />
        ) : (
          'Not ArcaneOS'
        )
      ) : null,
    },
    {
      label: 'OS',
      value: <VersionValue value={node?.versions.os} share={d ? shareOf(d.os, node?.versions.os) : null} />,
    },
  ];
  return (
    <div className="ix-stack">
      <KeyValue items={items} />
      <p className="ix-cap">
        The latest release is the newest version that a real share of the network runs, so a single test build
        never counts.
      </p>
    </div>
  );
}
