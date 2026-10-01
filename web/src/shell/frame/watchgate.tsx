// The watchlist's alerts, mounted once for the shell's life. `WatchAlerts` (F3) raises a toast, and a browser
// notification for those who opted in, for every change to a node you watch: offline, near expiry, paid, a new
// address. It used to run only while the operator view was open, so a watched node could go offline with nobody
// told. Here it runs wherever you are, under the runtime and the router, and renders nothing.
//
// It is a lazy chunk and stays off the load path: it is fetched once the boot is over, never during it. It mounts
// whether or not anything is watched, on purpose: it runs one engine however many copies are mounted (the first
// to mount wins), and a copy that waited for the first watch could lose that race to the operator view's own copy,
// which would then take the engine with it when the window closed. With nothing watched it has nothing to look at.
// The shell mounts it beside the toast host, so the ambient route, which has no toasts, does not run it.

import { Suspense } from 'react';
import { useBootPhase } from '../../features/chrome/boot/state';
import { WatchAlerts } from '../../views/inspect';

export function WatchAlertsGate() {
  const booted = useBootPhase() === 'done';
  if (!booted) return null;
  return (
    <Suspense fallback={null}>
      <WatchAlerts />
    </Suspense>
  );
}
