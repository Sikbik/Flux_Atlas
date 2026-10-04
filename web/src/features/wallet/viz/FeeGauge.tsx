// The fee gauge: where a claim's fee sits against what is claimed, on a log scale from a thousandth of it to all of it.
// The advice changes at one percent (plainly worth it) and five (worth waiting on), and those are the stops the track is
// painted to; the marker is the chain's own fee share. It is a reading, so it stands still and only moves when the
// numbers do.

import type { CSSProperties } from 'react';
import { type ClaimVerdict, feeGaugePos, feeShareText, GAUGE_STOPS, verdictView } from '../lib/parallel';
import './gauge.css';

const pct = (v: number): string => `${(v * 100).toFixed(2)}%`;

export function FeeGauge({ share, verdict }: { share: number | null; verdict: ClaimVerdict }) {
  const pos = feeGaugePos(share);
  const view = verdictView(verdict);
  const label =
    share === null
      ? `Claim fee share: not applicable. ${view.label}.`
      : `Claim fee is ${feeShareText(share)} of the claim. ${view.label}.`;
  return (
    <div
      className="wl-gauge"
      role="img"
      aria-label={label}
      data-tone={view.tone}
      style={{ '--worth': pct(GAUGE_STOPS.worth), '--fair': pct(GAUGE_STOPS.fair) } as CSSProperties}
    >
      <span className="wl-gauge__track">
        {pos === null ? null : <i className="wl-gauge__marker" style={{ left: pct(pos) }} />}
      </span>
      <span className="wl-gauge__ticks" aria-hidden="true">
        <span style={{ left: '0%' }}>0.1%</span>
        <span style={{ left: pct(GAUGE_STOPS.worth) }}>1%</span>
        <span style={{ left: pct(GAUGE_STOPS.fair) }}>5%</span>
        <span style={{ left: '100%' }}>100%</span>
      </span>
    </div>
  );
}
