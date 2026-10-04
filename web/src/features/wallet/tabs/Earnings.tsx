// Earnings: what was paid (day by day, by tier, each day at its own price), whether it matches what the queues owed,
// and what the next year looks like at a price you choose, with the cost of hosting taken off.

import { Coins } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, EntityLink, Section } from '../../../ui';
import { useWalletCtx } from '../context';
import { scenarioFactor } from '../lib/projection';
import { Panel } from '../ui/Panel';
import type { Unit } from '../viz/DailyChart';
import { ExpectedReceived } from './earnings/ExpectedReceived';
import { ProfitPanel } from './earnings/ProfitPanel';
import { ProjectionPanel } from './earnings/ProjectionPanel';
import { Realized } from './earnings/Realized';
import { Scenario } from './earnings/Scenario';
import './earnings.css';

export function EarningsTab() {
  const { dto, money } = useWalletCtx();
  const [unit, setUnit] = useState<Unit>('flux');
  const [step, setStep] = useState(0);
  const factor = scenarioFactor(step);
  const price = money.price === null ? null : money.price * factor;

  // No node and no payment on record: there is nothing to chart, compare or project, and zeros say nothing.
  if (dto.nodes.length === 0 && dto.earnings.days.length === 0) {
    return (
      <div className="wl-page wl-earnings">
        <Panel title="Earnings" icon={Coins}>
          <EmptyState compact title="No node, so nothing is earned">
            Earnings are the payouts of the nodes paid to an address, and none is paid to this one.{' '}
            <EntityLink kind="address" value={dto.address}>
              Open the address in the explorer
            </EntityLink>
            .
          </EmptyState>
        </Panel>
      </div>
    );
  }

  return (
    <div className="wl-page wl-earnings">
      <Realized unit={unit} onUnit={setUnit} />
      <ExpectedReceived />
      {dto.nodes.length > 0 ? (
        <Section
          title="Looking ahead"
          aside="holds today's nodes and queues, and the reward cut that is scheduled"
          className="wl-ahead"
        >
          <div className="wl-page">
            <Scenario step={step} onStep={setStep} />
            <ProjectionPanel unit={unit} onUnit={setUnit} price={price} />
            <ProfitPanel price={price} factor={factor} />
          </div>
        </Section>
      ) : null}
    </div>
  );
}
