// Small pieces the panels of the Apps hub share: the minute the lists' "about 3 hours ago" are worked out at, whether an
// endpoint is still being read by the server, the words of a panel's error, an owner's id, and the jump from a tile to a
// section of the same hub.

import { useRouter } from '@tanstack/react-router';
import { type MouseEvent, useCallback, useSyncExternalStore } from 'react';
import { useRuntime } from '../../../app/context';
import { shortAddress } from '../../../lib/format';
import { isFilling } from '../api';
import './apps.css';

const MINUTE = 60_000;

/**
 * Server time at the start of the current minute. The lists word their times to the minute ("about 3 hours ago"), so a
 * panel that reads it re-renders once a minute and never once a second.
 */
export function useMinute(): number {
  const { clock } = useRuntime();
  const subscribe = useCallback((cb: () => void) => clock.subscribe(cb), [clock]);
  const get = () => Math.floor(clock.now() / MINUTE) * MINUTE;
  return useSyncExternalStore(subscribe, get, get);
}

/** True while a query that fills is waiting on the server's first read: its 503 is being asked again. */
export function isWaiting(q: { isPending: boolean; failureReason: unknown }): boolean {
  return q.isPending && isFilling(q.failureReason);
}

/** The error title and text of a panel: a 503 is the server still reading, anything else is a failure. */
export function panelError(error: unknown, what: string): { errorTitle: string; errorText: string } {
  return isFilling(error)
    ? {
        errorTitle: 'The numbers are still being read',
        errorText: 'The server is reading the network for the first time; try again in a moment.',
      }
    : {
        errorTitle: `Could not load ${what}`,
        errorText: "This comes from the server's own view of the network; try again in a moment.",
      };
}

/** An owner's id (a ZelID, usually) shortened, in the data face, with the whole id on hover. */
export function OwnerId({ id }: { id: string }) {
  return (
    <span className="ap-id" title={id}>
      {shortAddress(id)}
    </span>
  );
}

/**
 * The click handler of a tile that leads to a section of this hub (`/apps#owners`): the section is scrolled to in
 * place and the fragment is set, keeping every window already open. With a modified click the link works as a link.
 */
export function useJump(): (id: string) => (e: MouseEvent<HTMLAnchorElement>) => void {
  const router = useRouter();
  return useCallback(
    (id: string) => (e: MouseEvent<HTMLAnchorElement>) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (router.state.location.hash === id) {
        document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      // The hash changes, and `useHashAnchor` scrolls to it (gliding, or at once when motion is reduced).
      void router.navigate({
        to: '.',
        hash: id,
        replace: true,
        search: (prev: Record<string, unknown>) => prev,
      } as never);
    },
    [router],
  );
}
