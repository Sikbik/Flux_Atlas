// "Where the value went": inputs on the left, outputs on the right, ribbons between them as thick as
// the amount. Change that returns to the sender is quiet, a coinbase splits white light into the tier
// colours, the fee is a dashed line to a small card. Hover or focus a card and its ribbons light up
// while the rest recede. A pending transaction is outlined and sweeping; when its block lands the
// ribbons fill in with one pass of light. Under 480 px the diagram folds into a proportional list.

import { Landmark, Link2, Sparkles } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TxDetailDto } from '../../../api/generated/TxDetailDto';
import { formatInt, formatPercent } from '../../../lib/format';
import { Amount, Chip, CopyButton, EntityLink, TierGlyph, tierLabel } from '../../../ui';
import { useWidth } from '../hooks/useDom';
import { knownEntity } from '../lib/entities';
import { buildFlow, type FlowCard, type FlowModel, layoutFlow, type Placed, ribbonPath } from '../lib/txflow';
import { AddressTag } from '../views/shared';
import './flow.css';

const NARROW = 480;
const FEE_H = 72;

function roleLabel(c: FlowCard, model: FlowModel): { glyph: ReactNode; text: string; sub?: string } {
  if (c.side === 'in') {
    if (c.role === 'coinbase')
      return { glyph: <Sparkles size={13} strokeWidth={1.5} />, text: 'Block reward', sub: 'newly issued' };
    if (c.role === 'unknown') return { glyph: null, text: 'Inputs', sub: 'not listed by the explorer' };
    if (c.folded) return { glyph: null, text: `${formatInt(c.indices.length)} more inputs` };
    return {
      glyph: null,
      text:
        model.inputs.length > 1 || c.indices.length > 1 ? `Input${c.indices.length > 1 ? 's' : ''}` : 'Input',
      sub: c.indices.length > 1 ? `${formatInt(c.indices.length)} outputs spent` : undefined,
    };
  }
  if (c.role === 'tier' && c.tier)
    return { glyph: <TierGlyph tier={c.tier} size={14} />, text: `${tierLabel(c.tier)} payout` };
  if (c.role === 'devfund') return { glyph: <Landmark size={13} strokeWidth={1.5} />, text: 'Dev fund' };
  if (c.role === 'change')
    return {
      glyph: null,
      text: 'Change',
      sub: c.folded ? 'back to the sender, merged' : 'back to the sender',
    };
  if (c.folded) return { glyph: null, text: `${formatInt(c.indices.length)} more outputs` };
  return {
    glyph: null,
    text: 'Recipient',
    sub: c.indices.length === 1 ? `output ${c.indices[0]}` : undefined,
  };
}

function ribbonColors(model: FlowModel, to: FlowCard, from: FlowCard): [string, string] {
  const c0 = from.role === 'coinbase' ? 'var(--hot)' : 'var(--accent-500)';
  if (to.role === 'tier' && to.tier) return [c0, `var(--tier-${to.tier})`];
  if (to.role === 'change') return ['var(--accent-700)', 'var(--text-4)'];
  if (to.role === 'devfund') return [c0, 'var(--accent-300)'];
  void model;
  return [c0, 'var(--accent-300)'];
}

