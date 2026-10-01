// The "where the value went" model of a transaction: input cards on the left, output cards on the
// right and bands between them proportional to the amount (design 8.15). Change is collapsed into one
// card (outputs that return to an input address), a coinbase shows its tier payouts and the dev fund,
// and a fee is a dashed line to a small card. Unknown values stay unknown: nothing is drawn as zero.
//
// Two pure steps: `buildFlow` turns a TxDetailDto into cards and bands, `layoutFlow` turns that into
// pixel geometry for a given width.

import type { TxDetailDto } from '../../../api/generated/TxDetailDto';
import { parseFlux } from '../../../lib/format';
import { classifyCoinbase } from './coinbase';
import type { PaidTier } from './emission';

export type FlowRole = 'input' | 'coinbase' | 'recipient' | 'change' | 'tier' | 'devfund' | 'unknown';

export interface FlowCard {
  id: string;
  side: 'in' | 'out';
  role: FlowRole;
  address: string | null;
  /** Base units; null when the upstream did not give a value. */
  sats: bigint | null;
  /** Input indices (left) or output indices (right) folded into this card. */
  indices: number[];
  tier?: PaidTier;
  /** Left cards: the outpoints spent by the inputs folded into the card. */
  spends: { txid: string; vout: number }[];
  /** A single right card: the transaction that spent the output, when known. */
  spentTxid: string | null;
  /** True when the card folds several inputs or outputs ("and 3 more"). */
  folded: boolean;
}

export interface FlowData {
  /** OP_RETURN outputs: no value, shown as chips (the app message hash). */
  id: string;
  n: number;
  text: string | null;
}

export interface FlowBand {
  from: string;
  to: string;
  /** Weight used for proportional thickness (FLUX as a number, never shown). */
  weight: number;
}

export interface FlowModel {
  coinbase: boolean;
  inputs: FlowCard[];
  outputs: FlowCard[];
  bands: FlowBand[];
  data: FlowData[];
  feeSats: bigint | null;
  valueInSats: bigint | null;
  valueOutSats: bigint;
  /** Inputs were not given with addresses and values, so the left side is one "unknown" card. */
  inputsUnknown: boolean;
  /** Every value output returns to an input address (a consolidation or self-transfer). */
  selfTransfer: boolean;
  /** Number of inputs and outputs in the transaction (before folding). */
  inputCount: number;
  outputCount: number;
}

export interface BuildOptions {
  /** Cards shown on the left before the rest fold into "and N more inputs". */
  maxInputs?: number;
  /** Same for the right side. */
  maxOutputs?: number;
}

const satsNum = (s: bigint | null): number => (s === null ? 0 : Number(s) / 1e8);

