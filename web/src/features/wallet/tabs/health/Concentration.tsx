// How concentrated the fleet is: by provider, by country and by city. The risk is a shared outage, so each card says in
// plain words what losing the biggest group would take down, grades the spread with the Herfindahl index on a three-band
// gauge, and lists the groups as bars. Choosing a group shows its nodes in the Fleet tab.

import { type CSSProperties, useMemo } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { BarList, type BarListItem, EmptyState, StatusChip } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { showInFleet } from '../../hooks/useFleetView';
import { rowsInBucket } from '../../lib/fleet';
import {
  concentrationTitle,
  effectiveGroups,
  HHI_BANDS,
  HHI_GAUGE,
  hhiPosition,
  type RiskLevel,
  readConcentration,
  UNKNOWN_BUCKET,
} from '../../lib/health';
import type { ConcentrationBy, WalletConcentration } from '../../types';
import { Panel } from '../../ui/Panel';

const ORDER: readonly ConcentrationBy[] = ['provider', 'country', 'city'];

const LEVEL: Record<RiskLevel | 'unknown', { status: string; word: string }> = {
  low: { status: 'confirmed', word: 'Diversified' },
  moderate: { status: 'at-risk', word: 'Moderate' },
  high: { status: 'error', word: 'Concentrated' },
  unknown: { status: 'unknown', word: 'Unknown' },
};

/**
 * The index on a three-band track: green under 0.15, amber to 0.25, red above. The ticks are the band edges, so the
 * scale is readable as numbers; the level is also said as a word in the card's chip.
 */
function RiskGauge({ hhi, level }: { hhi: number; level: RiskLevel | 'unknown' }) {
  const style = {
    '--wl-pos': hhiPosition(hhi),
    '--wl-m': `${HHI_GAUGE.moderate * 100}%`,
    '--wl-h': `${HHI_GAUGE.high * 100}%`,
  } as CSSProperties;
  return (
    <div
      className="wl-hhi"
      data-level={level}
      style={style}
      role="img"
      aria-label={`Concentration index ${hhi.toFixed(2)} on a scale where under ${HHI_BANDS.moderate} is diversified and over ${HHI_BANDS.high} is concentrated`}
    >
      <span className="wl-hhi__track">
        <i className="wl-hhi__marker" />
      </span>
      <span className="wl-hhi__ticks" aria-hidden="true">
        <span style={{ left: '0%' }}>0</span>
        <span style={{ left: `${HHI_GAUGE.moderate * 100}%` }}>{HHI_BANDS.moderate}</span>
        <span style={{ left: `${HHI_GAUGE.high * 100}%` }}>{HHI_BANDS.high}</span>
        <span style={{ left: '100%' }}>1</span>
      </span>
    </div>
  );
}

function Card({ c }: { c: WalletConcentration }) {
  const { fleet, addr, setTab } = useWalletCtx();
  const read = useMemo(() => readConcentration(c), [c]);
  const title = concentrationTitle(c.by);
  const lv = LEVEL[read.level];

  const items = useMemo<BarListItem[]>(
    () =>
      c.buckets.map((b) => {
        const members = rowsInBucket(fleet.rows, c.by, b);
        return {
          id: b.key,
          label: b.label,
          title: `${b.label}: ${formatInt(b.nodes)} ${b.nodes === 1 ? 'node' : 'nodes'}`,
          value: b.nodes,
          display: formatInt(b.nodes),
          detail: read.total > 0 ? formatPercent(b.nodes / read.total, 0) : undefined,
          color: b.key === UNKNOWN_BUCKET ? 'var(--viz-other)' : undefined,
          onSelect:
            members.length > 0
              ? () => {
                  showInFleet(addr, {
                    only: { label: `${title}: ${b.label}`, keys: members.map((m) => m.key) },
                  });
                  setTab('fleet');
                }
              : undefined,
        };
      }),
    [c.buckets, c.by, fleet.rows, read.total, addr, setTab, title],
  );

  return (
    <section
      className="wl-conc"
      aria-label={`Concentration by ${title.toLowerCase()}`}
      data-level={read.level}
    >
      <header className="wl-conc__head">
        <h3 className="wl-sub">By {title.toLowerCase()}</h3>
        <StatusChip status={lv.status} label={lv.word} size="sm" />
      </header>
      <p className="wl-conc__headline">{read.headline}</p>
      {read.level === 'unknown' ? null : (
        <>
          <RiskGauge hhi={c.hhi} level={read.level} />
          <p className="wl-note">
            Spread as thinly as {effectiveGroups(c.hhi)}.
            {read.unknown > 0
              ? ` ${formatInt(read.unknown)} ${read.unknown === 1 ? 'node has' : 'nodes have'} no known ${title.toLowerCase()} and ${read.unknown === 1 ? 'is' : 'are'} left out of the index.`
              : ''}
          </p>
        </>
      )}
      <BarList
        label={`Nodes by ${title.toLowerCase()}`}
        items={items}
        total={Math.max(1, read.total)}
        limit={5}
        labelWidth="minmax(96px, 42%)"
      />
    </section>
  );
}

export function Concentration() {
  const { dto } = useWalletCtx();
  const cards = useMemo(
    () =>
      ORDER.map((by) => dto.concentration.find((c) => c.by === by)).filter(
        (c): c is WalletConcentration => c !== undefined,
      ),
    [dto.concentration],
  );

  if (cards.length === 0 || dto.nodes.length === 0) {
    return (
      <Panel title="Where the nodes are">
        <EmptyState compact title="Nothing to compare">
          Concentration is how the nodes of a wallet are spread over providers, countries and cities. This
          wallet has no nodes to spread.
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title="Where the nodes are"
      aside="a shared outage is the risk: the fewer places, the more one failure takes"
    >
      <div className="wl-trio">
        {cards.map((c) => (
          <Card key={c.by} c={c} />
        ))}
      </div>
    </Panel>
  );
}
