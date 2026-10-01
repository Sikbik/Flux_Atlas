// The mempool as an instrument: a ring that fills as the 30 second block interval runs out, with one
// dot per pending transaction. Node check-ins ride the inner lane (small), transfers the outer lane
// (large, haloed). A new transaction scales in where its id places it on the ring; when a block lands
// the transactions it took fall into the centre. The same data is a keyboard-reachable list beside it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRuntime } from '../../../../app/context';
import { formatBytes, formatInt, formatPercent } from '../../../../lib/format';
import { useBeat } from '../../../../lib/useClock';
import { Amount } from '../../../../ui';
import { useWidth } from '../../hooks/useDom';
import type { MempoolRow } from '../../hooks/useMempoolLive';
import { useFullMotion } from '../../hooks/useMotion';
import { TX_KINDS } from '../../lib/txkinds';
import './mempool.css';

const VB = 400;
const C = VB / 2;
const R_TIMER = 178;
const R_IN = 126;
const R_OUT = 152;
const MAX_DOTS = 220;
const LEAVE_MS = 900;

const isCheckin = (r: MempoolRow) =>
  r.tx.kind === 'node_confirm' ||
  r.tx.kind === 'node_start' ||
  r.tx.kind === 'node_tx' ||
  (r.tx.kind === 'unknown' && Number(r.tx.value) === 0);

function place(txid: string, lane: number, jitter: number): { x: number; y: number; a: number } {
  const a = (Number.parseInt(txid.slice(0, 8), 16) / 0x1_0000_0000) * Math.PI * 2;
  const j = (Number.parseInt(txid.slice(8, 12), 16) / 0xffff - 0.5) * jitter;
  const r = lane + j;
  return { x: C + r * Math.sin(a), y: C - r * Math.cos(a), a };
}

interface Dot {
  id: string;
  row: MempoolRow;
  x: number;
  y: number;
  check: boolean;
  leaving: boolean;
}

