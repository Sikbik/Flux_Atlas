import { useRuntime } from '../../../app/context';
import { useNow } from '../../../lib/useClock';
import { etaClock } from '../../inspect/derive/eta';

/**
 * A countdown to a moment, ticking on the shared clock: `2h 14m`, `3m 05s`, `28s`. It is a leaf, so only
 * this text re-renders each second. A moment already past reads `now`.
 */
export function Eta({ at, className }: { at: number | null | undefined; className?: string }) {
  const { clock } = useRuntime();
  const now = useNow(clock);
  if (at === null || at === undefined || !Number.isFinite(at))
    return <span className={className}>Unknown</span>;
  if (at <= now) return <span className={className}>now</span>;
  const c = etaClock(at - now);
  return (
    <span className={className}>
      <span className="ui-sr-only">{c.phrase}</span>
      <span aria-hidden="true">
        {c.a}
        <i className="wl-unit">{c.aUnit}</i>
        {c.b !== undefined ? (
          <>
            {' '}
            {c.b}
            <i className="wl-unit">{c.bUnit}</i>
          </>
        ) : null}
      </span>
    </span>
  );
}
