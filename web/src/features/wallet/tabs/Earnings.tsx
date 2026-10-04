// Earnings: what was paid (day by day, by tier, each day at its own price), whether it matches what the queues owed,
// and what the next year looks like at a price you choose, with the cost of hosting taken off.

import { useState } from 'react';
import { Section } from '../../../ui';
import { useWalletCtx } from '../context';
import { scenarioFactor } from '../lib/projection';
import type { Unit } from '../viz/DailyChart';
import { ExpectedReceived } from './earnings/ExpectedReceived';
import { ProfitPanel } from './earnings/ProfitPanel';
import { ProjectionPanel } from './earnings/ProjectionPanel';
import { Realized } from './earnings/Realized';
import { Scenario } from './earnings/Scenario';
import './earnings.css';

export function EarningsTab() {
  const { money } = useWalletCtx();
  const [unit, setUnit] = useState<Unit>('flux');
  const [step, setStep] = useState(0);
  const factor = scenarioFactor(step);
  const price = money.price === null ? null : money.price * factor;

  return (
    <div className="wl-page wl-earnings">
      <Realized unit={unit} onUnit={setUnit} />
      <ExpectedReceived />
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
    </div>
  );
}
