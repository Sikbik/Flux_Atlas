// The fleet at a glance: one cell per node coloured by how it is doing, the issues that matter most in plain words,
// and the one concentration fact worth knowing before anything else (what one provider outage would cost). Details
// live a tab away; this is the part that fits in a glance.

import { Info, OctagonX, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { formatInt } from '../../../../lib/format';
import { ShareBar, type ShareSegment, StatusChip } from '../../../../ui';
import { FleetGrid } from '../../../inspect/operator/FleetGrid';
import { useWalletCtx } from '../../context';
import { useOpenNode } from '../../hooks/useOpenNode';
import { BUCKET_LABEL, type Bucket, bucketOf } from '../../lib/fleet';
import { groupIssues, readConcentration, type Severity } from '../../lib/health';
import { Panel } from '../../ui/Panel';

const SEVERITY_ICON: Record<Severity, typeof Info> = { crit: OctagonX, warn: TriangleAlert, info: Info };
const SEVERITY_WORD: Record<Severity, string> = {
  crit: 'Needs action',
  warn: 'Worth a look',
  info: 'For information',
};

/** The first sentence of a piece of advice: enough for a glance, the rest is in Health and risk. */
export function firstSentence(text: string): string {
  const m = /^.*?[.!?](?=\s|$)/.exec(text);
  return m ? m[0] : text;
}

const BUCKET_COLOR: Record<Bucket, string> = {
  healthy: 'var(--status-ok)',
  attention: 'var(--status-warn)',
  down: 'var(--status-crit)',
};

export function FleetHealth() {
  const { dto, fleet, setTab } = useWalletCtx();
  const open = useOpenNode();
  const total = fleet.rows.length;

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { healthy: 0, attention: 0, down: 0 };
    for (const r of fleet.rows) c[bucketOf(r)]++;
    return c;
  }, [fleet.rows]);

  const sorted = useMemo(() => {
    const eta = new Map(fleet.rows.map((r) => [r.key, r.etaMs ?? Number.POSITIVE_INFINITY]));
    return [...fleet.nodes].sort(
      (a, b) =>
        (eta.get(a.outpoint || `#${a.id}`) ?? Number.POSITIVE_INFINITY) -
        (eta.get(b.outpoint || `#${b.id}`) ?? Number.POSITIVE_INFINITY),
    );
  }, [fleet.nodes, fleet.rows]);

  const issues = useMemo(() => groupIssues(dto.health.attention), [dto.health.attention]);
  const provider = dto.concentration.find((c) => c.by === 'provider');
  const read = provider && total > 0 ? readConcentration(provider, total) : null;

  const segments: ShareSegment[] = (['healthy', 'attention', 'down'] as const)
    .filter((b) => counts[b] > 0)
    .map((b) => ({ id: b, label: BUCKET_LABEL[b], value: counts[b], color: BUCKET_COLOR[b] }));

  if (total === 0) {
    return (
      <Panel title="Fleet health">
        <p className="wl-note">
          No node is paid to this address, so there is no fleet to watch. Nodes appear here as soon as one
          names this address as its payment address.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Fleet health"
      aside={
        counts.attention + counts.down === 0 ? (
          <StatusChip status="confirmed" label="All healthy" size="sm" />
        ) : (
          `${formatInt(counts.attention + counts.down)} of ${formatInt(total)} need a look`
        )
      }
    >
      <ShareBar
        segments={segments}
        size="md"
        legend="inline"
        label="Nodes by state"
        format={(v) => `${formatInt(v)} ${v === 1 ? 'node' : 'nodes'}`}
      />
      {total >= 8 ? (
        <div className="wl-grid">
          <FleetGrid nodes={sorted} onOpen={(n) => open(n.outpoint || n.endpoint || String(n.id))} />
          <p className="wl-note">
            One cell per node, the next to be paid first. Healthy nodes sit back so the others stand out.
          </p>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <ul className="wl-issues" aria-label="What needs attention">
          {issues.slice(0, 3).map((g) => {
            const Icon = SEVERITY_ICON[g.severity];
            return (
              <li key={g.kind} data-severity={g.severity}>
                <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                <span>
                  <b>
                    {g.title}
                    <em>{SEVERITY_WORD[g.severity]}</em>
                  </b>
                  <i>{firstSentence(g.fix)}</i>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {issues.length > 3 ? (
        <p className="wl-note">{formatInt(issues.length - 3)} more kinds of issue in Health and risk.</p>
      ) : null}

      {read ? (
        <div className="wl-risk" data-level={read.level}>
          <StatusChip
            status={read.level === 'low' ? 'confirmed' : 'at-risk'}
            label={`${read.label} by provider`}
            size="sm"
          />
          <p className="wl-note">{read.headline}</p>
        </div>
      ) : null}

      <button type="button" className="wl-more" onClick={() => setTab('health')}>
        See health and risk in full
      </button>
    </Panel>
  );
}
