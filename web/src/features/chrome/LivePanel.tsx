// The Live sheet's content (design 3.6): everything the desktop spreads over the Pulse card, the block rail and the
// status bar, in one scroll. The latest block with the beat and what is waiting for the next one; the next payout,
// one row per tier; the recent blocks (the rail, condensed to a strip); the Pulse; and the network's totals with the
// price, the reward cut and how fresh the data is (the status bar, condensed). Every number is the desktop's
// number from the same hooks, and every row is a link.

import {
  useChainBlocks,
  useMempoolEntries,
  useNetwork,
  usePrice,
  useRuntime,
  useSummary,
} from '../../app/context';
import { formatBytes, formatDuration, formatHeight, UNKNOWN } from '../../lib/format';
import { useAgo, useBeat, useNow } from '../../lib/useClock';
import { ShellLink } from '../../shell/frame/ShellLink';
import { AnimatedNumber, LiveDot, TierGlyph } from '../../ui';
import { BeatRing, UtcClock, useBeatView } from './Beat';
import { useNodeKey, usePayoutLines, useRewardCut } from './data';
import { readPaths, worstState } from './freshness';
import { TIER_LABEL, TIER_ORDER } from './glyphs';
import { PulseCard, usePulsePrefs } from './Pulse';
import { amountLabel } from './payouts';
import { mempoolWeight, waitingText } from './rail';
import { formatPrice } from './usd';
import './livepanel.css';

export function LivePanel() {
  const pulseOn = usePulsePrefs((s) => s.enabled);
  return (
    <div className="lp">
      <LatestBlock />
      <NextPayout />
      <RecentBlocks />
      {pulseOn ? (
        <section className="lp-pulse" aria-label="Pulse">
          <PulseCard mode="full" />
        </section>
      ) : null}
      <Network />
    </div>
  );
}

/** The newest block with the ring that counts to the next one, and what is waiting to go into it. */
function LatestBlock() {
  const { height, sub, phase, since } = useBeatView();
  const weight = mempoolWeight(useMempoolEntries());
  const waiting = weight.count > 0 ? ` · ${waitingText(weight, formatBytes)} waiting` : '';
  const body = (
    <>
      <span className="lp-ring">
        <BeatRing height={height} since={since} phase={phase} />
      </span>
      <span className="lp-block-text">
        <small>Latest block</small>
        <b>
          {height === null ? (
            'No block yet'
          ) : (
            <AnimatedNumber value={height} format={formatHeight} font="display" maxHz={0} />
          )}
        </b>
        <span className="lp-line" data-phase={phase}>
          {sub}
          {waiting}
        </span>
      </span>
    </>
  );
  return (
    <section className="lp-card lp-block" aria-label="Latest block">
      {height === null ? (
        <div className="lp-block-link">{body}</div>
      ) : (
        <ShellLink to={{ type: 'block', key: String(height) }} className="lp-block-link">
          {body}
        </ShellLink>
      )}
    </section>
  );
}

