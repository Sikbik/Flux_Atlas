// Click-through from a chart to the filtered globe. The filter lives in the URL (`tier`, `cc`, `org`,
// `ver`), so the globe behind the window follows, the filtered view can be shared, and the chart that
// set it can show it as selected. Toggling the value that is already set clears it.

import { useNavigate, useSearch } from '@tanstack/react-router';
import { useCallback } from 'react';

export type FilterKey = 'tier' | 'cc' | 'org' | 'ver';

const text = (v: unknown): string | null =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null;

export interface GlobeFilter {
  tier: string | null;
  cc: string | null;
  org: string | null;
  ver: string | null;
  /** Sets one filter, or clears it with null. History is replaced, so charts do not fill the back stack. */
  set: (key: FilterKey, value: string | null) => void;
  /** Sets the filter, or clears it when it already has this value. */
  toggle: (key: FilterKey, value: string) => void;
  /** Clears all four. */
  clear: () => void;
}

export function useGlobeFilter(): GlobeFilter {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();
  const tier = text(search.tier);
  const cc = text(search.cc);
  const org = text(search.org);
  const ver = text(search.ver);
  const set = useCallback(
    (key: FilterKey, value: string | null) => {
      void navigate({
        to: '.',
        replace: true,
        search: (prev: Record<string, unknown>) => ({ ...prev, [key]: value ?? undefined }),
      } as never);
    },
    [navigate],
  );
  const toggle = useCallback(
    (key: FilterKey, value: string) => {
      const now = { tier, cc, org, ver }[key];
      set(key, now === value ? null : value);
    },
    [set, tier, cc, org, ver],
  );
  const clear = useCallback(() => {
    void navigate({
      to: '.',
      replace: true,
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        tier: undefined,
        cc: undefined,
        org: undefined,
        ver: undefined,
      }),
    } as never);
  }, [navigate]);
  return { tier, cc, org, ver, set, toggle, clear };
}
