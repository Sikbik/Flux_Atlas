// A release replaces the build under an open page. On Flux the two instances take a new image hours apart
// and the balancer can move a visitor between them, so a code chunk the page asks for later may no longer
// exist where the request lands (a 404). Vite reports that as `vite:preloadError`; the fix is one fresh page
// load, which fetches the current build whole. A second failure within the guard window is a real error and
// shows, so a chunk that is truly missing never turns into a reload loop.

const KEY = 'atlas:stale-reload';
/** A reload for a stale build happens at most once in this window. */
export const STALE_RELOAD_WINDOW_MS = 30_000;

let reloading = false;

/** True for the errors a missing or unfetchable code chunk produces in Chromium, Firefox and Safari. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError/i.test(
    msg,
  );
}

/** Whether a reload for a stale build is under way, so views show the update instead of a failure. */
export function isReloadingForUpdate(): boolean {
  return reloading;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function session(): Store | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reloads the page for a stale build unless one already happened within the window. Returns false, and
 * leaves the error to show, when that guard cannot be kept (no session storage) or a reload just happened.
 */
export function reloadForUpdate(
  now = Date.now(),
  store: Store | null = session(),
  reload: () => void = () => location.reload(),
): boolean {
  if (!store) return false;
  try {
    const last = Number(store.getItem(KEY)) || 0;
    if (now - last < STALE_RELOAD_WINDOW_MS) return false;
    store.setItem(KEY, String(now));
  } catch {
    return false;
  }
  reloading = true;
  reload();
  return true;
}

/** Listens for Vite's chunk load failures and answers each with one guarded reload. */
export function installStaleBuildRecovery(target: Window = window): void {
  target.addEventListener('vite:preloadError', (e) => {
    if (reloadForUpdate()) e.preventDefault();
  });
}