/** Who is paid in the next block, one row per tier, Stratus first (the aim strip's chips, in full). */
function NextPayout() {
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  const lines = usePayoutLines();
  const keyOf = useNodeKey();
  const secs = Math.max(0, Math.ceil(beat.remainingMs / 1000));
  return (
    <section className="lp-card" aria-labelledby="lp-payout">
      <h3 id="lp-payout">Next payout</h3>
      <p className="lp-sub">
        {beat.height === null ? (
          'Waiting for the next block'
        ) : (
          <>
            Known one block ahead, paid in <b>{secs} s</b>
          </>
        )}
      </p>
      <ul className="lp-rows">
        {lines.length === 0 ? (
          <li className="lp-empty">The payees show when the next block is known.</li>
        ) : (
          lines.map((l) => {
            const nodeKey = keyOf(l.node);
            const body = (
              <>
                <TierGlyph tier={l.tier} size={18} label={`${TIER_LABEL[l.tier]} tier`} />
                <span className="lp-main">
                  <span className="lp-name">
                    <b>{l.place ?? UNKNOWN}</b> {TIER_LABEL[l.tier]}
                  </span>
                  <small>{nodeKey ?? 'address not on the map'}</small>
                </span>
                <i>+{amountLabel(l.amount)}</i>
              </>
            );
            return (
              <li key={`${l.tier}:${l.node ?? l.address}`} data-tier={l.tier}>
                {nodeKey ? (
                  <ShellLink to={{ type: 'node', key: nodeKey }} className="lp-row">
                    {body}
                  </ShellLink>
                ) : (
                  <div className="lp-row">{body}</div>
                )}
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}

/** The latest blocks as a strip, newest first (the rail, condensed). */
function RecentBlocks() {
  const blocks = useChainBlocks();
  if (blocks.length === 0) return null;
  return (
    <section className="lp-recent" aria-labelledby="lp-recent">
      <h3 id="lp-recent">Recent blocks</h3>
      <ol className="lp-blocks">
        {blocks.slice(0, 10).map((b) => (
          <li key={`${b.height}:${b.hash.slice(0, 8)}`}>
            <ShellLink to={{ type: 'block', key: String(b.height) }} className="lp-bchip">
              <b>{formatHeight(b.height)}</b>
              <BlockAge ts={b.timeMs} txCount={b.txCount} />
            </ShellLink>
          </li>
        ))}
      </ol>
    </section>
  );
}

function BlockAge({ ts, txCount }: { ts: number; txCount: number }) {
  const { clock } = useRuntime();
  const ago = useAgo(clock, ts);
  return (
    <small>
      {ago ?? UNKNOWN} {'·'} {txCount} tx
    </small>
  );
}

/** The status bar, condensed: the tiers' node counts, the price, the reward cut, the clock and the data's age. */
function Network() {
  const { clock, store } = useRuntime();
  const now = useNow(clock);
  const summary = useSummary();
  const price = usePrice();
  const cut = useRewardCut();
  const jobs = useNetwork((s) => s.freshness);
  const tiers = summary?.tiers;
  const readings = readPaths({
    nowMs: now,
    jobs,
    lastMessage: store.lastMessageMs,
    tipAnchorMs: clock.lastBlockInfo?.anchorMs ?? null,
  });
  const worst = worstState(readings);
  const behind = readings.filter((r) => r.state === 'stale' || r.state === 'dead').map((r) => r.label);
  const tone =
    worst === 'fresh' ? 'ok' : worst === 'aging' ? 'pending' : worst === 'unknown' ? 'off' : 'warn';
  return (
    <section className="lp-card lp-net" aria-labelledby="lp-net">
      <h3 id="lp-net">Network</h3>
      <p className="lp-tiers">
        {TIER_ORDER.map((t) => (
          <span key={t} className="lp-tier" data-tier={t}>
            <TierGlyph tier={t} size={14} label={`${TIER_LABEL[t]} nodes`} />
            <b>
              <AnimatedNumber value={tiers ? tiers[t] : null} font="mono" />
            </b>
            <small>{TIER_LABEL[t]}</small>
          </span>
        ))}
      </p>
      <dl className="lp-facts">
        <div>
          <dt>Nodes</dt>
          <dd>
            <AnimatedNumber value={summary?.node_count ?? null} font="mono" />
          </dd>
        </div>
        {price ? (
          <div>
            <dt>FLUX price</dt>
            <dd>{formatPrice(price.usd)}</dd>
          </div>
        ) : null}
        {cut ? (
          <div>
            <dt>Reward cut</dt>
            <dd>{cut.landed ? 'landed' : `in ${formatDuration(cut.etaMs)}`}</dd>
          </div>
        ) : null}
        <div>
          <dt>Data</dt>
          <dd className="lp-data">
            <LiveDot status={tone} />
            {behind.length > 0 ? `${behind.join(', ')} behind` : worst === 'unknown' ? UNKNOWN : 'fresh'}
          </dd>
        </div>
        <div>
          <dt>Clock</dt>
          <dd>
            <UtcClock />
          </dd>
        </div>
      </dl>
    </section>
  );
}
