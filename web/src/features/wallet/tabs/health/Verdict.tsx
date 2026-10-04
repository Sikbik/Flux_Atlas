// The verdict first: how many nodes are fine, how many need action, how many deserve a look, how many are only notes.
// A node counts once, at its worst finding, so the four add up to the fleet and the bar under them is the whole of it.

import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import { useMemo } from 'react';
import { formatInt, formatPercent } from '../../../../lib/format';
import { AnimatedNumber, ShareBar, type ShareSegment, Stat, StatGrid } from '../../../../ui';
import { type IssueSummary, SEVERITY_WORD } from '../../lib/health';
import { Panel } from '../../ui/Panel';

export interface VerdictProps {
  healthy: number;
  summary: IssueSummary;
}

const count = (n: number, word: string) => `${formatInt(n)} ${n === 1 ? word : `${word}s`}`;

export function Verdict({ healthy, summary }: VerdictProps) {
  const total = healthy + summary.flagged;
  const share = total === 0 ? null : healthy / total;

  const segments = useMemo<ShareSegment[]>(
    () => [
      { id: 'healthy', label: 'Healthy', value: healthy, color: 'var(--status-ok)' },
      { id: 'info', label: 'Notes only', value: summary.nodes.info, color: 'var(--status-pending)' },
      { id: 'warn', label: 'Warnings', value: summary.nodes.warn, color: 'var(--status-warn)' },
      { id: 'crit', label: 'Critical', value: summary.nodes.crit, color: 'var(--status-crit)' },
    ],
    [healthy, summary.nodes],
  );

  const headline =
    summary.flagged === 0
      ? 'Every node is healthy.'
      : summary.nodes.crit > 0
        ? `${count(summary.nodes.crit, 'node')} ${summary.nodes.crit === 1 ? 'needs' : 'need'} action now.`
        : summary.nodes.warn > 0
          ? `${count(summary.nodes.warn, 'node')} ${summary.nodes.warn === 1 ? 'deserves' : 'deserve'} a look.`
          : 'Nothing is wrong; there are only notes.';

  return (
    <Panel title="Health and risk" aside={headline}>
      <StatGrid min={170}>
        <Stat
          label={
            <span className="wl-sevlabel" data-severity="ok">
              <CircleCheck size={13} strokeWidth={1.5} aria-hidden="true" /> Healthy
            </span>
          }
          value={<AnimatedNumber value={healthy} maxHz={0} tint={false} />}
          unit={`of ${formatInt(total)}`}
          caption={share === null ? undefined : `${formatPercent(share, 1)} of the fleet`}
        />
        <Stat
          label={
            <span className="wl-sevlabel" data-severity="crit">
              <CircleX size={13} strokeWidth={1.5} aria-hidden="true" /> {SEVERITY_WORD.crit}
            </span>
          }
          value={<AnimatedNumber value={summary.nodes.crit} maxHz={0} tint={false} />}
          unit={summary.nodes.crit === 1 ? 'node' : 'nodes'}
          caption={`${count(summary.issues.crit, 'issue')}, needs action`}
        />
        <Stat
          label={
            <span className="wl-sevlabel" data-severity="warn">
              <TriangleAlert size={13} strokeWidth={1.5} aria-hidden="true" /> {SEVERITY_WORD.warn}s
            </span>
          }
          value={<AnimatedNumber value={summary.nodes.warn} maxHz={0} tint={false} />}
          unit={summary.nodes.warn === 1 ? 'node' : 'nodes'}
          caption={`${count(summary.issues.warn, 'issue')}, worth a look`}
        />
        <Stat
          label={
            <span className="wl-sevlabel" data-severity="info">
              <Info size={13} strokeWidth={1.5} aria-hidden="true" /> {SEVERITY_WORD.info}s
            </span>
          }
          value={<AnimatedNumber value={summary.nodes.info} maxHz={0} tint={false} />}
          unit={summary.nodes.info === 1 ? 'node' : 'nodes'}
          caption={`${count(summary.issues.info, 'issue')}, for when it suits you`}
        />
      </StatGrid>
      {total > 0 ? (
        <ShareBar
          segments={segments}
          size="lg"
          legend="inline"
          label="Nodes by their worst finding"
          format={(v) => formatInt(Math.round(v))}
        />
      ) : null}
    </Panel>
  );
}
