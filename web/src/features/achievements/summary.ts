// The achievements as terminal lines: what `achievements` prints. Hidden ones stay a mystery until found.

import { dim, type Span, sp, val } from '../command/terminal/output';
import { ACHIEVEMENT_COUNT, ACHIEVEMENTS } from './catalog';
import { unlockedCount, useAchievements } from './state';

export function achievementLines(): Span[][] {
  const s = useAchievements.getState();
  const n = unlockedCount(s);
  const w = Math.max(...ACHIEVEMENTS.map((a) => a.name.length)) + 2;
  const rows: Span[][] = [
    [val(`${n} of ${ACHIEVEMENT_COUNT}`), sp(' found. They stay in this browser and nowhere else.')],
    [],
  ];
  for (const a of ACHIEVEMENTS) {
    const done = s.unlocked[a.id] !== undefined;
    const name = a.hidden && !done ? '???' : a.name;
    const text = a.hidden && !done ? 'Hidden' : a.how;
    rows.push([
      done ? { t: '[x] ', s: 'ok' } : dim('[ ] '),
      done ? val(name.padEnd(w)) : dim(name.padEnd(w)),
      done ? sp(text) : dim(text),
    ]);
  }
  rows.push([], [dim('Settings lists them with their dates.')]);
  return rows;
}
