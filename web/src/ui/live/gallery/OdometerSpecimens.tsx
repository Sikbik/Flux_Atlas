import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useNetwork, usePrice, useSummary, useTip } from '../../../app/context';
import { formatInt, formatPercent } from '../../../lib/format';
import { Button } from '../../controls/Button';
import { useKitNow } from '../../internal/clock';
import { Stat } from '../../readout/Stat';
import { AnimatedNumber } from '../AnimatedNumber';
import { DemoTag, Tile } from './parts';
import './specimens.css';

/** Real values from the live store, each in a real Stat tile. */
export function OdometerLive() {
  const tip = useTip();
  const summary = useSummary();
  const mempool = useNetwork((s) => (s.loaded ? s.mempool.size : null));
  return (
    <div className="kg-live-stack">
      <Stat
        label="Chain tip"
        value={<AnimatedNumber value={tip?.height} />}
        caption="Live: a new block rolls the last digit"
      />
      <div className="kg-live-split">
        <Stat
          label="Nodes"
          value={<AnimatedNumber value={summary?.node_count} />}
          caption="Live: useSummary()"
        />
        <Stat
          label="Mempool"
          value={<AnimatedNumber value={mempool} />}
          caption="Live: transactions waiting"
        />
      </div>
    </div>
  );
}

/** A synthetic value with demo controls, so the roll, the tint and the count-up can all be seen. */
export function OdometerDemo() {
  const [n, setN] = useState(6724);
  const [run, setRun] = useState(0);
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row">
        <DemoTag>Synthetic value, demo controls</DemoTag>
      </div>
      <Tile label="Nodes" note="rolls the digits that changed, last digit first">
        <AnimatedNumber key={run} value={n} maxHz={0} countUpOnMount={run > 0} />
      </Tile>
      <div className="kg-live-row">
        <Button size="sm" onClick={() => setN((v) => v + 1)}>
          +1
        </Button>
        <Button size="sm" onClick={() => setN((v) => v - 1)}>
          -1
        </Button>
        <Button size="sm" onClick={() => setN((v) => v + 137)}>
          +137
        </Button>
        <Button size="sm" onClick={() => setN((v) => Math.round(v * 1.2))}>
          Jump +20%
        </Button>
        <Button size="sm" onClick={() => setN((v) => Math.round(v * 0.7))}>
          Fall -30%
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setN(6724);
            setRun((r) => r + 1);
          }}
        >
          Replay count-up
        </Button>
      </div>
      <p className="kg-live-label">
        <b>+1</b> and <b>+137</b> roll. <b>Jump</b> and <b>Fall</b> move by more than 5%, so they count up or
        down over 900 ms. <b>Replay</b> remounts with <code>countUpOnMount</code>.
      </p>
    </div>
  );
}

/** A burst of fast updates into a coalesced counter and an uncoalesced one, side by side. */
export function OdometerBurst() {
  const [n, setN] = useState(1000);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const left = useRef(0);
  useEffect(() => () => clearInterval(timer.current), []);
  const burst = () => {
    clearInterval(timer.current);
    left.current = 40;
    timer.current = setInterval(() => {
      setN((v) => v + 3 + Math.round(Math.random() * 4));
      left.current -= 1;
      if (left.current <= 0) clearInterval(timer.current);
    }, 50);
  };
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row">
        <DemoTag>Synthetic burst, demo control</DemoTag>
      </div>
      <div className="kg-live-split">
        <Tile label="maxHz 1 (the default)" size="md" note="at most one visual update a second">
          <AnimatedNumber value={n} />
        </Tile>
        <Tile label="maxHz 0" size="md" note="every update, 20 a second">
          <AnimatedNumber value={n} maxHz={0} />
        </Tile>
      </div>
      <div className="kg-live-row">
        <Button size="sm" onClick={burst}>
          Burst: 40 updates in 2 s
        </Button>
      </div>
    </div>
  );
}

const cssVars = (vars: Record<`--${string}`, string>): CSSProperties => vars as CSSProperties;

/** The other faces: mono, the instant seconds counter, a priced figure, a percentage and Unknown. */
export function OdometerVariants() {
  const price = usePrice();
  const tip = useTip();
  const summary = useSummary();
  const now = useKitNow();
  const [t0] = useState(() => now);
  return (
    <div className="kg-live-stack">
      <div className="kg-live-split">
        <Tile label="FLUX price" size="md" note="live, custom format">
          <AnimatedNumber value={price?.usd} format={(v) => `$${v.toFixed(4)}`} />
        </Tile>
        <Tile label="24 h change" size="md" note="live, custom format">
          <AnimatedNumber
            value={price ? price.change_24h_pct / 100 : null}
            format={(v) => `${v >= 0 ? '+' : ''}${formatPercent(v, 2)}`}
          />
        </Tile>
        <Tile label="Mono, for tables" size="md" note={'font="mono"'}>
          <AnimatedNumber font="mono" value={tip?.height} />
        </Tile>
        <Tile label="Seconds counter" size="md" note="roll={false}: swaps, never rolls">
          <AnimatedNumber
            font="mono"
            roll={false}
            value={Math.max(0, Math.floor((now - t0) / 1000))}
            format={(v) => `${formatInt(v)} s`}
          />
        </Tile>
        <Tile label="No value yet" size="md" note="null renders Unknown, never 0">
          <AnimatedNumber value={null} />
        </Tile>
        <Tile label="Light numerals" size="md" note="inherits size and weight">
          <span
            style={{ fontSize: 'var(--fs-2xl)', ...cssVars({ '--ui-number-weight': 'var(--fw-light)' }) }}
          >
            <AnimatedNumber value={summary?.app_count} />
          </span>
        </Tile>
      </div>
    </div>
  );
}
