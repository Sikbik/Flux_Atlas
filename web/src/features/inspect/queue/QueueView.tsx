import { useNavigate, useRouterState } from '@tanstack/react-router';
import { CircleHelp, ListOrdered, WifiOff } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useConnection, useNetwork, useRuntime } from '../../../app/context';
import { EmptyState, EntityLink, Section, Skeleton } from '../../../ui';
import { positionOf, QUEUE_TIERS, type QueueTier } from '../derive/queue';
import { readNodeLive, useNodeLive, useQueues, useResolvedId, useTipAnchor } from '../sources/live';
import { type NodeHit, usePhaseLoop } from '../sources/queueFeed';
import { Callout } from '../ui/callout';
import { Fold } from '../ui/fold';
import { NodeFinder } from '../ui/NodeFinder';
import { useOpenSet } from '../ui/openset';
import { LaneRow } from './Belts';
import { TierCard } from './Cards';
import { QueueHeader, TIER_ORDER } from './Header';
import { NextInLine } from './NextInLine';
import './queue.css';

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

// ---- notes under the search -----------------------------------------------------------------------------

const NOT_QUEUED: Record<string, string> = {
  started: 'it is waiting for its first confirmation',
  dos: 'DoS listed nodes are skipped',
  offline: 'an offline node is skipped',
  expired: 'it is no longer paid',
  departed: 'it has left the network',
};

/** Said when the selected node is in no queue, so a selection that shows nothing on a ring is explained. */
function SelectionNote({ id }: { id: number }) {
  const queues = useQueues();
  const node = useNodeLive(id);
  if (!node || positionOf(queues, id)) return null;
  return (
    <p className="ix-q-note">
      <EntityLink kind="node" value={node.endpoint || String(node.id)}>
        {node.endpoint || `Node ${node.id}`}
      </EntityLink>{' '}
      is not in a payment queue: {NOT_QUEUED[node.status] ?? 'its place in line is not known yet'}.
    </p>
  );
}

/** Said while the live connection is down: the queue shown is the last one received. */
function LiveNote() {
  const { status } = useConnection();
  if (status !== 'reconnecting' && status !== 'offline' && status !== 'closed') return null;
  return (
    <Callout tone="warn" title="Not live right now" icon={<WifiOff size={16} strokeWidth={1.5} />}>
      Places and times are as of the last update. They refresh when the connection returns.
    </Callout>
  );
}

// ---- loading ----------------------------------------------------------------------------------------------

function QueueSkeleton({ tiers }: { tiers: readonly QueueTier[] }) {
  return (
    <article className="ix ix-queue" aria-busy="true" aria-label="Loading the payment queues">
      <div className="ix-skel-head">
        <Skeleton w={96} h={12} />
        <Skeleton w="52%" h={24} />
        <Skeleton w="68%" h={12} />
      </div>
      <div className="ix-pad ix-gap-top">
        <Skeleton h={30} radius="var(--r-md)" />
      </div>
      <Section>
        <div className="ix-q-wheels" data-n={tiers.length}>
          {tiers.map((t) => (
            <div className="ix-q-card" key={t} data-tier={t} data-solo={tiers.length === 1 || undefined}>
              <Skeleton className="ix-wheel-skel" />
              <div className="ix-q-foot">
                <Skeleton w="62%" h={12} />
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Next to be paid">
        <div className="ix-q-lanes">
          <Skeleton h={56} radius="var(--r-lg)" />
          <Skeleton h={56} radius="var(--r-lg)" />
          <Skeleton h={56} radius="var(--r-lg)" />
        </div>
      </Section>
    </article>
  );
}

// ---- the view -----------------------------------------------------------------------------------------------

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
  /** The tier a narrow window shows: the single tier of a focused view, else the one picked. */
  const current = focus ?? active;
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

  if (!loaded) return <QueueSkeleton tiers={shown} />;
  const empty = QUEUE_TIERS.every((t) => queues.tiers[t].size === 0);

  return (
    <article className="ix ix-queue" data-focus={focus ?? undefined} aria-label="Payment queues">
      <QueueHeader focus={focus} active={current} onActive={setActive} empty={empty} />
      <div className="ix-pad ix-gap-top ix-stack">
        <NodeFinder
          onPick={onPick}
          label="Find a node in the payment queues"
          placeholder="Find a node by IP, port or id"
        />
        {sel.id !== null ? <SelectionNote id={sel.id} /> : null}
        <LiveNote />
      </div>

      {empty ? (
        <Section>
          <EmptyState icon={ListOrdered} title="No payment queue yet" pattern>
            The queues appear once the node list, with each node&apos;s place in line, has arrived.
          </EmptyState>
        </Section>
      ) : (
        <>
          <Section>
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
                    active={current === t}
                    solo={focus !== null}
                  />
                ))}
              </div>
              {focus ? <NextInLine tier={focus} queue={queues.tiers[focus]} selectedId={sel.id} /> : null}
            </div>
          </Section>

          <Section title="Next to be paid" aside="moves one slot every block">
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
                  active={current === t}
                  ahead={focus ? 9 : 7}
                />
              ))}
            </div>
          </Section>
        </>
      )}

      <Fold id="how" open={open} icon={CircleHelp} title="How the queue works" summary="a strict rotation">
        <p className="ix-cap">
          Each block pays the node at the head of every tier&apos;s queue, and that node moves to the back, so
          a tier is a strict rotation: a node is paid once per cycle. Atlas follows the network&apos;s own
          ranks, moved on by every block, and checks the head against the network&apos;s next-payee
          announcement. Times are estimates at about 30 s per block; blocks can be a little early or late.
          Select a ring or a belt tile to follow a node.
        </p>
      </Fold>
    </article>
  );
}
