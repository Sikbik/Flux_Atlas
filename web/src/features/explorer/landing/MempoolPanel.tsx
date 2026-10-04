// The mempool now: how many transactions wait, drawn as a pool with a cell for each (node check-ins quiet, value moving
// lit), what the value moving adds up to, and the longest wait. Live from the socket; the pool is flushed at every block.

import { Layers2 } from 'lucide-react';
import { useMemo } from 'react';
import { useRuntime } from '../../../app/context';
import { formatAge, formatInt, parseFlux } from '../../../lib/format';
import { useNow } from '../../../lib/useClock';
import { AnimatedNumber, formatAmountText, Skeleton } from '../../../ui';
import { HubLink, HubPanel } from '../../hub';
import { useMempoolLive } from '../hooks/useMempoolLive';
import { isCheckin } from '../lib/txkinds';
import './landing.css';

/** The most cells the pool draws; the rest are counted. */
const CELLS = 96;

export function MempoolPanel() {
  const m = useMempoolLive();
  const { clock } = useRuntime();
  const now = useNow(clock);

  const { cells, checkins, valueTxs, waiting, oldest } = useMemo(() => {
    let w = 0n;
    let value = 0;
    let check = 0;
    let first: number | null = null;
    const ordered: { id: string; check: boolean }[] = [];
    // Oldest first, so a cell stays where it is while the pool fills.
    for (let i = m.rows.length - 1; i >= 0; i--) {
      const r = m.rows[i];
      if (!r) continue;
      const c = isCheckin(r.tx.kind, r.tx.value);
      if (c) check++;
      else {
        value++;
        w += parseFlux(r.tx.value) ?? 0n;
      }
      if (r.firstSeenMs !== null && (first === null || r.firstSeenMs < first)) first = r.firstSeenMs;
      if (ordered.length < CELLS) ordered.push({ id: r.tx.txid, check: c });
    }
    return { cells: ordered, checkins: check, valueTxs: value, waiting: w, oldest: first };
  }, [m.rows]);

  const state =
    m.isPending && m.rows.length === 0 ? 'loading' : m.isError && m.rows.length === 0 ? 'error' : 'ready';
  const more = Math.max(0, m.rows.length - cells.length);
  const wait = oldest === null ? null : Math.max(0, now - oldest);

  return (
    <HubPanel
      id="ex-mempool"
      span="third"
      fill="row"
      title="Mempool now"
      icon={Layers2}
      aside="live"
      state={state}
      error={m.error}
      onRetry={() => void m.refetch()}
      errorTitle="Could not load the mempool"
      errorText="The pending list comes from this server; try again in a moment."
      skeleton={
        <div className="ex-pool__skeleton" aria-hidden="true">
          <Skeleton w="42%" h={34} radius={8} />
          <Skeleton h={92} radius={8} />
          <Skeleton w="70%" h={12} />
        </div>
      }
      footer={<HubLink to={{ type: 'mempool', key: null }}>Open the mempool</HubLink>}
    >
      <div className="ex-pool">
        <div className="ex-pool__count">
          <span className="ex-pool__n">
            <AnimatedNumber value={m.size} />
          </span>
          <span className="ex-pool__label">
            {m.size === 1 ? 'transaction waiting' : 'transactions waiting'}
          </span>
        </div>

        <div
          className="ex-pool__cells"
          role="img"
          aria-label={`${formatInt(checkins)} node check-ins and ${formatInt(valueTxs)} transactions moving value are waiting for the next block`}
        >
          {cells.map((c) => (
            <i key={c.id} data-kind={c.check ? 'check' : 'value'} />
          ))}
          {more > 0 ? <span className="ex-pool__more">{`+${formatInt(more)}`}</span> : null}
          {m.rows.length === 0 ? (
            <span className="ex-pool__idle">
              Empty. The next transaction appears the moment the network sees it.
            </span>
          ) : null}
        </div>

        <ul className="ex-pool__key" aria-label="Colours">
          <li>
            <i data-kind="check" aria-hidden="true" />
            Node check-ins <b>{formatInt(checkins)}</b>
          </li>
          <li>
            <i data-kind="value" aria-hidden="true" />
            Value moving <b>{formatInt(valueTxs)}</b>
          </li>
        </ul>

        <dl className="ex-pool__facts">
          <div>
            <dt>Value waiting</dt>
            <dd>
              {formatAmountText(waiting, { decimals: waiting >= 100_000_000_000n ? 0 : 2 }) ?? 'Unknown'}{' '}
              <span className="ex-pool__unit">FLUX</span>
            </dd>
          </div>
          <div>
            <dt>Longest wait</dt>
            <dd>{wait === null ? <span className="ui-unknown">Not seen yet</span> : formatAge(wait)}</dd>
          </div>
        </dl>
      </div>
    </HubPanel>
  );
}
