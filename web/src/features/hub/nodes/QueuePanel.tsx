// The payment queue at a glance: for each tier, what a block pays, how long one turn of the queue takes, what a node
// earns in a day at that pace (an estimate), and who is paid in the next block. It reads the store's per-tier stats and
// the announced next payees, so it is live and costs no request; the queue itself lives in its own window. Until the
// first stats arrive it draws the same cards with made-up numbers, so it has the size of the loaded one.

import { Coins } from 'lucide-react';
import { useMemo } from 'react';
import { useNetwork, useNextPayees } from '../../../app/context';
import { formatInt } from '../../../lib/format';
import { WINDOW_ICON } from '../../../shell/wm/glyphs';
import { TierGlyph, Unknown } from '../../../ui';
import { NodeLink } from '../../explorer/views/shared';
import { HubLink, HubPanel } from '..';
import { GHOST_QUEUE } from './lib/placeholders';
import { type QueueRow, queueRows } from './lib/queue';
import { Redact } from './Redact';
import './panels.css';

function QueueTier({ row }: { row: QueueRow }) {
  const next = row.next;
  return (
    <li className="nd-q__tier" data-tier={row.tier}>
      <div className="nd-q__top">
        <TierGlyph tier={row.tier} size={18} />
        <span className="nd-q__name">{row.name}</span>
        <span className="nd-q__nodes">{formatInt(row.nodes)} nodes</span>
      </div>
      <dl className="nd-q__figs">
        <div>
          <dt>Per block</dt>
          <dd>
            {row.payout ? (
              <>
                {row.payout} <small>FLUX</small>
              </>
            ) : (
              <Unknown />
            )}
          </dd>
        </div>
        <div>
          <dt>A turn takes</dt>
          <dd>{row.cycleText ?? <Unknown />}</dd>
        </div>
        <div title="An estimate: a block pays one node at a time, and a turn of the queue pays them all once">
          <dt>A day, estimated</dt>
          <dd>
            {row.perDayText === 'Unknown' ? (
              <Unknown />
            ) : (
              <>
                {row.perDayText} <small>FLUX</small>
              </>
            )}
          </dd>
        </div>
      </dl>
      <p className="nd-q__next">
        <span className="nd-q__label">Next</span>
        {next && (next.nodeId !== null || next.endpoint) ? (
          <NodeLink
            id={next.nodeId}
            fallbackEndpoint={next.endpoint}
            fallbackTier={row.tier}
            outpoint={next.outpoint}
            glyph={false}
          />
        ) : (
          <Unknown />
        )}
      </p>
    </li>
  );
}

function QueueList({ rows }: { rows: readonly QueueRow[] }) {
  return (
    <ul className="nd-q">
      {rows.map((r) => (
        <QueueTier key={r.tier} row={r} />
      ))}
    </ul>
  );
}

export function QueuePanel() {
  const stats = useNetwork((s) => s.tierStats);
  const next = useNextPayees();
  const rows = useMemo(() => queueRows(stats, next), [stats, next]);

  return (
    <HubPanel
      id="nd-queue"
      span="third"
      title="Payment queue"
      icon={WINDOW_ICON.queue ?? Coins}
      aside={next ? `Block ${formatInt(next.height)}` : undefined}
      aria-busy={rows.length === 0 || undefined}
      footer={
        <>
          <HubLink to={{ type: 'queue', key: null }}>Open the payment queue</HubLink>
          <span className="nd-foot-note">Every block pays one node in each tier, in turn</span>
        </>
      }
    >
      {rows.length === 0 ? (
        <Redact>
          <QueueList rows={GHOST_QUEUE} />
        </Redact>
      ) : (
        <QueueList rows={rows} />
      )}
    </HubPanel>
  );
}
