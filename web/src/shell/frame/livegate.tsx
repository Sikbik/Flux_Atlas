// The Live sheet's gate: the sheet is its own chunk, fetched when the phone's frame mounts (after a pause, so the
// first paint is not competing with it) and at once when a finger goes down on the Live tab, which is a few
// hundred milliseconds before the tab's click.

import { lazyCard } from '../../features/chrome/lazyCard';

export const liveSheet = lazyCard(() => import('./LiveSheet').then((m) => m.LiveSheet));
