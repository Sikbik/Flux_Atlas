import { useNavigate, useRouterState } from '@tanstack/react-router';
import { ChevronRight, CircleHelp, X } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useNetwork, useRuntime } from '../../../app/context';
import { BLOCK_MS, formatFlux, formatInt } from '../../../lib/format';
import { countryName } from '../derive/appSpec';
import {
  cycleHours,
  estimatePayment,
  positionOf,
  QUEUE_TIERS,
  type QueueTier,
  type TierQueue,
} from '../derive/queue';
import {
  readNodeLive,
  useChainClock,
  useNodeLive,
  useQueues,
  useResolvedId,
  useTierInfo,
  useTipAnchor,
} from '../sources/live';
import {
  type NodeHit,
  type PhaseLoop,
  usePhaseLoop,
  useRecentPayees,
  useRiskFlags,
} from '../sources/queueFeed';
import {
  Digits,
  Disclosure,
  Disclosures,
  etaShort,
  NodeLink,
  QueueCell,
  QueueLink,
  TierGlyph,
  tierLabel,
  useOpenSet,
} from '../ui';
import { Lane } from './Lane';
import { NodeSearch } from './Search';
import { Wheel } from './Wheel';
import './queue.css';

const TIER_ORDER: readonly QueueTier[] = ['stratus', 'nimbus', 'cumulus'];

// ---- selection (the URL carries it, so a link shows the same node) --------------------------------------

function useSelection(): { id: number | null; set: (id: number | null) => void } {
  const store = useRuntime().store;
  const sel = useRouterState({ select: (s) => (s.location.search as { sel?: string }).sel });
  const navigate = useNavigate();
  const key = sel?.split(',')[0]?.trim() ?? '';
  const id = useResolvedId(key);
  const set = useCallback(
    (next: number | null) => {
      const endpoint = next !== null ? readNodeLive(store, next)?.endpoint || String(next) : undefined;
      void navigate({
        to: '.',
        replace: true,
        search: ((prev: Record<string, unknown>) => ({ ...prev, sel: endpoint })) as never,
      });
    },
    [navigate, store],
  );
  return { id: key ? id : null, set };
}

// ---- the block countdown ------------------------------------------------------------------------------

function BlockCountdown() {
  const { anchorMs, nowMs } = useChainClock();
  if (anchorMs === null) return <span className="ix-q-clock">Waiting for a block</span>;
  const since = Math.max(0, nowMs - anchorMs);
  const left = Math.max(0, BLOCK_MS - since);
  const late = since > BLOCK_MS + 5_000;
  return (
    <span className="ix-q-clock" data-late={late || undefined} role="status">
      <i className="ix-q-dot" aria-hidden="true" />
      {late ? (
        <>
          Block late by <Digits value={String(Math.round((since - BLOCK_MS) / 1000))} /> s
        </>
      ) : (
        <>
          Next block in <Digits value={String(Math.round(left / 1000))} /> s
        </>
      )}
    </span>
  );
}

// ---- one tier ------------------------------------------------------------------------------------------

/**
 * Two lines under a ring, fixed in height so nothing moves: what the tier pays and how long its cycle
 * is, or, when the selected node is in this tier, where that node stands and when it is paid.
 */
