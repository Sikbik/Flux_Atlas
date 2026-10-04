// The latest blocks as a live list: height, age, what the block carried, its size and the node that made it. A new block
// slides in at the top with a wash that decays; each row is one link to its block, and the producer is its own link
// above it. It reads the store's ring of blocks, so it is live and costs no request.

import { Blocks } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useChainBlocks } from '../../../app/context';
import { formatBytes, formatEndpoint, formatInt } from '../../../lib/format';
import { useFresh } from '../../../motion';
import { ShellLink } from '../../../shell/frame/ShellLink';
import type { ChainBlock } from '../../../store/network';
import { EntityLink, RelativeTime, Skeleton, TierGlyph, Unknown } from '../../../ui';
import { mixSegments, txMix } from '../../chrome/rail';
import { HubLink, HubPanel } from '../../hub';
import { NodeLink, useNodeInfo } from '../views/shared';
import './landing.css';

const ROWS = 8;

/** The node that made a block: its tier, its address without the default port, and its city. */
function Producer({ id }: { id: number | null }) {
  const info = useNodeInfo(id);
  if (id === null) return <Unknown />;
  if (!info) return <NodeLink id={id} />;
  return (
    <span className="ex-blk__producer">
      <TierGlyph tier={info.tier} size={14} />
      <EntityLink kind="node" value={info.endpoint} mono>
        {formatEndpoint(info.endpoint, { hideDefaultPort: true })}
      </EntityLink>
      {info.city ? <span className="ex-blk__city">{info.city}</span> : null}
    </span>
  );
}

const BlockRow = memo(function BlockRow({ b, fresh }: { b: ChainBlock; fresh: boolean }) {
  const mix = useMemo(() => txMix(b), [b]);
  const segments = useMemo(() => mixSegments(mix), [mix]);
  return (
    <li className="ex-blk" data-fresh={fresh || undefined}>
      <span className="ex-blk__height">
        <ShellLink
          to={{ type: 'block', key: String(b.height) }}
          className="ex-blk__link"
          aria-label={`Block ${formatInt(b.height)}, ${formatInt(b.txCount)} transactions`}
        >
          {formatInt(b.height)}
        </ShellLink>
      </span>
      <span className="ex-blk__cell ex-blk__age" data-col="age">
        <span className="ui-sr-only">Mined: </span>
        <RelativeTime ts={b.timeMs} />
      </span>
      <span className="ex-blk__cell ex-blk__tx" data-col="tx">
        <span className="ui-sr-only">Transactions: </span>
        <span className="ex-mix" aria-hidden="true">
          {segments.map((s) => (
            <i key={s.key} data-mix={s.key} style={{ flexGrow: s.n }} />
          ))}
        </span>
        <span className="ex-blk__n">{formatInt(b.txCount)}</span>
      </span>
      <span className="ex-blk__cell ex-blk__size" data-col="size">
        <span className="ui-sr-only">Size: </span>
        {formatBytes(b.size)}
      </span>
      <span className="ex-blk__cell ex-blk__by" data-col="by">
        <span className="ui-sr-only">Made by: </span>
        <Producer id={b.producer} />
      </span>
    </li>
  );
});

function RowsSkeleton() {
  return (
    <div className="ex-blocks__skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed decoration
        <Skeleton key={i} h={34} radius={8} />
      ))}
    </div>
  );
}

export function LatestBlocksPanel() {
  const all = useChainBlocks();
  const rows = useMemo(() => all.slice(0, ROWS), [all]);
  const keys = useMemo(() => rows.map((b) => String(b.height)), [rows]);
  // A block that lands slides in; the first fill is history and a resync is not news.
  const fresh = useFresh(keys, { max: 2 });
  const newest = rows[0] ?? null;

  return (
    <HubPanel
      id="ex-blocks"
      span="twothirds"
      title="Latest blocks"
      icon={Blocks}
      aside="newest first"
      state={rows.length === 0 ? 'loading' : 'ready'}
      skeleton={<RowsSkeleton />}
      flush
      footer={
        newest ? (
          <>
            <HubLink to={{ type: 'block', key: String(newest.height) }}>Open the latest block</HubLink>
            <span className="ex-foot-note">One block about every 30 seconds</span>
          </>
        ) : undefined
      }
    >
      <div className="ex-blocks">
        <div className="ex-blocks__head" aria-hidden="true">
          <span>Block</span>
          <span>Mined</span>
          <span>Transactions</span>
          <span>Size</span>
          <span>Made by</span>
        </div>
        <ol className="ex-blocks__list" aria-label="Latest blocks, newest first">
          {rows.map((b) => (
            <BlockRow key={b.height} b={b} fresh={fresh.has(String(b.height))} />
          ))}
        </ol>
      </div>
    </HubPanel>
  );
}
