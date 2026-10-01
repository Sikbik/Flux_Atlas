// The frame's keyboard map (design 10.4): single letters run the launchers, ignored while a text field has
// focus, while the palette is open, and when a modifier is held (Ctrl or Cmd and K belong to the palette,
// Alt combinations to the window manager). Every dock item shows its key; this binds them.

import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { LAUNCHERS, type LauncherId, type RunLauncher } from './launchers';

/** The launcher a key stands for, or null. `shift` selects the shifted binding (Shift and A: ambient). */
export function launcherForKey(key: string, shift: boolean): LauncherId | null {
  if (shift) return key === 'A' ? 'ambient' : null;
  const k = key.length === 1 ? key.toLowerCase() : key;
  for (const l of Object.values(LAUNCHERS)) if (l.key !== null && l.key.toLowerCase() === k) return l.id;
  return null;
}

/** Whether the event came from somewhere text is typed. */
export function isTextTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'image', 'color'].includes(
    type,
  );
}

/** Runs launchers from the keyboard while `enabled`. */
export function useShellKeys(launch: RunLauncher, enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (isTextTarget(e.target)) return;
      // The palette is open while the URL carries `q` (even empty).
      if (Object.hasOwn(router.state.location.search as object, 'q')) return;
      const id = launcherForKey(e.key, e.shiftKey);
      if (!id) return;
      e.preventDefault();
      launch(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, launch, enabled]);
}
