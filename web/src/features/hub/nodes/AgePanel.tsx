// How long the confirmed nodes have been running: the server's six age buckets, youngest first, as columns, and the
// nodes that do not say when they began as a hatched gray column beside them (never dropped, never zero). Every column
// has its count and share as text, and the panel says in a sentence which group is largest. While it loads, the panel
// draws the same columns with made-up counts, so it has the size of the loaded one.

import { CalendarClock } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { formatInt } from '../../../lib/format';
import { shareText } from '../../analytics/lib/concentration';
import { HubPanel, isFilling, type PanelState, useNodesOverview } from '..';
import { type AgeModel, ageModel } from './lib/age';
import { GHOST_AGE } from './lib/placeholders';
import { Redact, WaitAside } from './Redact';
import './bench.css';

function AgeColumns({ model }: { model: AgeModel }) {
  return (
    <div className="nd-age">
      <ol
        className="nd-age__cols"
        aria-label="Nodes by age, youngest first"
        style={{ '--n': model.bars.length } as CSSProperties}
      >
        {model.bars.map((b, i) => (
          <li
            key={b.id}
            className="nd-age__col"
            data-unknown={b.unknown || undefined}
            style={{ '--frac': b.frac, '--i': i } as CSSProperties}
            title={`${b.long}: ${formatInt(b.count)} nodes, ${shareText(b.share)}`}
          >
            <span className="nd-age__n">{formatInt(b.count)}</span>
            <span className="nd-age__bar" aria-hidden="true">
              <i />
            </span>
            <span className="nd-age__lab">
              <span aria-hidden="true">{b.label}</span>
              <span className="ui-sr-only">{`${b.long}, ${shareText(b.share)}`}</span>
            </span>
            <span className="nd-age__share" aria-hidden="true">
              {shareText(b.share)}
            </span>
          </li>
        ))}
      </ol>
      <p className="nd-age__reading">{model.reading}</p>
    </div>
  );
}

export function AgePanel() {
  const q = useNodesOverview();
  const model = useMemo(() => (q.data ? ageModel(q.data.age, q.data.age_unknown) : null), [q.data]);
  const loading = q.isPending;
  const waiting = loading && isFilling(q.failureReason);
  const state: PanelState = q.data ? (model ? 'ready' : 'empty') : loading ? 'ready' : 'error';

  return (
    <HubPanel
      id="nd-age"
      span="half"
      title="Node age"
      icon={CalendarClock}
      aside={
        model ? (
          `${formatInt(model.total)} confirmed nodes`
        ) : waiting ? (
          <WaitAside what="The ages" />
        ) : undefined
      }
      state={state}
      aria-busy={loading || undefined}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle="Could not load the ages"
      errorText="They are computed by this server from the node list; try again in a moment."
      emptyIcon={CalendarClock}
      emptyTitle="No ages yet"
      emptyText="The server has no confirmed nodes to age."
      footer={
        model && model.unknown > 0 ? (
          <span className="nd-foot-note">
            {`${formatInt(model.unknown)} ${model.unknown === 1 ? 'node does' : 'nodes do'} not say when ${model.unknown === 1 ? 'it' : 'they'} began`}
          </span>
        ) : (
          <span className="nd-foot-note">Counted from when each node was first confirmed</span>
        )
      }
    >
      {model ? (
        <AgeColumns model={model} />
      ) : loading ? (
        <Redact className="nd-age-redact">
          <AgeColumns model={GHOST_AGE} />
        </Redact>
      ) : null}
    </HubPanel>
  );
}