export function buildFlow(tx: TxDetailDto, opts: BuildOptions = {}): FlowModel {
  const maxIn = opts.maxInputs ?? 6;
  const maxOut = opts.maxOutputs ?? 8;
  const isCoinbase = tx.kind === 'coinbase' || tx.inputs.some((i) => i.coinbase);
  const valueOut = parseFlux(tx.value_out) ?? 0n;
  const valueIn = parseFlux(tx.value_in);

  // ---- outputs, step 1: split value outputs from data outputs ------------------------------------
  const data: FlowData[] = [];
  const valued = tx.outputs.filter((o) => {
    const zero = (parseFlux(o.value) ?? 0n) === 0n;
    if (zero && (o.op_return !== null || o.address === null)) {
      data.push({ id: `data:${o.n}`, n: o.n, text: o.op_return });
      return false;
    }
    return true;
  });

  // ---- inputs --------------------------------------------------------------------------------------
  const inputAddresses = new Set<string>();
  const groups = new Map<string, FlowCard>();
  let unknownInputs = false;
  if (isCoinbase) {
    groups.set('coinbase', {
      id: 'in:coinbase',
      side: 'in',
      role: 'coinbase',
      address: null,
      sats: valueOut,
      indices: [0],
      spends: [],
      spentTxid: null,
      folded: false,
    });
  } else {
    tx.inputs.forEach((inp, idx) => {
      if (inp.address) inputAddresses.add(inp.address);
      const key = inp.address ?? '?';
      const sats = parseFlux(inp.value);
      const spend =
        inp.prev_txid !== null && inp.prev_vout !== null
          ? [{ txid: inp.prev_txid, vout: inp.prev_vout }]
          : [];
      const g = groups.get(key);
      if (g) {
        g.indices.push(idx);
        g.spends.push(...spend);
        g.sats = g.sats === null || sats === null ? null : g.sats + sats;
      } else {
        groups.set(key, {
          id: `in:${key}`,
          side: 'in',
          role: inp.address ? 'input' : 'unknown',
          address: inp.address,
          sats,
          indices: [idx],
          spends: [...spend],
          spentTxid: null,
          folded: false,
        });
      }
      if (sats === null || !inp.address) unknownInputs = true;
    });
  }
  let inputs = [...groups.values()].sort((a, b) => Number((b.sats ?? 0n) - (a.sats ?? 0n)));
  const inputsUnknown =
    !isCoinbase && (tx.inputs.length === 0 ? valueOut > 0n : unknownInputs && valueIn === null);
  if (inputsUnknown) {
    inputs = [
      {
        id: 'in:unknown',
        side: 'in',
        role: 'unknown',
        address: null,
        sats: null,
        indices: tx.inputs.map((_, i) => i),
        spends: [],
        spentTxid: null,
        folded: false,
      },
    ];
  } else if (inputs.length > maxIn) {
    const keep = inputs.slice(0, maxIn - 1);
    const rest = inputs.slice(maxIn - 1);
    const restSats = rest.every((c) => c.sats !== null)
      ? rest.reduce((s, c) => s + (c.sats ?? 0n), 0n)
      : null;
    keep.push({
      id: 'in:more',
      side: 'in',
      role: 'input',
      address: null,
      sats: restSats,
      indices: rest.flatMap((c) => c.indices),
      spends: rest.flatMap((c) => c.spends),
      spentTxid: null,
      folded: true,
    });
    inputs = keep;
  }

  // ---- outputs, step 2: classify -------------------------------------------------------------------
  const cards: FlowCard[] = [];
  if (isCoinbase) {
    const height = tx.height ?? 0;
    const classified = classifyCoinbase(
      height,
      valued.map((o) => ({ n: o.n, address: o.address, value: o.value })),
    );
    // Largest first (the list convention): Stratus, Nimbus, Cumulus, then the dev fund.
    const order = (r: string) =>
      r === 'stratus' ? 0 : r === 'nimbus' ? 1 : r === 'cumulus' ? 2 : r === 'devfund' ? 3 : 4;
    classified.sort((a, b) => order(a.role) - order(b.role) || Number(b.sats - a.sats));
    for (const c of classified) {
      const src = valued.find((o) => o.n === c.n);
      const tier = c.role === 'stratus' || c.role === 'nimbus' || c.role === 'cumulus' ? c.role : undefined;
      cards.push({
        id: `out:${c.n}`,
        side: 'out',
        role: tier ? 'tier' : c.role === 'devfund' ? 'devfund' : 'recipient',
        address: c.address,
        sats: c.sats,
        indices: [c.n],
        ...(tier ? { tier } : {}),
        spends: [],
        spentTxid: src?.spent_txid ?? null,
        folded: false,
      });
    }
  } else {
    const change: FlowCard[] = [];
    const recipients: FlowCard[] = [];
    for (const o of valued) {
      const isChange = o.address !== null && inputAddresses.has(o.address);
      const card: FlowCard = {
        id: `out:${o.n}`,
        side: 'out',
        role: isChange ? 'change' : 'recipient',
        address: o.address,
        sats: parseFlux(o.value),
        indices: [o.n],
        spends: [],
        spentTxid: o.spent_txid,
        folded: false,
      };
      (isChange ? change : recipients).push(card);
    }
    recipients.sort((a, b) => Number((b.sats ?? 0n) - (a.sats ?? 0n)));
    let changeCard: FlowCard | null = null;
    if (change.length > 0) {
      changeCard = {
        ...change[0]!,
        id: 'out:change',
        sats: change.reduce((s, c) => s + (c.sats ?? 0n), 0n),
        indices: change.flatMap((c) => c.indices),
        folded: change.length > 1,
        // Folded change addresses can differ; the card names the first and the count tells the rest.
        spentTxid: change.length === 1 ? change[0]!.spentTxid : null,
      };
    }
    cards.push(...recipients);
    if (changeCard) cards.push(changeCard);
  }
  let outputs = cards;
  if (outputs.length > maxOut) {
    // Keep the largest, fold the tail (never fold the change card: it carries meaning).
    const keep = outputs.slice(0, maxOut - 1);
    const rest = outputs.slice(maxOut - 1);
    const changeInRest = rest.find((c) => c.role === 'change');
    const foldable = rest.filter((c) => c !== changeInRest);
    if (changeInRest) keep.push(changeInRest);
    const restSats = foldable.every((c) => c.sats !== null)
      ? foldable.reduce((s, c) => s + (c.sats ?? 0n), 0n)
      : null;
    keep.push({
      id: 'out:more',
      side: 'out',
      role: 'recipient',
      address: null,
      sats: restSats,
      indices: foldable.flatMap((c) => c.indices),
      spends: [],
      spentTxid: null,
      folded: true,
    });
    outputs = keep;
  }

  const selfTransfer = !isCoinbase && outputs.length > 0 && outputs.every((c) => c.role === 'change');

  // ---- bands: proportional allocation (inputs to outputs) ------------------------------------------
  // Each input's value is split over the outputs in proportion to their amounts. An input of unknown
  // value shares what came out, so the picture still balances.
  const bands: FlowBand[] = [];
  const outTotal = outputs.reduce((s, c) => s + satsNum(c.sats), 0);
  if (outTotal > 0) {
    const unknownIn = inputs.filter((c) => c.sats === null).length;
    for (const i of inputs) {
      const iw = i.sats === null ? outTotal / Math.max(1, unknownIn) : satsNum(i.sats);
      if (iw <= 0) continue;
      for (const o of outputs) {
        const ow = satsNum(o.sats);
        if (ow > 0) bands.push({ from: i.id, to: o.id, weight: (iw * ow) / outTotal });
      }
    }
  }

  return {
    coinbase: isCoinbase,
    inputs,
    outputs,
    bands,
    data,
    feeSats: parseFlux(tx.fee),
    valueInSats: valueIn,
    valueOutSats: valueOut,
    inputsUnknown,
    selfTransfer,
    inputCount: tx.inputs.length,
    outputCount: tx.outputs.length,
  };
}

