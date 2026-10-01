// Keeps the screen on while ambient mode is up (a TV left on a Flux channel should not go to sleep halfway
// through a block). The Screen Wake Lock API releases its lock whenever the tab is hidden, so it is taken
// again when the tab comes back. Where the API is missing, or the browser refuses (battery saver), the
// page simply behaves as it did before: nothing breaks and nothing is shown.

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

const apiOf = (): WakeLockApi | null => {
  if (typeof navigator === 'undefined') return null;
  const wl = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
  return wl ?? null;
};

/** Takes the lock now and whenever it is lost; returns the function that lets it go. */
export function keepScreenAwake(): () => void {
  const api = apiOf();
  if (!api) return () => undefined;
  let sentinel: Sentinel | null = null;
  let stopped = false;
  let pending = false;

  const take = async () => {
    if (stopped || pending || sentinel || document.visibilityState !== 'visible') return;
    pending = true;
    try {
      const s = await api.request('screen');
      if (stopped) {
        void s.release();
        return;
      }
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // Refused (low battery, a policy, no user activation yet): try again when the tab is shown again.
    } finally {
      pending = false;
    }
  };

  const onVisible = () => {
    if (document.visibilityState === 'visible') void take();
  };
  document.addEventListener('visibilitychange', onVisible);
  void take();

  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisible);
    const s = sentinel;
    sentinel = null;
    if (s) void s.release().catch(() => undefined);
  };
}
