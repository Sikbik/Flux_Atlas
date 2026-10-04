// Overview: the wallet in one screen. Who it is (standing), what it earns at the current pace, when each node is
// next paid, how the fleet is doing, what the last month paid and what is waiting in parallel assets. Every block
// ends in the tab that goes deeper.

import { EarningsGlance } from './overview/EarningsGlance';
import { FleetHealth } from './overview/FleetHealth';
import { NextPayouts } from './overview/NextPayouts';
import { ParallelStrip } from './overview/ParallelStrip';
import { RunRate } from './overview/RunRate';
import { Standing } from './overview/Standing';
import './overview.css';

export function OverviewTab() {
  return (
    <div className="wl-page wl-overview">
      <div className="wl-top">
        <Standing />
        <RunRate />
      </div>
      <NextPayouts />
      <div className="wl-duo">
        <FleetHealth />
        <div className="wl-stack">
          <EarningsGlance />
          <ParallelStrip />
        </div>
      </div>
    </div>
  );
}
