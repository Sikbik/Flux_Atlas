// The rich list on the landing, as a card of its own: how concentrated the supply is (a ring cut at the ranks the rich
// list page uses), the five largest addresses with what is known about them, and who moved over the last week. It is
// the way into the rich list page, which is where the whole ranking lives. With no ranking at all (the server has not
// built it yet) the card is left out; with a copy that is not fresh it says so, quietly.

import { ListOrdered } from 'lucide-react';
import { type CSSProperties, useMemo, useState } from 'react';
import type { RichMoversWindow } from '../../../api/generated/RichMoversWindow';
import { useRichList } from '../../../api/queries';
import { formatCompact, formatInt, shortAddress } from '../../../lib/format';
import { Chip, RelativeTime, Skeleton } from '../../../ui';
import { HubLink, HubPanel, LbBar, Leaderboard } from '../../hub';
import { formatShare } from '../lib/richlist';
import { DEFAULT_MOVERS_WINDOW, isRichListStale, useRichMovers } from './api';
import { type Holder, type HolderGlance, holderGlance, RING, ringSummary } from './lib/holders';
import { MoversBlock } from './MoversBlock';
import { StaleNote } from './StaleNote';
import './holders.css';
import './landing.css';

function HolderRing({ glance }: { glance: HolderGlance }) {
  const [hot, setHot] = useState<string | null>(null);
  const size = RING.size;
  const mid = (RING.r0 + RING.r1) / 2;
  const shown = glance.slices.find((s) => s.key === hot) ?? null;
  const held = shown ? shown.share : glance.top10;
  return (
    <div className="ex-ring" onPointerLeave={() => setHot(null)}>
      <div className="ex-ring__plot">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={ringSummary(glance)}
          className="ex-ring__svg"
        >
          <circle
            className="ex-ring__track"
            cx={size / 2}
            cy={size / 2}
            r={mid}
            fill="none"
            strokeWidth={RING.r1 - RING.r0}
          />
          {glance.slices.map((s, i) => (
            <path
              key={s.key}
              className="ex-ring__slice"
              d={s.d}
              fill={s.color}
              data-hot={hot === s.key || undefined}
              data-dim={(hot !== null && hot !== s.key) || undefined}
              style={{ '--i': i } as CSSProperties}
              onPointerEnter={() => setHot(s.key)}
            />
          ))}
        </svg>
        <div className="ex-ring__center" aria-hidden="true">
          <span className="ex-ring__figure">
            {held.toFixed(1)}
            <small>%</small>
          </span>
          <span className="ex-ring__caption">{shown ? shown.label : 'held by the top 10'}</span>
        </div>
      </div>
      <ul className="ex-ring__legend" aria-label="Share of the supply by rank">
        {glance.slices.map((s) => (
          <li key={s.key} data-hot={hot === s.key || undefined} onPointerEnter={() => setHot(s.key)}>
            <i style={{ background: s.color }} aria-hidden="true" />
            <span className="ex-ring__name">
              {s.label}
              {s.holders > 1 ? (
                <span className="ex-ring__holders">{`${formatInt(s.holders)} addresses`}</span>
              ) : null}
            </span>
            <span className="ex-ring__share">{formatShare(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Holders({ top }: { top: readonly Holder[] }) {
  const max = top.reduce((m, h) => Math.max(m, h.share), 0);
  return (
    <Leaderboard
      label="The five largest addresses"
      rows={top}
      rowKey={(h) => h.address}
      rank={(h) => h.rank}
      to={(h) => ({ type: 'address', key: h.address })}
      linkLabel={(h) =>
        `Open address ${shortAddress(h.address)}${h.entity ? `, the ${h.entity.label.toLowerCase()}` : ''}`
      }
      identity={(h) => (
        <>
          <span className="ex-addr">{shortAddress(h.address)}</span>
          {h.entity ? (
            <Chip size="sm" tone="accent" title={h.entity.note}>
              {h.entity.label}
            </Chip>
          ) : null}
        </>
      )}
      columns={[
        {
          id: 'share',
          header: 'Share',
          width: 'minmax(96px, 1fr)',
          cell: (h) => <LbBar value={h.share} max={max} text={formatShare(h.share)} />,
        },
        {
          id: 'balance',
          header: 'Balance',
          width: '84px',
          align: 'end',
          cell: (h) => <span className="ex-num">{`${formatCompact(h.flux)} FLUX`}</span>,
        },
        {
          id: 'nodes',
          header: 'Nodes',
          width: '52px',
          align: 'end',
          hide: 'compact',
          cell: (h) => <span className="ex-num">{h.nodes === 0 ? '' : formatInt(h.nodes)}</span>,
        },
      ]}
    />
  );
}

function RichSkeleton() {
  return (
    <div className="ex-rich ex-rich--skeleton" aria-hidden="true">
      <Skeleton h={220} radius={110} w={220} />
      <div className="ex-rich__skel-col">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed decoration
          <Skeleton key={i} h={36} radius={8} />
        ))}
      </div>
      <div className="ex-rich__skel-col">
        <Skeleton w="50%" h={12} />
        <Skeleton h={30} radius={8} />
        <Skeleton h={30} radius={8} />
        <Skeleton h={30} radius={8} />
      </div>
    </div>
  );
}

export function RichListPanel() {
  const q = useRichList();
  const [win, setWin] = useState<RichMoversWindow>(DEFAULT_MOVERS_WINDOW);
  const movers = useRichMovers(win);
  const entries = q.data?.entries;
  const glance = useMemo(() => (entries ? holderGlance(entries, 5) : null), [entries]);
  const stale = isRichListStale(q.data);

  // The ranking is empty only before the server has built it; the rich list page says so, the landing leaves it out.
  if (q.data && entries?.length === 0) return null;

  const state = q.isPending ? 'loading' : !glance ? 'error' : 'ready';

  return (
    <HubPanel
      id="ex-rich"
      span="full"
      title="Who holds the supply"
      icon={ListOrdered}
      aside={
        q.data ? (
          <span>
            Updated <RelativeTime ts={q.data.updated_ms} />
          </span>
        ) : undefined
      }
      state={state}
      skeleton={<RichSkeleton />}
      error={q.error}
      onRetry={() => void q.refetch()}
      retrying={q.isFetching}
      errorTitle="Could not load the rich list"
      errorText="The ranking is built by this server from the chain; try again in a moment."
      footer={
        <>
          <HubLink to={{ type: 'richlist', key: null }}>Open the rich list</HubLink>
          {glance ? (
            <span className="ex-foot-note">{`${formatInt(glance.listed)} addresses ranked; locked node collateral is counted`}</span>
          ) : null}
        </>
      }
    >
      {glance ? (
        <>
          {stale && q.data ? <StaleNote what="ranking" ts={q.data.updated_ms} /> : null}
          <div className="ex-rich">
            <HolderRing glance={glance} />
            <div className="ex-rich__top">
              <h3 className="ex-rich__h">Largest addresses</h3>
              <Holders top={glance.top} />
            </div>
            <MoversBlock query={movers} window={win} onWindow={setWin} variant="card" />
          </div>
        </>
      ) : null}
    </HubPanel>
  );
}
