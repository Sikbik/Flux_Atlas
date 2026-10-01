// Watchlist alert preferences (zustand, persisted under their own key so the shared UI store is left
// alone) and the browser's notification permission. Every storage and permission access is guarded: a
// private window or an old browser means "session only" and "not supported", never an error.

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { AlertKind } from '../derive/watch';
import { parsePrefs, type WatchPrefsData } from './model';

const KEY = 'atlas.watch.v1';

function load(): WatchPrefsData {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return parsePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return parsePrefs(null);
  }
}

function save(d: WatchPrefsData): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ notify: d.notify, kinds: d.kinds }));
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}

interface WatchPrefsState extends WatchPrefsData {
  setNotify(v: boolean): void;
  setKind(kind: AlertKind, v: boolean): void;
}

export const useWatchPrefs = create<WatchPrefsState>()((set, get) => ({
  ...load(),
  setNotify: (notify) => {
    set({ notify });
    save(get());
  },
  setKind: (kind, v) => {
    set({ kinds: { ...get().kinds, [kind]: v } });
    save(get());
  },
}));

export type PermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationPermission(): PermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Asks the browser for permission. Must be called from a click: browsers ignore it otherwise. */
export async function requestNotifications(): Promise<PermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return (await Notification.requestPermission()) as PermissionState;
  } catch {
    return notificationPermission();
  }
}

/** The current permission, re-read when the window regains focus (the user may change it in settings). */
export function useNotificationPermission(): [PermissionState, () => Promise<PermissionState>] {
  const [state, setState] = useState<PermissionState>(notificationPermission);
  useEffect(() => {
    const refresh = () => setState(notificationPermission());
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const request = async () => {
    const next = await requestNotifications();
    setState(next);
    return next;
  };
  return [state, request];
}
