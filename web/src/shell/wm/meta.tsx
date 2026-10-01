// What a window tells its frame about itself (design 8.3): a second line under the title, whether the title
// is an address or an id (set in the mono face), the tier a node window wears, and the window's own
// freshness chip. The content calls `useWindowMeta` from anywhere inside the window; the frame draws it.
// The title itself stays with the window manager (`setTitle`).

import { createContext, useContext, useEffect } from 'react';

export type WindowTier = 'cumulus' | 'nimbus' | 'stratus' | 'unknown';
export type WindowAccent = 'chain' | 'app' | 'analytics' | 'time' | 'operator' | 'terminal' | 'pulse';

/** The freshness chip in a title bar ("nodes 4 s"): one rule for every chip (design 4.4). */
export interface WindowFresh {
  /** The data the window shows, in one word: `nodes`, `tip`, `apps`. */
  label: string;
  /** When the newest data behind the window arrived (server-corrected ms), or null when it is not known. */
  evidenceMs: number | null;
  /** How often that data is expected to refresh, in ms; the age is judged against it. */
  cadenceMs: number;
}

export interface WindowMeta {
  /** A line under the title saying what the window is about ("Stratus node, Helsinki"). */
  subtitle?: string;
  /** Set the title in the mono face: IP addresses, ids, hashes. */
  mono?: boolean;
  /** Node windows wear their tier: its colour and its capsule glyph in the title bar. */
  tier?: WindowTier;
  /** A Flux blue tone or white, when the type's default is not right. */
  accent?: WindowAccent;
  fresh?: WindowFresh;
}

export interface WindowMetaSink {
  set(meta: WindowMeta | null): void;
}

export const WindowMetaContext = createContext<WindowMetaSink | null>(null);

export function metaEqual(a: WindowMeta | null, b: WindowMeta | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.subtitle === b.subtitle &&
    a.mono === b.mono &&
    a.tier === b.tier &&
    a.accent === b.accent &&
    a.fresh?.label === b.fresh?.label &&
    a.fresh?.evidenceMs === b.fresh?.evidenceMs &&
    a.fresh?.cadenceMs === b.fresh?.cadenceMs
  );
}

/**
 * Tells the window's frame what to show in its title bar. Call it from the window's content; it clears
 * when the content unmounts. Pass the same values on every render: only changes are applied.
 */
export function useWindowMeta(meta: WindowMeta): void {
  const sink = useContext(WindowMetaContext);
  const { subtitle, mono, tier, accent } = meta;
  const label = meta.fresh?.label;
  const evidenceMs = meta.fresh?.evidenceMs ?? null;
  const cadenceMs = meta.fresh?.cadenceMs;
  useEffect(() => {
    if (!sink) return;
    const next: WindowMeta = {};
    if (subtitle !== undefined) next.subtitle = subtitle;
    if (mono !== undefined) next.mono = mono;
    if (tier !== undefined) next.tier = tier;
    if (accent !== undefined) next.accent = accent;
    if (label !== undefined && cadenceMs !== undefined) next.fresh = { label, evidenceMs, cadenceMs };
    sink.set(next);
  }, [sink, subtitle, mono, tier, accent, label, evidenceMs, cadenceMs]);
  useEffect(() => () => sink?.set(null), [sink]);
}
