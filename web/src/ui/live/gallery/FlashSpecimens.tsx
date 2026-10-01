import { useState } from 'react';
import { useNetwork, useTip } from '../../../app/context';
import { formatHeight, formatInt } from '../../../lib/format';
import { Button } from '../../controls/Button';
import { FlashOnChange } from '../FlashOnChange';
import type { FlashTone } from '../flash';
import { LiveDot } from '../LiveDot';
import { DemoTag } from './parts';
import './specimens.css';

const pad = { padding: '6px 12px' } as const;

/** Real counters that glow when they change, and the five tones on a synthetic value. */
export function FlashWash() {
  const tip = useTip();
  const mempool = useNetwork((s) => (s.loaded ? s.mempool.size : null));
  const [n, setN] = useState(41);
  const tones: readonly FlashTone[] = ['accent', 'white', 'up', 'down', 'auto'];
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row" data-gap="lg">
        <span className="kg-live-label">Live</span>
        <FlashOnChange value={tip?.height} tone="white" style={pad}>
          <span className="ui-mono">{formatHeight(tip?.height)}</span>
        </FlashOnChange>
        <FlashOnChange value={mempool} tone="auto" style={pad}>
          <span className="ui-mono">{mempool === null ? 'Unknown' : `${formatInt(mempool)} waiting`}</span>
        </FlashOnChange>
      </div>
      <div className="kg-live-row" data-gap="lg">
        <DemoTag>Synthetic</DemoTag>
        {tones.map((t) => (
          <FlashOnChange key={t} value={n} tone={t} style={pad}>
            <span className="ui-mono">
              {t} {n}
            </span>
          </FlashOnChange>
        ))}
      </div>
      <div className="kg-live-row">
        <Button size="sm" onClick={() => setN((v) => v + (Math.random() < 0.5 ? -3 : 5))}>
          Change the value
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setN((v) => v + 1);
            setTimeout(() => setN((v) => v - 2), 350);
            setTimeout(() => setN((v) => v + 4), 700);
          }}
        >
          Change it three times in 0.7 s
        </Button>
      </div>
      <p className="kg-live-label">
        A second change mid-decay restarts the light; it never stacks. The wash is at most 12% of its colour.
      </p>
    </div>
  );
}

interface Row {
  id: number;
  endpoint: string;
  tier: string;
  rank: number;
  paid: number;
}

const START: readonly Row[] = [
  { id: 1, endpoint: '65.109.64.85:16127', tier: 'Stratus', rank: 1606, paid: 2997506 },
  { id: 2, endpoint: '38.240.227.233:16127', tier: 'Stratus', rank: 1505, paid: 2997405 },
  { id: 3, endpoint: '38.240.227.17:16127', tier: 'Nimbus', rank: 1517, paid: 2997604 },
  { id: 4, endpoint: '213.32.246.1:16137', tier: 'Cumulus', rank: 212, paid: 2997650 },
];

/** The row pattern, as a list of rows and as a real table row (`as="tr"`), driven by one control. */
export function FlashRows() {
  const [rows, setRows] = useState<readonly Row[]>(START);
  const bump = () =>
    setRows((rs) => {
      const i = Math.floor(Math.random() * rs.length);
      return rs.map((r, j) =>
        j === i ? { ...r, rank: Math.max(1, r.rank + (Math.random() < 0.5 ? -7 : 11)) } : r,
      );
    });
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row">
        <DemoTag>Synthetic rows</DemoTag>
        <Button size="sm" onClick={bump}>
          Update a row
        </Button>
      </div>
      <ul className="kg-live-rows" aria-label="Rows as list items">
        {rows.map((r) => (
          <FlashOnChange
            as="li"
            key={r.id}
            value={r.rank}
            variant="bar"
            tone="auto"
            className="kg-live-rows__row"
          >
            <span className="ui-mono">{r.endpoint}</span>
            <span>{r.tier}</span>
            <span className="ui-mono">#{formatInt(r.rank)}</span>
            <span className="ui-mono">{formatHeight(r.paid)}</span>
          </FlashOnChange>
        ))}
      </ul>
      <div className="kg-live-table-wrap">
        <table className="kg-live-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Rank</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <FlashOnChange as="tr" key={r.id} value={r.rank} variant="bar" tone="auto">
                <td className="ui-mono">{r.endpoint}</td>
                <td className="ui-mono">#{formatInt(r.rank)}</td>
              </FlashOnChange>
            ))}
          </tbody>
        </table>
      </div>
      <p className="kg-live-label">
        <b>as=&quot;div&quot;</b> and <b>as=&quot;tr&quot;</b>: the row is the element that glows, and a tone
        of auto reads the rank going up or down.
      </p>
    </div>
  );
}

/** The live dot in every status, ping on and off, and three sizes. */
export function LiveDots() {
  const items: ReadonlyArray<readonly [string, 'ok' | 'pending' | 'warn' | 'crit' | 'off']> = [
    ['Live', 'ok'],
    ['Syncing', 'pending'],
    ['Stale', 'warn'],
    ['Offline', 'crit'],
    ['Unknown', 'off'],
  ];
  return (
    <div className="kg-live-stack">
      <div className="kg-live-row" data-gap="lg">
        {items.map(([label, status]) => (
          <span key={status} className="kg-live-row">
            <LiveDot status={status} />
            <span className="kg-live-label">{label}</span>
          </span>
        ))}
      </div>
      <div className="kg-live-row" data-gap="lg">
        <span className="kg-live-row">
          <LiveDot ping={false} />
          <span className="kg-live-label">Steady</span>
        </span>
        <span className="kg-live-row">
          <LiveDot size={5} />
          <LiveDot size={7} />
          <LiveDot size={10} />
          <span className="kg-live-label">5, 7 and 10 px</span>
        </span>
        <span className="kg-live-row">
          <LiveDot status="warn" ping />
          <span className="kg-live-label">Ping on warn</span>
        </span>
      </div>
      <p className="kg-live-label">
        The green dot pings every 2.4 s while the stream is healthy. It is always paired with words.
      </p>
    </div>
  );
}
