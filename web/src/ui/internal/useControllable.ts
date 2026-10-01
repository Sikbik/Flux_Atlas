import { useCallback, useRef, useState } from 'react';

/**
 * State that is controlled when `controlled` is not undefined and uncontrolled otherwise (the usual
 * `value`/`defaultValue`/`onChange` contract). Returns the current value and a setter that always
 * calls `onChange`, and updates local state only when uncontrolled.
 */
export function useControllableState<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const isControlled = controlled !== undefined;
  const latest = useRef({ isControlled, onChange });
  latest.current = { isControlled, onChange };
  const set = useCallback((next: T) => {
    if (!latest.current.isControlled) setInner(next);
    latest.current.onChange?.(next);
  }, []);
  return [isControlled ? (controlled as T) : inner, set];
}
