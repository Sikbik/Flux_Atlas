// Preferences owned by the command and delight features, persisted per browser. The shared UI
// preferences (motion, performance tier, art style, the watchlist) stay in `store/ui.ts`; this holds
// the ambient idle timeout, ambient sound and the notification opt-in.
//
// Contract for the watchlist (F3): browser notifications are allowed only when the browser has granted
// permission AND the user left the opt-in on. `canNotify()` answers both; `notify()` raises one.

import { create } from 'zustand';

/** Idle timeouts offered in Settings, in minutes. 0 means never. */
export const IDLE_OPTIONS_MIN = [0, 1, 2, 5, 10, 15, 30] as const;
/** Five minutes: long enough that reading a table never trips it, short enough to be a screensaver. */
export const DEFAULT_IDLE_MIN = 5;

const KEY = 'atlas.prefs.v1';

export interface PrefsData {
  /** Minutes without input before ambient mode starts; 0 disables it. */
  ambientIdleMin: number;
  /** Generative sound in ambient mode (off by default, needs a user gesture to start). */
  ambientSound: boolean;
  /** The user's opt-in for browser notifications (the browser permission is separate). */
  notifications: boolean;
}

export interface PrefsState extends PrefsData {
  setAmbientIdleMin(minutes: number): void;
  setAmbientSound(on: boolean): void;
  setNotifications(on: boolean): void;
}

export const DEFAULT_PREFS: PrefsData = {
  ambientIdleMin: DEFAULT_IDLE_MIN,
  ambientSound: false,
  notifications: false,
};

/** Reads and validates stored preferences; anything malformed falls back to the default. */
export function parsePrefs(raw: string | null | undefined): PrefsData {
  const out: PrefsData = { ...DEFAULT_PREFS };
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof v.ambientIdleMin === 'number' &&
      (IDLE_OPTIONS_MIN as readonly number[]).includes(v.ambientIdleMin)
    )
      out.ambientIdleMin = v.ambientIdleMin;
    if (typeof v.ambientSound === 'boolean') out.ambientSound = v.ambientSound;
    if (typeof v.notifications === 'boolean') out.notifications = v.notifications;
  } catch {
    // Corrupt storage: use the defaults.
  }
  return out;
}

function load(): PrefsData {
  try {
    return parsePrefs(globalThis.localStorage?.getItem(KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function save(s: PrefsData): void {
  try {
    globalThis.localStorage?.setItem(
      KEY,
      JSON.stringify({
        ambientIdleMin: s.ambientIdleMin,
        ambientSound: s.ambientSound,
        notifications: s.notifications,
      }),
    );
  } catch {
    // Storage unavailable (private mode, quota): preferences last for the session only.
  }
}

export const usePrefs = create<PrefsState>()((set, get) => ({
  ...load(),
  setAmbientIdleMin: (ambientIdleMin) => {
    set({ ambientIdleMin });
    save(get());
  },
  setAmbientSound: (ambientSound) => {
    set({ ambientSound });
    save(get());
  },
  setNotifications: (notifications) => {
    set({ notifications });
    save(get());
  },
}));

// ---------------------------------------------------------------------------------------------
// Browser notifications
// ---------------------------------------------------------------------------------------------

export type NotificationSupport = 'unsupported' | 'default' | 'granted' | 'denied';

/** The browser's notification permission, or `unsupported` where the API does not exist. */
export function notificationSupport(): NotificationSupport {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** True when the browser granted permission and the user left the opt-in on. */
export function canNotify(): boolean {
  return notificationSupport() === 'granted' && usePrefs.getState().notifications;
}

/**
 * Raises a browser notification when `canNotify()`. Returns the notification, or null when it is not
 * allowed (nothing is sent anywhere: notifications are local to this browser).
 */
export function notify(title: string, body?: string, opts: { tag?: string; onClick?: () => void } = {}) {
  if (!canNotify()) return null;
  try {
    const n = new Notification(title, {
      ...(body ? { body } : {}),
      ...(opts.tag ? { tag: opts.tag } : {}),
      icon: `${import.meta.env.BASE_URL}brand/Flux_symbol-mark_blue.svg`,
    });
    if (opts.onClick) {
      const click = opts.onClick;
      n.onclick = () => {
        window.focus();
        click();
        n.close();
      };
    }
    return n;
  } catch {
    return null;
  }
}

/** Asks for permission from a click handler. Resolves to the resulting permission. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') usePrefs.getState().setNotifications(true);
    return result;
  } catch {
    return notificationSupport();
  }
}
