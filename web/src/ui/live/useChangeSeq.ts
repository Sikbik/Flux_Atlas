import { useState } from 'react';
import { type FlashDirection, type FlashValue, flashDirection } from './flash';

export interface ChangeSeq {
  /** 0 until the value first changes after mount, then increments with every change. */
  seq: number;
  /** The direction of the last change when both values were numbers. */
  dir: FlashDirection;
}

/**
 * Counts changes of a primitive value after mount. The count is advanced while rendering (React's
 * documented way to derive state from a previous render), so whatever reacts to it appears in the
 * same commit as the new value, with no extra paint and no effect.
 */
export function useChangeSeq(value: FlashValue): ChangeSeq {
  const [state, setState] = useState({ prev: value, seq: 0, dir: null as FlashDirection });
  if (!Object.is(state.prev, value)) {
    setState({ prev: value, seq: state.seq + 1, dir: flashDirection(state.prev, value) });
  }
  return state;
}
