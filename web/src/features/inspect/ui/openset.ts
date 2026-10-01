import { useCallback, useState } from 'react';

const remembered = new Map<string, Set<string>>();

/**
 * Which sections of a view are open. The choice outlives the window (it is kept for the session, per
 * `scope`), so browsing one node after another keeps the sections you opened open.
 */
export function useOpenSet(scope: string, initial: readonly string[] = []) {
  const [, bump] = useState(0);
  let set = remembered.get(scope);
  if (!set) {
    set = new Set(initial);
    remembered.set(scope, set);
  }
  const live = set;
  const isOpen = useCallback((id: string) => live.has(id), [live]);
  const setOpen = useCallback(
    (id: string, next: boolean) => {
      if (next) live.add(id);
      else live.delete(id);
      bump((n) => n + 1);
    },
    [live],
  );
  return { isOpen, setOpen };
}

export type OpenSet = ReturnType<typeof useOpenSet>;
