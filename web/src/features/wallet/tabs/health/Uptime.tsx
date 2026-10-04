// How reliably the nodes stayed up over the last seven days: the share of the time Atlas could see each node that it was
// confirmed. A thousand-node wallet is measured on an even sample, in waves, and the histogram fills in as the answers
// arrive; the lowest nodes are listed so the figure is something to act on. The bars have a table twin and a sentence.

import { Activity } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { formatInt, formatPercent, shortCollateral } from '../../../../lib/format';
import { AnimatedNumber, Button, EmptyState, EntityLink, Skeleton, TierGlyph } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { UPTIME_SAMPLE, useUptimeSample } from '../../hooks/useUptime';
import { medianOf, uptimeBands } from '../../lib/health';
import { Panel } from '../../ui/Panel';

/** The colour of each band, lowest first: a weak band is warm, the rest are the neutral ramp. */
const BAND_COLOR = [
  'var(--status-crit)',
  'var(--status-warn)',
  'var(--seq-3)',
  'var(--seq-4)',
  'var(--seq-5)',
];

const LOWEST = 5;

/** `99.97%`; a node that was up the whole time is `100%`, not `100.00%`. */
const pct = (n: number): string => formatPercent(n / 100, n >= 99.995 ? 0 : 2);

export function Uptime() {
  const { fleet, globe } = useWalletCtx();
  const keys = useMemo(() => fleet.rows.filter((r) => r.key.includes(':')).map((r) => r.key), [fleet.rows]);
  const rowMap = useMemo(() => new Map(fleet.rows.map((r) => [r.key, r])), [fleet.rows]);
  const u = useUptimeSample(keys);

  const values = useMemo(() => u.nodes.map((n) => n.pct), [u.nodes]);
  const bands = useMemo(() => uptimeBands(values), [values]);
  const median = useMemo(() => medianOf(values), [values]);
  const biggest = Math.max(1, ...bands.map((b) => b.count));
  const lowest = useMemo(() => [...u.nodes].sort((a, b) => a.pct - b.pct).slice(0, LOWEST), [u.nodes]);
  const weak = lowest.filter((n) => n.pct < 99.5);
  const under95 = values.filter((v) => v < 95).length;
  const measuring = !u.done;
  const sampled = u.asked < keys.length;

  if (keys.length === 0) {
    return (
      <Panel title="Uptime" icon={Activity}>
        <EmptyState compact title="No nodes to measure">
          Uptime is how much of the last seven days each node was confirmed. This wallet has no nodes.
        </EmptyState>
      </Panel>
    );
  }

  const allFailed = u.done && u.nodes.length === 0 && u.failed > 0;
  const aside = measuring
    ? `measuring ${formatInt(u.settled)} of ${formatInt(u.asked)} nodes`
    : sampled
      ? `last 7 days, measured on an even sample of ${formatInt(u.asked)} of ${formatInt(keys.length)} nodes`
      : `last 7 days, ${formatInt(u.asked)} ${u.asked === 1 ? 'node' : 'nodes'}`;

  if (allFailed) {
    return (
      <Panel title="Uptime" icon={Activity} aside={aside}>
        <EmptyState
          compact
          tone="warn"
          icon={Activity}
          title="Uptime could not be read right now"
          action={
            <Button size="sm" onClick={u.retry}>
              Try again
            </Button>
          }
        >
          Atlas reads each node's recent status one by one, and none answered. Nothing else on this page
          depends on it.
        </EmptyState>
      </Panel>
    );
  }

  const sentence =
    u.nodes.length === 0
      ? 'No node has been observed long enough to measure yet.'
      : `Median uptime is ${pct(median ?? 0)} over ${formatInt(u.nodes.length)} ${u.nodes.length === 1 ? 'node' : 'nodes'}${under95 > 0 ? `, and ${formatInt(under95)} ${under95 === 1 ? 'is' : 'are'} under 95%` : ''}.`;

  return (
    <Panel title="Uptime" icon={Activity} aside={aside} aria-busy={measuring || undefined}>
      <div className="wl-uptime">
        <figure className="wl-hist" aria-label="Nodes by uptime over the last seven days">
          <div className="wl-hist__bars">
            {bands.map((b, i) => (
              <div
                key={b.id}
                className="wl-hist__col"
                data-empty={b.count === 0 || undefined}
                style={{ '--wl-h': b.count / biggest, '--wl-c': BAND_COLOR[i] } as CSSProperties}
              >
                <span className="wl-hist__n ui-mono">
                  <AnimatedNumber value={b.count} maxHz={0} tint={false} font="mono" />
                </span>
                <i className="wl-hist__bar" />
                <span className="wl-hist__label">{b.label}</span>
              </div>
            ))}
          </div>
          <figcaption className="wl-note">
            {measuring && u.nodes.length === 0 ? <Skeleton w="60%" h={12} /> : sentence}
          </figcaption>
        </figure>

        <div className="wl-uptime__side">
          <dl className="wl-uptime__stats">
            <div>
              <dt>Median</dt>
              <dd className="ui-mono">{median === null ? 'Unknown' : pct(median)}</dd>
            </div>
            <div>
              <dt>Under 95%</dt>
              <dd className="ui-mono">{u.nodes.length === 0 ? 'Unknown' : formatInt(under95)}</dd>
            </div>
          </dl>
          <h3 className="wl-sub">Lowest uptime</h3>
          {u.nodes.length === 0 ? (
            <p className="wl-note">{measuring ? 'Reading the nodes.' : 'Nothing to list.'}</p>
          ) : weak.length === 0 ? (
            <p className="wl-note">
              Every node measured was confirmed for at least 99.5% of the time Atlas saw it.
            </p>
          ) : (
            <ol className="wl-lowest" aria-label="The nodes with the lowest uptime">
              {weak.map((n) => {
                const row = rowMap.get(n.key) ?? null;
                return (
                  <li
                    key={n.key}
                    onPointerEnter={() => globe.hover(row)}
                    onPointerLeave={() => globe.hover(null)}
                    onFocus={() => globe.hover(row)}
                    onBlur={() => globe.hover(null)}
                  >
                    <TierGlyph tier={row?.tier ?? 'unknown'} size={14} />
                    <EntityLink kind="node" value={n.key} mono className="wl-lowest__node">
                      {row?.endpoint || shortCollateral(n.key)}
                    </EntityLink>
                    <span className="wl-lowest__pct ui-mono">{pct(n.pct)}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {sampled ? (
            <p className="wl-note">
              A node costs one request, so at most {formatInt(UPTIME_SAMPLE)} are measured; the sample is
              spread evenly over the fleet.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