// ---------------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------------

export interface Placed {
  card: FlowCard;
  y: number;
  h: number;
  /** The slot the bands attach to: centred in the card, its thickness proportional to the amount. */
  slotY: number;
  slotH: number;
}

export interface Ribbon {
  from: string;
  to: string;
  /** Left end: y and thickness. */
  y0: number;
  h0: number;
  /** Right end: y and thickness. */
  y1: number;
  h1: number;
}

export interface FlowLayout {
  inputs: Placed[];
  outputs: Placed[];
  ribbons: Ribbon[];
  height: number;
  cardW: number;
  /** x where bands start (right edge of the left cards) and end (left edge of the right cards). */
  x0: number;
  x1: number;
}

export interface LayoutOptions {
  width: number;
  /** Total band thickness budget in px. */
  band?: number;
  minBand?: number;
  cardMin?: number;
  gap?: number;
  pad?: number;
}

/** Thickness per item so that sum(max(minBand, k * weight)) equals `budget` (water filling). */
export function thicknesses(weights: readonly number[], budget: number, minBand: number): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return weights.map(() => minBand);
  if (n * minBand >= budget) return weights.map(() => minBand);
  // Items below the floor are pinned; solve for k over the rest.
  let pinned = new Set<number>();
  for (let iter = 0; iter < n + 1; iter++) {
    const freeTotal = weights.reduce((s, w, i) => (pinned.has(i) ? s : s + w), 0);
    const room = budget - pinned.size * minBand;
    const k = freeTotal > 0 ? room / freeTotal : 0;
    const next = new Set(pinned);
    weights.forEach((w, i) => {
      if (!pinned.has(i) && k * w < minBand) next.add(i);
    });
    if (next.size === pinned.size) {
      return weights.map((w, i) => (pinned.has(i) ? minBand : Math.max(minBand, k * w)));
    }
    pinned = next;
  }
  return weights.map(() => minBand);
}

function cubic(x0: number, x1: number, y0: number, y1: number): string {
  const mx = (x0 + x1) / 2;
  return `C ${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`;
}

/** The SVG path of a ribbon between its two slots. */
export function ribbonPath(r: Ribbon, x0: number, x1: number): string {
  const top = `M ${x0} ${r.y0} ${cubic(x0, x1, r.y0, r.y1)}`;
  const bottom = `L ${x1} ${r.y1 + r.h1} ${cubic(x1, x0, r.y1 + r.h1, r.y0 + r.h0)} Z`;
  return `${top} ${bottom}`;
}

