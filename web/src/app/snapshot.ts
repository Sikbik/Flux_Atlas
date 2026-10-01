// Fetches the three snapshot bodies of a resync (ARCHITECTURE 8.1) and makes sure they come from one
// origin. The domain balances two independent instances, so `/bootstrap`, `/nodes.bin` and
// `/mesh.bin` can each reach a different one; their node ids and seqs would not fit together. A mixed
// set is discarded and fetched again with backoff, a bounded number of times, and never loaded.

import type { BootstrapDto } from '../api/generated/BootstrapDto';
import { isApiError } from '../api/http';
import type { MeshBin } from '../api/meshBin';
import type { NodesBin } from '../api/nodesBin';
import { snapshotOriginError } from '../store/network';

export interface SnapshotFetchers {
  bootstrap(signal: AbortSignal): Promise<BootstrapDto>;
  nodesBin(signal: AbortSignal): Promise<NodesBin>;
  meshBin(signal: AbortSignal): Promise<MeshBin>;
}

export interface Snapshot {
  bootstrap: BootstrapDto;
  nodes: NodesBin;
  /** null when the server has no mesh (404): it loads empty. */
  mesh: MeshBin | null;
}

/** Fetches after the first mixed set; the last one failing surfaces as a resync error. */
export const ORIGIN_RETRY_DELAYS_MS: readonly number[] = [250, 750, 2_000];

export class SnapshotOriginError extends Error {
  override name = 'SnapshotOriginError';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The mesh of a resync: a failure fails the resync (the live client retries it), except a 404 (a
 * server without the mesh), which loads an empty one. Keeping the old mesh while resuming from the
 * new seq would lose the edge changes in between.
 */
async function fetchMesh(f: SnapshotFetchers, signal: AbortSignal): Promise<MeshBin | null> {
  try {
    return await f.meshBin(signal);
  } catch (e) {
    if (isApiError(e) && e.status === 404) return null;
    throw e;
  }
}

/** Fetches bootstrap, nodes.bin and mesh.bin until all three share the bootstrap's origin. */
export async function fetchSnapshot(
  f: SnapshotFetchers,
  signal: AbortSignal,
  opts: { delaysMs?: readonly number[]; wait?: (ms: number, signal: AbortSignal) => Promise<void> } = {},
): Promise<Snapshot> {
  const delays = opts.delaysMs ?? ORIGIN_RETRY_DELAYS_MS;
  const wait = opts.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    const [bootstrap, nodes, mesh] = await Promise.all([
      f.bootstrap(signal),
      f.nodesBin(signal),
      fetchMesh(f, signal),
    ]);
    const mismatch = snapshotOriginError(bootstrap, nodes, mesh);
    if (mismatch === null) return { bootstrap, nodes, mesh };
    const delay = delays[attempt];
    if (delay === undefined) throw new SnapshotOriginError(`snapshots from different servers: ${mismatch}`);
    await wait(delay, signal);
  }
}