function Card({
  card,
  model,
  style,
  hot,
  dim,
  onHot,
  share,
  index,
}: {
  card: FlowCard;
  model: FlowModel;
  style?: CSSProperties;
  hot: boolean;
  dim: boolean;
  onHot: (id: string | null) => void;
  share?: number;
  index: number;
}) {
  const r = roleLabel(card, model);
  const entity = knownEntity(card.address);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only light up the related ribbons; the links inside are the controls
    <div
      className="ex-fcard"
      data-role={card.role}
      data-tier={card.tier}
      data-side={card.side}
      data-hot={hot || undefined}
      data-dim={dim || undefined}
      style={{
        ...style,
        ['--i' as string]: index,
        ...(share !== undefined ? { ['--share' as string]: Math.min(1, share) } : null),
      }}
      onPointerEnter={() => onHot(card.id)}
      onPointerLeave={() => onHot(null)}
      onFocus={() => onHot(card.id)}
      onBlur={() => onHot(null)}
    >
      <div className="ex-fcard__role">
        {r.glyph}
        <span>{r.text}</span>
        {r.sub ? <span className="ex-fcard__sub">{r.sub}</span> : null}
        {share !== undefined ? <span className="ex-fcard__share">{formatPercent(share, 1)}</span> : null}
      </div>
      {card.address ? (
        <div className="ex-fcard__addr">
          <AddressTag address={card.address} hideLabel={card.role === 'devfund'} />
        </div>
      ) : card.role === 'coinbase' ? (
        <div className="ex-fcard__addr" data-muted>
          Newly issued coins
        </div>
      ) : card.folded ? (
        <div className="ex-fcard__addr" data-muted>
          Smaller amounts, folded
        </div>
      ) : (
        <div className="ex-fcard__addr" data-muted>
          {entity ? entity.label : 'No address'}
        </div>
      )}
      <Amount className="ex-fcard__amt" value={card.sats} exact unit="FLUX" />
      <div className="ex-fcard__foot">
        {card.side === 'out' && card.spentTxid ? (
          <span>
            Spent in <EntityLink kind="tx" value={card.spentTxid} />
          </span>
        ) : card.side === 'out' &&
          !card.folded &&
          card.role !== 'tier' &&
          card.role !== 'devfund' &&
          card.spentTxid === null ? (
          <span className="ex-fcard__unspent">
            <i aria-hidden="true" /> Unspent
          </span>
        ) : null}
        {card.side === 'in' && card.spends.length > 0 ? (
          <span>
            Spends output {card.spends[0]!.vout} of <EntityLink kind="tx" value={card.spends[0]!.txid} />
            {card.spends.length > 1 ? ` and ${card.spends.length - 1} more` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function FlowDiagram({ tx, pending }: { tx: TxDetailDto; pending: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const uid = useId().replace(/:/g, '');
  const model = useMemo(() => buildFlow(tx), [tx]);
  const [hot, setHot] = useState<string | null>(null);
  const narrow = width > 0 && width < NARROW;
  const layout = useMemo(
    () => (width >= NARROW ? layoutFlow(model, { width, cardMin: 92 }) : null),
    [model, width],
  );

  // One pass of light when a pending transaction is mined.
  const wasPending = useRef(pending);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (wasPending.current && !pending) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      wasPending.current = pending;
      return () => clearTimeout(t);
    }
    wasPending.current = pending;
    return undefined;
  }, [pending]);

  const cardById = useMemo(() => new Map([...model.inputs, ...model.outputs].map((c) => [c.id, c])), [model]);
  const connected = (id: string): Set<string> => {
    const s = new Set<string>([id]);
    for (const b of model.bands) {
      if (b.from === id) s.add(b.to);
      if (b.to === id) s.add(b.from);
    }
    return s;
  };
  const lit = hot ? connected(hot) : null;
  const totalOut = model.outputs.reduce((s, c) => s + Number(c.sats ?? 0n), 0);
  const totalIn = model.inputs.reduce((s, c) => s + Number(c.sats ?? 0n), 0);

  const fee = model.feeSats;
  const showFee = fee !== null && fee > 0n && !model.coinbase;

  const feeCard = showFee ? (
    <div
      className="ex-fcard ex-fcard--fee"
      data-side="out"
      title="The fee is collected in the dev fund output of the block"
    >
      <div className="ex-fcard__role">
        <span>Network fee</span>
      </div>
      <Amount className="ex-fcard__amt" value={fee} exact unit="FLUX" />
    </div>
  ) : null;

  const dataChips = model.data.length > 0 && (
    <div className="ex-flow__data">
      {model.data.map((d) => (
        <span className="ex-flow__chip" key={d.id}>
          <Link2 size={13} strokeWidth={1.5} aria-hidden="true" />
          <span className="ex-flow__chip-label">Data, output {d.n}</span>
          <code title={d.text ?? undefined}>
            {d.text
              ? d.text.length > 38
                ? `${d.text.slice(0, 20)}…${d.text.slice(-12)}`
                : d.text
              : 'binary payload'}
          </code>
          {d.text ? <CopyButton value={d.text} what="payload" /> : null}
        </span>
      ))}
    </div>
  );

  return (
    <div
      ref={ref}
      className="ex-flow"
      data-pending={pending || undefined}
      data-flash={flash || undefined}
      data-narrow={narrow || undefined}
      data-hot={hot ? '' : undefined}
    >
      {layout ? (
        <div className="ex-flow__stage" style={{ height: layout.height + (showFee ? FEE_H : 0) }}>
          <svg
            className="ex-flow__svg"
            width={width}
            height={layout.height + (showFee ? FEE_H : 0)}
            viewBox={`0 0 ${width} ${layout.height + (showFee ? FEE_H : 0)}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              {layout.ribbons.map((r, i) => {
                const to = cardById.get(r.to)!;
                const from = cardById.get(r.from)!;
                const [c0, c1] = ribbonColors(model, to, from);
                return (
                  <linearGradient
                    key={`${r.from}>${r.to}`}
                    id={`${uid}-g${i}`}
                    gradientUnits="userSpaceOnUse"
                    x1={layout.x0}
                    x2={layout.x1}
                    y1="0"
                    y2="0"
                  >
                    <stop offset="0" stopColor={c0} />
                    <stop offset="1" stopColor={c1} />
                  </linearGradient>
                );
              })}
              <linearGradient id={`${uid}-sweep`} x1="0" x2="1" y1="0" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.6" stopColor="#fff" stopOpacity="0.5" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <clipPath id={`${uid}-clip`}>
                {layout.ribbons.map((r) => (
                  <path key={`${r.from}>${r.to}`} d={ribbonPath(r, layout.x0, layout.x1)} />
                ))}
              </clipPath>
            </defs>
            <g className="ex-flow__ribbons">
              {layout.ribbons.map((r, i) => {
                const on = !lit || (lit.has(r.from) && lit.has(r.to));
                return (
                  <path
                    key={`${r.from}>${r.to}`}
                    className="ex-flow__ribbon"
                    d={ribbonPath(r, layout.x0, layout.x1)}
                    fill={`url(#${uid}-g${i})`}
                    stroke={`url(#${uid}-g${i})`}
                    data-on={on || undefined}
                    data-change={cardById.get(r.to)?.role === 'change' || undefined}
                    onPointerEnter={() => setHot(r.to)}
                    onPointerLeave={() => setHot(null)}
                  />
                );
              })}
            </g>
            <g clipPath={`url(#${uid}-clip)`} className="ex-flow__sweepclip">
              <rect
                className="ex-flow__sweep"
                x={layout.x0 - 80}
                y="0"
                width="80"
                height={layout.height}
                fill={`url(#${uid}-sweep)`}
                style={{ ['--sw' as string]: `${layout.x1 - layout.x0 + 160}px` }}
              />
            </g>
            {showFee && layout.inputs.length > 0 ? (
              <path
                className="ex-flow__feeline"
                d={`M ${layout.x0} ${layout.height - 2} C ${layout.x0 + (layout.x1 - layout.x0) / 2} ${layout.height - 2}, ${layout.x0 + (layout.x1 - layout.x0) / 2} ${layout.height + FEE_H / 2 + 6}, ${layout.x1} ${layout.height + FEE_H / 2 + 6}`}
              />
            ) : null}
          </svg>
          {layout.inputs.map((p: Placed, i) => (
            <Card
              key={p.card.id}
              card={p.card}
              model={model}
              index={i}
              hot={hot === p.card.id}
              dim={lit !== null && !lit.has(p.card.id)}
              onHot={setHot}
              share={totalIn > 0 && p.card.sats !== null ? Number(p.card.sats) / totalIn : undefined}
              style={{ left: 0, top: p.y, width: layout.cardW, height: p.h }}
            />
          ))}
          {layout.outputs.map((p: Placed, i) => (
            <Card
              key={p.card.id}
              card={p.card}
              model={model}
              index={i + layout.inputs.length}
              hot={hot === p.card.id}
              dim={lit !== null && !lit.has(p.card.id)}
              onHot={setHot}
              share={totalOut > 0 && p.card.sats !== null ? Number(p.card.sats) / totalOut : undefined}
              style={{ left: layout.x1, top: p.y, width: layout.cardW, height: p.h }}
            />
          ))}
          {feeCard ? (
            <div
              className="ex-flow__feeslot"
              style={{ left: layout.x1, top: layout.height + 12, width: layout.cardW, height: FEE_H - 12 }}
            >
              {feeCard}
            </div>
          ) : null}
        </div>
      ) : narrow ? (
        <div className="ex-flow__list">
          <ul className="ex-flow__col" aria-label="Inputs">
            {model.inputs.map((c, i) => (
              <li key={c.id}>
                <Card
                  card={c}
                  model={model}
                  index={i}
                  hot={false}
                  dim={false}
                  onHot={() => undefined}
                  share={totalIn > 0 && c.sats !== null ? Number(c.sats) / totalIn : undefined}
                />
              </li>
            ))}
          </ul>
          <div className="ex-flow__arrow" aria-hidden="true" />
          <ul className="ex-flow__col" aria-label="Outputs">
            {model.outputs.map((c, i) => (
              <li key={c.id}>
                <Card
                  card={c}
                  model={model}
                  index={i + model.inputs.length}
                  hot={false}
                  dim={false}
                  onHot={() => undefined}
                  share={totalOut > 0 && c.sats !== null ? Number(c.sats) / totalOut : undefined}
                />
              </li>
            ))}
            {feeCard ? <li>{feeCard}</li> : null}
          </ul>
        </div>
      ) : (
        <div className="ex-flow__stage" style={{ height: 220 }} />
      )}
      {dataChips}
      {model.inputsUnknown ? (
        <p className="ex-flow__note">
          <Chip size="sm">Note</Chip> The explorer did not list the inputs of this transaction, so what it
          spent is unknown.
        </p>
      ) : null}
    </div>
  );
}