function CardFoot({
  tier,
  queue,
  selectedId,
  solo,
  onClear,
}: {
  tier: QueueTier;
  queue: TierQueue;
  selectedId: number | null;
  solo: boolean;
  onClear: () => void;
}) {
  const queues = useQueues();
  const { tip, anchorMs, nowMs } = useChainClock();
  const info = useTierInfo().find((t) => t.tier === tier);
  const pos = selectedId !== null ? positionOf(queues, selectedId) : null;
  const mine = pos && pos.tier === tier ? pos : null;
  const node = useNodeLive(mine ? selectedId : null);

  if (mine && node) {
    const est =
      tip !== null && anchorMs !== null
        ? estimatePayment(mine.position, mine.size, tip, anchorMs, nowMs)
        : null;
    return (
      <div className="ix-q-foot" data-selected="">
        <div className="ix-q-foot-1">
          <b className="ix-mono">#{formatInt(mine.position + 1)}</b>
          <span>of {formatInt(mine.size)}</span>
          <small>· paid in about</small>
          <b className="ix-mono">{est ? etaShort(est.etaMs) : 'Unknown'}</b>
        </div>
        <div className="ix-q-foot-2">
          <NodeLink nodeKey={node.endpoint || node.id} className="ix-mono" title="Open the node">
            {node.endpoint || `Node ${node.id}`}
          </NodeLink>
          <button type="button" className="ix-q-foot-x" aria-label="Clear the selection" onClick={onClear}>
            <X size={13} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="ix-q-foot">
      <div className="ix-q-foot-1">
        {info?.payout ? (
          <>
            <b className="ix-mono">{formatFlux(info.payout, { unit: false })}</b>
            <span>FLUX a block</span>
          </>
        ) : null}
        <small>
          · cycle <span className="ix-mono">{cycleHours(queue.size).toFixed(1)}</span> h
        </small>
      </div>
      <div className="ix-q-foot-2">
        {solo ? null : (
          <QueueLink tier={tier} className="ix-q-focus">
            Open the {tierLabel(tier)} ring
            <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
          </QueueLink>
        )}
      </div>
    </div>
  );
}

interface TierCardProps {
  tier: QueueTier;
  queue: TierQueue;
  tip: number | null;
  loop: PhaseLoop;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onClear: () => void;
  active: boolean;
  /** A single tier fills the window: a bigger ring. */
  solo: boolean;
}

const TierCard = memo(function TierCard({
  tier,
  queue,
  tip,
  loop,
  selectedId,
  onSelect,
  onClear,
  active,
  solo,
}: TierCardProps) {
  const { clock } = useRuntime();
  const risk = useRiskFlags(queue.ids);
  const queues = useQueues();
  const selected = selectedId !== null ? positionOf(queues, selectedId) : null;
  const selectedPos = selected && selected.tier === tier ? selected.position : null;
  const anchor = loop.anchorMs;
  const etaFor = useCallback(
    (position: number) =>
      anchor === null ? '' : `in ${etaShort(Math.max(0, anchor + (position + 1) * BLOCK_MS - clock.now()))}`,
    [anchor, clock],
  );
  return (
    <section
      className="ix-q-card"
      data-tier={tier}
      data-active={active || undefined}
      data-solo={solo || undefined}
    >
      <Wheel
        tier={tier}
        ids={queue.ids}
        size={queue.size}
        loop={loop}
        tip={tip}
        risk={risk}
        selected={selectedPos}
        onSelect={onSelect}
        etaFor={etaFor}
      >
        <span className="ix-wheel-name">{tierLabel(tier)}</span>
        <b className="ix-mono ix-wheel-n">
          <Digits value={formatInt(queue.size)} />
        </b>
        <span className="ix-wheel-cap">nodes in line</span>
      </Wheel>
      <CardFoot tier={tier} queue={queue} selectedId={selectedId} solo={solo} onClear={onClear} />
    </section>
  );
});

/** The belt of one tier with its second-by-second countdowns. */
function LaneRow({
  tier,
  queue,
  tip,
  loop,
  selectedId,
  onSelect,
  active,
  ahead,
}: {
  tier: QueueTier;
  queue: TierQueue;
  tip: number | null;
  loop: PhaseLoop;
  selectedId: number | null;
  onSelect: (id: number) => void;
  active: boolean;
  ahead?: number;
}) {
  const { nowMs } = useChainClock();
  const paid = useRecentPayees(tier, 4);
  return (
    <div className="ix-q-lane" data-tier={tier} data-active={active || undefined}>
      <div className="ix-q-lane-h">
        <span>{tierLabel(tier)}</span>
        <small>pays one node every block</small>
      </div>
      <Lane
        tier={tier}
        ids={queue.ids}
        size={queue.size}
        tip={tip}
        paid={paid}
        loop={loop}
        selectedId={selectedId}
        onSelect={onSelect}
        nowMs={nowMs}
        ahead={ahead}
      />
    </div>
  );
}

/** The next payees of one tier as a list: the belt's tiles with their place. */
function NextInLine({ tier, queue }: { tier: QueueTier; queue: TierQueue }) {
  const store = useRuntime().store;
  const rows = Array.from(queue.ids.slice(0, 8), (id) => readNodeLive(store, id)).filter(
    (n): n is NonNullable<ReturnType<typeof readNodeLive>> => n !== null,
  );
  return (
    <section className="ix-q-next" data-tier={tier} aria-label={`Next payees of ${tierLabel(tier)}`}>
      <h3 className="ix-q-next-h">
        Next in line <small>one per block</small>
      </h3>
      <ol className="ix-hrows">
        {rows.map((n) => (
          <li className="ix-hrow-cell" key={n.id}>
            <NodeLink nodeKey={n.endpoint || n.id} className="ix-hrow" data-tier={n.tier}>
              <span className="ix-hrow-glyph" aria-hidden="true">
                <TierGlyph tier={n.tier} size={16} />
              </span>
              <span className="ix-hrow-main">
                <b className="ix-mono ix-hrow-port">{n.endpoint}</b>
                <span className="ix-hrow-sub">{n.country ? countryName(n.country) : 'Unknown place'}</span>
              </span>
              <QueueCell id={n.id} />
              <ChevronRight className="ix-hrow-chev" size={15} strokeWidth={1.75} aria-hidden="true" />
            </NodeLink>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- the view -------------------------------------------------------------------------------------------

/**
 * The payment queues (`/queue`, `/queue/:tier`): one ring per tier with the payout gate at the top, the
 * node paid by the last block just behind it and the next payees in a belt that moves a slot every block.
 * Search or click any node to see its place in line and an estimate of when it is paid.
 */
export function QueueView({ tier }: { tier?: QueueTier }) {
  const queues = useQueues();
  const loaded = useNetwork((s) => s.loaded);
  const { tip } = useTipAnchor();
  const loop = usePhaseLoop();
  const sel = useSelection();
  const [active, setActive] = useState<QueueTier>(tier ?? 'stratus');
  const open = useOpenSet('queue');

  const focus = tier ?? null;
  const shown = focus ? [focus] : TIER_ORDER;
  const select = useCallback(
    (id: number) => {
      sel.set(id);
      const p = positionOf(queues, id);
      if (p) setActive(p.tier);
    },
    [sel, queues],
  );
  const clear = useCallback(() => sel.set(null), [sel]);
  const onPick = useCallback((h: NodeHit) => select(h.id), [select]);

  const empty = loaded && QUEUE_TIERS.every((t) => queues.tiers[t].size === 0);

  return (
    <article className="ix ix-queue" data-focus={focus ?? undefined} aria-label="Payment queues">
      <header className="ix-q-top">
        <NodeSearch onPick={onPick} />
        <BlockCountdown />
      </header>

      {focus ? (
        <nav className="ix-q-tiers" aria-label="Payment queue tiers">
          <QueueLink className="ix-q-tiers-b">All tiers</QueueLink>
          {TIER_ORDER.map((t) => (
            <QueueLink
              key={t}
              tier={t}
              className="ix-q-tiers-b"
              aria-current={t === focus ? 'page' : undefined}
              data-tier={t}
            >
              {tierLabel(t)}
            </QueueLink>
          ))}
        </nav>
      ) : (
        <div className="ix-q-switch" role="tablist" aria-label="Tier">
          {TIER_ORDER.map((t) => (
            <button
              type="button"
              role="tab"
              key={t}
              data-tier={t}
              aria-selected={active === t}
              className="ix-q-switch-b"
              onClick={() => setActive(t)}
            >
              {tierLabel(t)}
            </button>
          ))}
        </div>
      )}

      <div className="ix-q-main">
        <div className="ix-q-wheels" data-n={shown.length}>
          {shown.map((t) => (
            <TierCard
              key={t}
              tier={t}
              queue={queues.tiers[t]}
              tip={tip}
              loop={loop}
              selectedId={sel.id}
              onSelect={select}
              onClear={clear}
              active={active === t}
              solo={focus !== null}
            />
          ))}
        </div>
        {focus ? <NextInLine tier={focus} queue={queues.tiers[focus]} /> : null}
      </div>

      <div className="ix-q-lanes">
        {shown.map((t) => (
          <LaneRow
            key={t}
            tier={t}
            queue={queues.tiers[t]}
            tip={tip}
            loop={loop}
            selectedId={sel.id}
            onSelect={select}
            active={active === t}
            ahead={focus ? 9 : 7}
          />
        ))}
      </div>

      <Disclosures>
        <Disclosure
          index={4}
          title="How the queue works"
          icon={<CircleHelp size={15} strokeWidth={1.75} />}
          summary={<span>One node per tier is paid every block, then goes to the back</span>}
          open={open.isOpen('how')}
          onToggle={(v) => open.setOpen('how', v)}
        >
          <p className="ix-cap">
            Each block pays the node at the head of every tier&apos;s queue, and that node moves to the back,
            so a tier is a strict rotation: a node is paid once per cycle. Atlas rebuilds the order from the
            network&apos;s ranks and each node&apos;s last payment, and corrects the head with the
            network&apos;s own next-payee announcement. Times are estimates at about 30 s per block; blocks
            can be a little early or late. Click a ring or a belt tile to follow a node.
          </p>
          {empty ? <p className="ix-cap">No queue data has arrived yet.</p> : null}
        </Disclosure>
      </Disclosures>
    </article>
  );
}
