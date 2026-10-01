// The mempool as one list. `GET /mempool` is the authoritative snapshot (refetched by the shared live
// invalidator, throttled to 5 s); the socket adds transactions the moment they appear. The two merge
// by txid without touching the shared store: a socket entry that predates the snapshot and is not in
// it was mined, so it drops out.

import { useMemo } from 'react';
import type { TxLite } from '../../../api/generated/TxLite';
import { useMempool } from '../../../api/queries';
import { useMempoolEntries } from '../../../app/context';
import { anyUnknownSize } from '../lib/txsize';

export interface MempoolRow {
  tx: TxLite;
  /** Server time the socket first saw it; null when it was already pending before we connected. */
  firstSeenMs: number | null;
}

export function useMempoolLive() {
  const q = useMempool();
  const live = useMempoolEntries();
  const snap = q.data;
  const rows = useMemo<MempoolRow[]>(() => {
    const seen = new Map(live.map((e) => [e.tx.txid, e.firstSeenMs]));
    const out: MempoolRow[] = [];
    const have = new Set<string>();
    if (snap) {
      for (const tx of snap.txs) {
        out.push({ tx, firstSeenMs: seen.get(tx.txid) ?? null });
        have.add(tx.txid);
      }
    }
    for (const e of live) {
      if (have.has(e.tx.txid)) continue;
      if (snap && e.firstSeenMs < snap.updated_ms - 2_000) continue;
      out.push({ tx: e.tx, firstSeenMs: e.firstSeenMs });
    }
    // Newest first; entries without a first-seen time keep the server order after the dated ones.
    return out
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (b.r.firstSeenMs ?? -1) - (a.r.firstSeenMs ?? -1) || a.i - b.i)
      .map((x) => x.r);
  }, [snap, live]);
  const bytes = snap ? snap.bytes : null;
  // `bytes` adds up the sizes the server knows; with an unknown one in the list it is a floor.
  const bytesPartial = useMemo(() => anyUnknownSize(rows.map((r) => r.tx.size)), [rows]);
  return {
    ...q,
    rows,
    size: Math.max(snap?.size ?? 0, rows.length),
    bytes,
    bytesPartial,
    updatedMs: snap?.updated_ms ?? null,
  };
}
