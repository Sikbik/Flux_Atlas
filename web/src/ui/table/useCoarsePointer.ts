import { useSyncExternalStore } from 'react';

const QUERY = '(pointer: coarse)';

function subscribe(cb: () => void): () => void {
  if (typeof matchMedia !== 'function') return () => {};
  const mq = matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

const snapshot = () => (typeof matchMedia === 'function' ? matchMedia(QUERY).matches : false);

/** True when the primary pointer is coarse (touch): rows that act as buttons grow to the 40 px touch minimum. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
