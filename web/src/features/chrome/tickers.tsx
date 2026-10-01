// Tickers (FEATURES section 2): the next payout of each tier in a sentence, and the reward-cut countdown
// with the split before and after. Both are small, reusable pieces: the status bar's hover cards, the
// aim strip's card and the views that want the same facts (Analytics' cut card, About Flux, ambient)
// render them. Everything shown as an estimate is marked as one.

import { useCallback } from 'react';
import { useRuntime } from '../../app/context';
import { formatDuration, formatHeight, formatInt, formatUtcDateTime } from '../../lib/format';
import { ShellLink } from '../../shell/frame/ShellLink';
import { usePayoutLines } from './data';
import { TIER_LABEL, TIER_ORDER, TierGlyph } from './glyphs';
import { amountLabel, payoutSentence } from './payouts';
import type { RewardCutView } from './rewardcut';
import './tickers.css';

/** The route key of a node (its endpoint, `ip:port`), or null when it is unknown. */
export function useNodeKey(): (node: number | null) => string | null {
  const { store } = useRuntime();
  return useCallback(
    (node: number | null) => {
      if (node === null) return null;
      const i = store.nodes.indexOf(node);
      if (i < 0) return null;
      const ep = store.nodes.endpoint(i);
      return ep || null;
    },
    [store],
  );
}

/** One sentence per tier: "Next Stratus payout: Helsinki, 9 FLUX, in ~12 s", each linking to the node. */
export function NextPayoutTicker({ className }: { className?: string }) {
  const lines = usePayoutLines();
  const keyOf = useNodeKey();
  if (lines.length === 0) return <p className="ticker-empty">Waiting for the next block</p>;
  return (
    <ul className={className ? `ticker ${className}` : 'ticker'}>
      {lines.map((l) => {
        const key = keyOf(l.node);
        const text = payoutSentence(l, TIER_LABEL[l.tier]);
        return (
          <li key={l.tier} className="ticker-row" data-tier={l.tier}>
            <TierGlyph tier={l.tier} size={14} />
            {key ? (
              <ShellLink to={{ type: 'node', key }} className="ticker-link">
                {text}
              </ShellLink>
            ) : (
              <span>{text}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The reward cut: when, how far, and what each output pays before and after. */
export function RewardCutCard({ cut }: { cut: RewardCutView }) {
  const rows = [
    ...TIER_ORDER.map((t) => ({
      key: t,
      label: TIER_LABEL[t],
      tier: t as string,
      before: cut.before[t],
      after: cut.after[t],
    })),
    { key: 'dev', label: 'Dev fund', tier: 'dev', before: cut.before.dev, after: cut.after.dev },
  ];
  return (
    <div className="cut-card">
      <span className="hc-title">Reward cut</span>
      <dl className="hc-rows">
        <dt>At block</dt>
        <dd className="mono">{formatHeight(cut.height)}</dd>
        <dt>Blocks to go</dt>
        <dd className="mono">{cut.landed ? 'Landed' : formatInt(cut.blocksLeft)}</dd>
        {cut.landed ? null : (
          <>
            <dt>About</dt>
            <dd>{formatDuration(cut.etaMs)} (estimate)</dd>
            <dt>Around</dt>
            <dd className="mono">{formatUtcDateTime(cut.atMs)}</dd>
          </>
        )}
      </dl>
      <div className="cut-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${cut.progress})` }} />
      </div>
      <p className="cut-note">
        {(cut.progress * 100).toFixed(1)} percent of the way from the start of Proof of Node
      </p>
      <table className="cut-table">
        <caption className="sr-only">Reward per block before and after the cut, in FLUX</caption>
        <thead>
          <tr>
            <th scope="col">Output</th>
            <th scope="col">Now</th>
            <th scope="col">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} data-tier={r.tier === 'dev' ? undefined : r.tier}>
              <th scope="row">
                {r.tier === 'dev' ? null : <TierGlyph tier={r.tier as 'stratus'} size={12} />} {r.label}
              </th>
              <td className="mono">{amountLabel(r.before)}</td>
              <td className="mono">{amountLabel(r.after)}</td>
            </tr>
          ))}
          <tr className="cut-total">
            <th scope="row">Total</th>
            <td className="mono">{amountLabel(cut.before.total)}</td>
            <td className="mono">{amountLabel(cut.after.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
