// A reference driver for `engine.sink`: what an app's own choreographer does, in about a hundred
// lines. It plays the design's relay (6.4 I) by calling the sink's low-level commands at the
// timeline's times with plain timers, the way web/src/choreo/choreographer.ts does, instead of handing
// the engine a `block` event. The lab uses it with `?driver=sink`, which exercises exactly the path
// the web app takes (the engine's own choreographer stays idle for blocks).
//
// Times and order come from `RELAY` and `DOWNLINK_ORDER` (engine/effects.ts), which are the design's
// data: the moon fires its four outputs in coinbase order, dev fund, Cumulus, Nimbus, Stratus.

import type { GlobeEngine } from '../engine/GlobeEngine';
import { DOWNLINK_ORDER, RELAY, type EffectSink, type MoonPiece, type Tier } from '../engine/effects';
import type { BlockEvent, Payee } from '../engine/types';

const TIER: Tier[] = ['unknown', 'cumulus', 'nimbus', 'stratus'];
const PIECE: Record<string, MoonPiece> = { dev: 'bar', cumulus: 'smallHex', nimbus: 'bigHex', stratus: 'cap' };

export class SinkDriver {
  private lastBeat = -1e9;
  private timers = new Set<number>();
  private aimed: Payee[] | null = null;
  private aimEta = 30000;
  private aimHeight = 0;

  constructor(
    private readonly engine: GlobeEngine,
    private readonly sink: EffectSink = engine.sink,
  ) {}

  private at(ms: number, fn: () => void): void {
    if (ms <= 0) {
      fn();
      return;
    }
    const h = window.setTimeout(() => {
      this.timers.delete(h);
      fn();
    }, ms);
    this.timers.add(h);
  }

  /** Plays a block on the timeline of 6.4 I (full, compact or reduced). */
  block(ev: Omit<BlockEvent, 'type'>): void {
    const now = performance.now();
    const compact = now - this.lastBeat < RELAY.COMPACT_WINDOW * 1000;
    this.lastBeat = now;
    const reduced = this.engine.reduced;
    const ms = (s: number): number => Math.round(s * 1000);
    const tUp = reduced ? ms(RELAY.T_UP) : compact ? 0 : ms(RELAY.T_UP);
    const dUp = reduced ? ms(RELAY.RED_UP) : compact ? ms(RELAY.COMPACT_UP) : ms(RELAY.D_UP);
    const tRecv = reduced ? ms(RELAY.RED_RECV) : tUp + dUp;
    const tFire = reduced ? ms(RELAY.RED_FIRE) : compact ? tRecv + 40 : ms(RELAY.T_FIRE);
    const gap = reduced ? 0 : compact ? ms(RELAY.COMPACT_GAP) : ms(RELAY.GAP);
    const dDown = reduced ? ms(RELAY.RED_LAND - RELAY.RED_FIRE) : compact ? ms(RELAY.COMPACT_DOWN) : ms(RELAY.D_DOWN);
    const lead = reduced ? 0 : ms(RELAY.FLASH_LEAD);
    const store = this.engine.nodes;
    const tierOf = (p: Payee): Tier => TIER[p.tier ?? store.tier[store.slotOf(p.id)] ?? 0] ?? 'unknown';

    // Tell the ambient director first; ignoring its head start keeps the Beat on time.
    this.engine.announceBlock(ev);
    this.sink.beat({ height: ev.height, producer: ev.producer, producerTier: null, compact, reduced, emission: ev.emission === true });
    this.at(tUp, () => this.sink.uplink({ height: ev.height, from: ev.producer, durationMs: dUp }));
    this.at(tRecv, () => this.sink.moonFlare({ height: ev.height, durationMs: 900, compact }));
    DOWNLINK_ORDER.forEach((out, i) => {
      const t = tFire + i * gap;
      if (out === 'dev') {
        this.at(t - lead, () => this.sink.moonFlare({ height: ev.height, durationMs: 340, compact, piece: PIECE.dev }));
        this.at(t + ms(RELAY.FUND_AFTER), () => this.sink.devFund({ height: ev.height, amount: '0.50000000' }));
        return;
      }
      for (const p of ev.payees) {
        if (tierOf(p) !== out) continue;
        const amount = (p.amount ?? 0).toFixed(8);
        const mine = false;
        this.at(t - lead, () => this.sink.moonFlare({ height: ev.height, durationMs: 340, compact, piece: PIECE[out] }));
        this.at(t, () => this.sink.downlink({ height: ev.height, to: p.id, tier: out, amount, durationMs: dDown, order: i, mine }));
        this.at(t + dDown - (reduced ? 0 : ms(RELAY.LAND_EARLY)), () =>
          this.sink.payoutLanded({ height: ev.height, node: p.id, tier: out, amount, mine, highlightMs: reduced ? 1200 : null }),
        );
      }
    });
    // Heartbeats spread over 2 to 4 s, in tenth-of-a-second batches.
    if (!compact && ev.confirms && ev.confirms.length > 0) {
      const ids = Array.from(ev.confirms);
      const ticks = 20;
      for (let k = 0; k < ticks; k++) {
        const batch = ids.filter((_, j) => j % ticks === k);
        if (batch.length) this.at(1600 + k * 100, () => this.sink.heartbeats({ height: ev.height, nodes: batch }));
      }
    }
    // The next payees resolve at 2.6 s.
    this.at(ms(RELAY.T_AIM), () => this.aimNow());
  }

  /** The next block's payees are known; they are aimed once the landing has played (or right away when idle). */
  nextPayees(height: number, payees: Payee[], etaMs = 30000): void {
    this.aimed = payees;
    this.aimHeight = height;
    this.aimEta = etaMs;
    if (performance.now() - this.lastBeat > RELAY.T_AIM * 1000) this.aimNow();
  }

  private aimNow(): void {
    const p = this.aimed;
    if (!p) return;
    const store = this.engine.nodes;
    this.sink.aim({
      height: this.aimHeight,
      etaMs: this.aimEta,
      mine: [],
      payees: p.map((x) => ({ tier: TIER[x.tier ?? store.tier[store.slotOf(x.id)] ?? 0] ?? 'unknown', node: x.id, amount: x.amount })),
    });
  }

  dispose(): void {
    for (const h of this.timers) window.clearTimeout(h);
    this.timers.clear();
  }
}
