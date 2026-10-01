import { formatUtcTime, UNKNOWN } from '../../lib/format';

/** `2026-09-30 19:39:04 UTC`: the absolute companion of a relative time (tooltips, `title`). */
export function formatUtcStamp(ms: number | null | undefined, fallback = UNKNOWN): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback;
  return `${new Date(ms).toISOString().slice(0, 10)} ${formatUtcTime(ms)}`;
}

/** ISO 8601 for a `<time dateTime>` attribute, or undefined for an unusable timestamp. */
export function isoOrUndefined(ms: number | null | undefined): string | undefined {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}