export function layoutFlow(model: FlowModel, o: LayoutOptions): FlowLayout {
  const minBand = o.minBand ?? 7;
  const cardMin = o.cardMin ?? 62;
  const gap = o.gap ?? 12;
  const pad = o.pad ?? 8;
  const cardW = Math.max(120, Math.min(280, Math.round(o.width * 0.38)));
  const x0 = cardW;
  const x1 = o.width - cardW;

  const unknownIn = model.inputs.filter((c) => c.sats === null).length;
  const outTotal = model.outputs.reduce((s, c) => s + satsNum(c.sats), 0);
  const weightsIn = model.inputs.map((c) =>
    c.sats === null ? outTotal / Math.max(1, unknownIn) : satsNum(c.sats),
  );
  const weightsOut = model.outputs.map((c) => satsNum(c.sats));
  const budget =
    o.band ?? Math.max(90, Math.min(190, 40 + Math.max(model.inputs.length, model.outputs.length) * 28));
  const tin = thicknesses(weightsIn, budget, minBand);
  const tout = thicknesses(weightsOut, budget, minBand);

  const column = (cards: FlowCard[], t: number[]): { placed: Placed[]; h: number } => {
    let y = 0;
    const placed = cards.map((card, i) => {
      const slotH = t[i]!;
      const h = Math.max(cardMin, slotH + pad * 2);
      const p: Placed = { card, y, h, slotY: y + (h - slotH) / 2, slotH };
      y += h + gap;
      return p;
    });
    return { placed, h: Math.max(0, y - gap) };
  };
  const left = column(model.inputs, tin);
  const right = column(model.outputs, tout);
  const height = Math.max(left.h, right.h, cardMin);
  const shift = (cols: { placed: Placed[]; h: number }) => {
    const dy = (height - cols.h) / 2;
    for (const p of cols.placed) {
      p.y += dy;
      p.slotY += dy;
    }
  };
  shift(left);
  shift(right);

  // Subdivide each slot among its bands, proportional to the band weights.
  const inUsed = new Map<string, number>();
  const outUsed = new Map<string, number>();
  const inSlot = new Map(left.placed.map((p) => [p.card.id, p]));
  const outSlot = new Map(right.placed.map((p) => [p.card.id, p]));
  const inWeight = new Map<string, number>();
  const outWeight = new Map<string, number>();
  for (const b of model.bands) {
    inWeight.set(b.from, (inWeight.get(b.from) ?? 0) + b.weight);
    outWeight.set(b.to, (outWeight.get(b.to) ?? 0) + b.weight);
  }
  // Order bands so ribbons do not cross more than needed: by output position within each input.
  const outIndex = new Map(model.outputs.map((c, i) => [c.id, i]));
  const inIndex = new Map(model.inputs.map((c, i) => [c.id, i]));
  const ordered = [...model.bands].sort(
    (a, b) => inIndex.get(a.from)! - inIndex.get(b.from)! || outIndex.get(a.to)! - outIndex.get(b.to)!,
  );
  const ribbons: Ribbon[] = [];
  for (const b of ordered) {
    const ps = inSlot.get(b.from);
    const pe = outSlot.get(b.to);
    if (!ps || !pe) continue;
    const h0 = (ps.slotH * b.weight) / (inWeight.get(b.from) ?? b.weight);
    const h1 = (pe.slotH * b.weight) / (outWeight.get(b.to) ?? b.weight);
    const y0 = ps.slotY + (inUsed.get(b.from) ?? 0);
    inUsed.set(b.from, (inUsed.get(b.from) ?? 0) + h0);
    ribbons.push({ from: b.from, to: b.to, y0, h0, y1: 0, h1 });
  }
  // The right ends stack in the order of the inputs within each output.
  const byOut = new Map<string, Ribbon[]>();
  for (const r of ribbons) {
    const l = byOut.get(r.to) ?? [];
    l.push(r);
    byOut.set(r.to, l);
  }
  for (const [id, list] of byOut) {
    const pe = outSlot.get(id)!;
    list.sort((a, b) => inIndex.get(a.from)! - inIndex.get(b.from)!);
    let used = outUsed.get(id) ?? 0;
    for (const r of list) {
      r.y1 = pe.slotY + used;
      used += r.h1;
    }
    outUsed.set(id, used);
  }
  return { inputs: left.placed, outputs: right.placed, ribbons, height, cardW, x0, x1 };
}
