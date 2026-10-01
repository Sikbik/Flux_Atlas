import { useNavigate } from '@tanstack/react-router';
import { ListOrdered } from 'lucide-react';
import { useCallback } from 'react';
import { BLOCK_MS } from '../../../lib/format';
import { AnimatedNumber, Chip, LiveDot, SegmentedControl, tierLabel, ViewHeader } from '../../../ui';
import type { QueueTier } from '../derive/queue';
import { useChainClock } from '../sources/live';

/** The order the tiers are shown in: the biggest payout first. */
export const TIER_ORDER: readonly QueueTier[] = ['stratus', 'nimbus', 'cumulus'];

/**
 * How long until the next block, counting down in seconds; once a block is more than five seconds late it
 * counts how late instead. A timer (never read out per tick), re-rendered once a second on its own.
 */
export function BlockClock() {
  const { anchorMs, nowMs } = useChainClock();
  if (anchorMs === null) {
    return (
      <Chip size="lg" className="ix-q-clock">
        Waiting for a block
      </Chip>
    );
  }
  const since = Math.max(0, nowMs - anchorMs);
  const late = since > BLOCK_MS + 5_000;
  const secs = Math.round((late ? since - BLOCK_MS : Math.max(0, BLOCK_MS - since)) / 1000);
  return (
    <Chip size="lg" className="ix-q-clock" role="timer" data-late={late || undefined}>
      <LiveDot status={late ? 'warn' : 'ok'} ping={false} size={7} />
      {/* One run of text, so the chip's gap sits between the dot and the words, not inside the sentence. */}
      <span>
        {late ? 'Block late by' : 'Next block in'} <AnimatedNumber value={secs} roll={false} font="mono" /> s
      </span>
    </Chip>
  );
}

type TierChoice = 'all' | QueueTier;

/** The tier chooser of a single-tier view: all tiers, or one ring. Each choice is a URL, so a link keeps it. */
function TierControl({ focus }: { focus: QueueTier | null }) {
  const navigate = useNavigate();
  const go = useCallback(
    (v: TierChoice) => {
      // `search: true` keeps the rest of the URL (the selected node, camera, layers).
      if (v === 'all') void navigate({ to: '/queue', search: true as never });
      else void navigate({ to: '/queue/$tier', params: { tier: v }, search: true as never });
    },
    [navigate],
  );
  return (
    <SegmentedControl<TierChoice>
      size="sm"
      fullWidth
      aria-label="Payment queue tier"
      options={[
        { value: 'all', label: 'All tiers' },
        ...TIER_ORDER.map((t) => ({ value: t, label: tierLabel(t) })),
      ]}
      value={focus ?? 'all'}
      onChange={go}
    />
  );
}

/** On a narrow window the three rings are shown one at a time: this picks which. */
function ActiveTierControl({ active, onActive }: { active: QueueTier; onActive: (t: QueueTier) => void }) {
  return (
    <SegmentedControl<QueueTier>
      className="ix-q-switch"
      size="sm"
      fullWidth
      aria-label="Tier shown"
      options={TIER_ORDER.map((t) => ({ value: t, label: tierLabel(t) }))}
      value={active}
      onChange={onActive}
    />
  );
}

export function QueueHeader({
  focus,
  active,
  onActive,
  empty = false,
}: {
  focus: QueueTier | null;
  active: QueueTier;
  onActive: (t: QueueTier) => void;
  /** No queue is known yet: there is no ring to pick, so the picker of the all-tiers view is left out. */
  empty?: boolean;
}) {
  return (
    <ViewHeader
      kind="Payments"
      icon={ListOrdered}
      title={focus ? `${tierLabel(focus)} queue` : 'Payment queues'}
      subtitle="One node per tier is paid every block, then goes to the back."
      freshness={<BlockClock />}
      tier={focus ?? undefined}
    >
      {focus ? (
        <TierControl focus={focus} />
      ) : empty ? null : (
        <ActiveTierControl active={active} onActive={onActive} />
      )}
    </ViewHeader>
  );
}
