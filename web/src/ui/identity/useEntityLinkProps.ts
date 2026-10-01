import { useLinkProps } from '@tanstack/react-router';
import type { ForwardedRef } from 'react';
import { type EntityKind, entityRoute } from './entityRoute';

type LinkOptions = Parameters<typeof useLinkProps>[0];

// Selecting a node or host sets the selection through the path, so a stale `sel` must not survive.
const REPLACES_SELECTION: ReadonlySet<EntityKind> = new Set(['node', 'host']);

/**
 * The props for an `<a>` that opens an entity: spread them onto an anchor, then your own attributes.
 * By default the current camera, layers, filters and extra windows stay in the URL, as for every entity
 * link. Needs a router; render it only where `useRouter({ warn: false })` found one.
 */
export function useEntityLinkProps(
  kind: EntityKind,
  value: string,
  keepSearch = true,
  ref?: ForwardedRef<Element>,
) {
  const route = entityRoute(kind, value);
  const extra = 'search' in route ? route.search : null;
  const drop = REPLACES_SELECTION.has(kind);
  const search = keepSearch
    ? (prev: Record<string, unknown>) => ({ ...prev, ...(drop ? { sel: undefined } : null), ...extra })
    : (extra ?? {});
  return useLinkProps({ ...route, search } as unknown as LinkOptions, ref);
}
