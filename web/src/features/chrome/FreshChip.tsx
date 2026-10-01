// A freshness chip for one data source (design 4.4, 8.8): a dot, the data's name and its age, judged against
// how often the data is expected to refresh. The window title bars use it for the window's own data; the
// same rule as the status bar's chips (fresh, aging, stale, dead). Seconds come from the shared 1 Hz clock.

import { useRuntime } from '../../app/context';
import { freshness } from '../../lib/clock';
import { formatAge, UNKNOWN } from '../../lib/format';
import { useNow } from '../../lib/useClock';
import './freshchip.css';

export interface FreshChipProps {
  label: string;
  /** When the newest data arrived (server-corrected ms), or null when it is not known. */
  evidenceMs: number | null;
  cadenceMs: number;
  className?: string;
}

const WORD = { stale: 'stale', dead: 'dead' } as const;

export function FreshChip({ label, evidenceMs, cadenceMs, className }: FreshChipProps) {
  const { clock } = useRuntime();
  const now = useNow(clock);
  const age = evidenceMs === null ? null : Math.max(0, now - evidenceMs);
  const state = age === null ? 'unknown' : freshness(age, cadenceMs);
  const word = state === 'stale' || state === 'dead' ? WORD[state] : null;
  return (
    <span className={className ? `fresh-chip ${className}` : 'fresh-chip'} data-state={state}>
      <i aria-hidden="true" />
      <span className="fresh-label">{label}</span>
      <span className="fresh-age">{age === null ? UNKNOWN : formatAge(age)}</span>
      {word ? <em>{word}</em> : null}
    </span>
  );
}