export function MempoolRing({
  rows,
  size,
  bytes,
  bytesPartial = false,
  nextHeight,
}: {
  rows: readonly MempoolRow[];
  size: number;
  /** Total of the sizes the server knows. */
  bytes: number | null;
  /** Some transaction's size is unknown, so `bytes` is a floor. */
  bytesPartial?: boolean;
  nextHeight: number | null;
}) {
  const { clock } = useRuntime();
  const beat = useBeat(clock);
  const full = useFullMotion();
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [hot, setHot] = useState<string | null>(null);
  const prev = useRef<Map<string, Dot>>(new Map());
  const [leaving, setLeaving] = useState<Dot[]>([]);

  const current = useMemo<Dot[]>(() => {
    return rows.slice(0, MAX_DOTS).map((row) => {
      const check = isCheckin(row);
      const p = place(row.tx.txid, check ? R_IN : R_OUT, check ? 14 : 12);
      return { id: row.tx.txid, row, x: p.x, y: p.y, check, leaving: false };
    });
  }, [rows]);

  // Dots that disappeared since the last render fall into the centre, then are dropped.
  useEffect(() => {
    const now = new Set(current.map((d) => d.id));
    const gone: Dot[] = [];
    for (const [id, d] of prev.current) if (!now.has(id)) gone.push({ ...d, leaving: true });
    prev.current = new Map(current.map((d) => [d.id, d]));
    if (gone.length === 0 || !full) return undefined;
    setLeaving((l) => [...l, ...gone].slice(-80));
    const t = setTimeout(
      () => setLeaving((l) => l.filter((d) => !gone.some((g) => g.id === d.id))),
      LEAVE_MS,
    );
    return () => clearTimeout(t);
  }, [current, full]);

  const circ = 2 * Math.PI * R_TIMER;
  const hotDot = hot ? current.find((d) => d.id === hot) : undefined;
  const scale = width > 0 ? width / VB : 1;
  const late = beat.phase === 'late' || beat.phase === 'quiet';
  const seconds = Math.ceil(beat.remainingMs / 1000);
  const transfers = rows.filter((r) => !isCheckin(r)).length;

  return (
    <div
      className="ex-ring"
      ref={ref}
      data-late={late || undefined}
      data-soon={beat.phase === 'soon' || undefined}
    >
      <svg
        className="ex-ring__svg"
        viewBox={`0 0 ${VB} ${VB}`}
        role="img"
        aria-label={`Mempool: ${formatInt(size)} pending transactions, next block in ${seconds} seconds`}
      >
        <defs>
          <radialGradient id="ex-ring-core" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor="var(--accent-600)" stopOpacity="0.28" />
            <stop offset="0.7" stopColor="var(--accent-600)" stopOpacity="0.06" />
            <stop offset="1" stopColor="var(--accent-600)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={C} cy={C} r={R_IN - 18} fill="url(#ex-ring-core)" />
        <circle className="ex-ring__lane" cx={C} cy={C} r={R_IN} />
        <circle className="ex-ring__lane" cx={C} cy={C} r={R_OUT} />
        <circle className="ex-ring__track" cx={C} cy={C} r={R_TIMER} />
        <circle
          className="ex-ring__arc"
          cx={C}
          cy={C}
          r={R_TIMER}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - (late ? 1 : beat.progress))}
          transform={`rotate(-90 ${C} ${C})`}
        />
        {Array.from({ length: 60 }, (_, i) => {
          const a = (i / 60) * Math.PI * 2;
          const major = i % 15 === 0;
          const r0 = R_TIMER - (major ? 13 : 9);
          const r1 = R_TIMER - 5;
          return (
            <line
              // biome-ignore lint/suspicious/noArrayIndexKey: sixty fixed ticks
              key={i}
              className="ex-ring__tick"
              data-major={major || undefined}
              data-on={i / 60 < (late ? 1 : beat.progress) || undefined}
              x1={C + r0 * Math.sin(a)}
              y1={C - r0 * Math.cos(a)}
              x2={C + r1 * Math.sin(a)}
              y2={C - r1 * Math.cos(a)}
            />
          );
        })}
        {leaving.map((d) => (
          <circle
            key={`l-${d.id}`}
            className="ex-ring__dot"
            data-leaving=""
            data-check={d.check || undefined}
            cx={d.x}
            cy={d.y}
            r={d.check ? 2.8 : 5}
            style={{ ['--dx' as string]: `${C - d.x}px`, ['--dy' as string]: `${C - d.y}px` }}
          />
        ))}
        {current.map((d) => (
          <g
            key={d.id}
            onPointerEnter={() => setHot(d.id)}
            onPointerLeave={() => setHot((h) => (h === d.id ? null : h))}
          >
            <circle className="ex-ring__hit" cx={d.x} cy={d.y} r={9} />
            {!d.check ? (
              <circle
                className="ex-ring__halo"
                cx={d.x}
                cy={d.y}
                r={9}
                data-hot={hot === d.id || undefined}
              />
            ) : null}
            <circle
              className="ex-ring__dot"
              data-check={d.check || undefined}
              data-hot={hot === d.id || undefined}
              cx={d.x}
              cy={d.y}
              r={d.check ? 2.8 : 5}
            />
          </g>
        ))}
      </svg>
      <div className="ex-ring__center">
        <span className="ex-ring__count">{formatInt(size)}</span>
        <span className="ex-ring__what">{size === 1 ? 'transaction waiting' : 'transactions waiting'}</span>
        <span className="ex-ring__next">
          {nextHeight !== null ? `for block ${formatInt(nextHeight)}` : 'for the next block'}
          <b>{late ? 'late' : `in ${seconds} s`}</b>
        </span>
        {bytes !== null ? (
          <span className="ex-ring__bytes">
            {bytes > 0 ? `${bytesPartial ? 'at least ' : ''}${formatBytes(bytes)}` : null}
          </span>
        ) : null}
      </div>
      {hotDot && width > 0 ? (
        <div
          className="ex-ring__tip"
          role="presentation"
          data-side={hotDot.x > VB * 0.55 ? 'left' : 'right'}
          style={{ left: hotDot.x * scale, top: Math.max(8, hotDot.y * scale - 20) }}
        >
          <div className="ex-ring__tip-head">{hotDot.row.tx.txid.slice(0, 10)}...</div>
          <div className="ex-ring__tip-row">
            <span
              className="ex-ring__tip-key"
              style={{ ['--c' as string]: hotDot.check ? 'var(--accent-500)' : 'var(--accent-300)' }}
              aria-hidden="true"
            />
            <strong>{hotDot.check ? 'Check-in' : <Amount value={hotDot.row.tx.value} decimals={2} />}</strong>
            <span>{TX_KINDS[hotDot.row.tx.kind].label}</span>
          </div>
        </div>
      ) : null}
      <p className="ex-ring__legend" aria-hidden="true">
        <span>
          <i data-check="" /> Node check-ins {formatInt(rows.length - transfers)}
        </span>
        <span>
          <i /> Value moving {formatInt(transfers)}
        </span>
        {rows.length > 0 ? <span>{formatPercent(transfers / rows.length, 0)} carry value</span> : null}
      </p>
    </div>
  );
}
