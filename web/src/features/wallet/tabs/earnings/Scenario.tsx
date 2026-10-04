// The price scenario: one control for everything that looks ahead (the projection and the profit). It slides from a
// tenth to ten times today's price on a log scale, so doubling and halving are the same distance, and a few presets
// jump to the multiples people ask about.

import { RotateCcw } from 'lucide-react';
import { Chip, IconButton, Slider } from '../../../../ui';
import { useWalletCtx } from '../../context';
import { formatPrice } from '../../lib/money';
import {
  factorText,
  SCENARIO_MAX,
  SCENARIO_MIN,
  SCENARIO_PRESETS,
  scenarioFactor,
  scenarioStep,
} from '../../lib/projection';

export interface ScenarioProps {
  step: number;
  onStep: (step: number) => void;
}

export function Scenario({ step, onStep }: ScenarioProps) {
  const { money } = useWalletCtx();
  const factor = scenarioFactor(step);
  const noPrice = money.price === null;
  const price = money.price === null ? null : money.price * factor;
  const near = (target: number) => Math.abs(factor - target) < 0.06 * target;

  return (
    <div className="wl-scenario">
      <div className="wl-scenario__head">
        <span className="wl-sub">Price scenario</span>
        <span className="wl-scenario__price ui-mono" aria-live="polite">
          {noPrice ? 'Prices unavailable' : `${formatPrice(price, money.currency)} per FLUX`}
          {noPrice ? null : <i>{factorText(factor)}</i>}
        </span>
      </div>
      <Slider
        aria-label="Price scenario, as a multiple of today's price"
        min={SCENARIO_MIN}
        max={SCENARIO_MAX}
        step={1}
        value={step}
        onChange={onStep}
        disabled={noPrice}
        hideValue
        valueText={(s) => `${factorText(scenarioFactor(s))} today's price`}
        marks={[
          { value: SCENARIO_MIN, label: '0.1x' },
          { value: 0, label: 'Today' },
          { value: SCENARIO_MAX, label: '10x' },
        ]}
      />
      <fieldset className="wl-scenario__presets">
        <legend className="ui-sr-only">Price presets</legend>
        {noPrice
          ? null
          : SCENARIO_PRESETS.map((p) => (
              <Chip
                key={p.label}
                size="sm"
                tone={near(p.factor) ? 'accent' : 'neutral'}
                selected={near(p.factor)}
                onClick={() => onStep(scenarioStep(p.factor))}
              >
                {p.label}
              </Chip>
            ))}
        <IconButton
          size="sm"
          variant="ghost"
          icon={RotateCcw}
          label="Back to today's price"
          disabled={step === 0}
          onClick={() => onStep(0)}
        />
      </fieldset>
      <p className="wl-note">
        Moves every figure below that is worth money. What was already paid stays at the price of the day it
        was paid.
      </p>
    </div>
  );
}
