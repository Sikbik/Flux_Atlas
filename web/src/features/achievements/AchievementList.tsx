// The twenty-four, as a quiet list: what each one asks, when it was found, how far a counted one has got.
// Hidden ones stay a mystery until found. Everything here is read from this browser's own record.

import type { CSSProperties } from 'react';
import { AchievementGlyph } from './AchievementIcon';
import { ACHIEVEMENT_COUNT, ACHIEVEMENTS, type AchievementDef } from './catalog';
import { type Progress, unlockedCount, useAchievements } from './state';
import './achievements.css';

const when = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** How far a counted achievement has got, or null for the single-step ones. */
function progressOf(a: AchievementDef, p: Progress): number | null {
  switch (a.id) {
    case 'six-continents':
      return p.continents.length;
    case 'witness':
      return p.blocks;
    case 'palette-native':
      return p.paletteKeys;
    case 'shell-script':
      return p.commands;
    default:
      return null;
  }
}

/** `3 of 24`, with a hairline that fills as they are found. */
export function AchievementCount({ className }: { className?: string }) {
  const unlocked = useAchievements((s) => s.unlocked);
  const n = unlockedCount({ unlocked });
  return (
    <span
      className={`ach-count${className ? ` ${className}` : ''}`}
      style={{ '--f': n / ACHIEVEMENT_COUNT } as CSSProperties}
    >
      <span className="ach-count-t">
        <b>{n}</b> of {ACHIEVEMENT_COUNT}
      </span>
      <span className="ach-count-bar" aria-hidden="true">
        <i />
      </span>
    </span>
  );
}

export function AchievementList() {
  const unlocked = useAchievements((s) => s.unlocked);
  const progress = useAchievements((s) => s.progress);
  return (
    <ol className="ach-list">
      {ACHIEVEMENTS.map((a) => {
        const at = unlocked[a.id];
        const done = at !== undefined;
        const mystery = a.hidden === true && !done;
        const have = progressOf(a, progress);
        return (
          <li key={a.id} className="ach" data-state={done ? 'done' : mystery ? 'hidden' : 'todo'}>
            <span className="ach-ic" aria-hidden="true">
              <AchievementGlyph icon={a.icon} size={15} />
            </span>
            <span className="ach-body">
              <span className="ach-name">{mystery ? 'Hidden' : a.name}</span>
              <span className="ach-how">
                {mystery ? 'Somewhere in the product, there is one more.' : a.how}
              </span>
            </span>
            <span className="ach-meta">
              {done ? (
                <time dateTime={new Date(at).toISOString()}>{when.format(at)}</time>
              ) : have !== null && a.goal ? (
                <span className="ach-prog">
                  {Math.min(have, a.goal)} of {a.goal}
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
