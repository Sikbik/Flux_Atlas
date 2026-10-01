// The twenty-four achievements (design 9.9). Local only: nothing here, and nothing the tracker records,
// leaves the browser. They teach features; none reward grinding. The words are the product's dry voice:
// `how` says what to do (the list), `said` is the sentence in the toast.

export type AchievementIcon =
  | 'mark'
  | 'server'
  | 'globe'
  | 'zoom-in'
  | 'network'
  | 'boxes'
  | 'history'
  | 'rewind'
  | 'blocks'
  | 'coins'
  | 'crosshair'
  | 'orbit'
  | 'clock'
  | 'trending-down'
  | 'wifi'
  | 'command'
  | 'circle-dashed'
  | 'square-terminal'
  | 'activity'
  | 'eye'
  | 'user-round-check'
  | 'link'
  | 'sliders-horizontal'
  | 'sparkles';

export interface AchievementDef {
  id: string;
  /** Position in the list, 1 to 24. */
  n: number;
  name: string;
  /** What to do, in the list. */
  how: string;
  /** The dry sentence in the toast. */
  said: string;
  icon: AchievementIcon;
  /** Counted achievements show progress ("3 of 10") until they unlock. */
  goal?: number;
  /** Shown as a mystery until found. */
  hidden?: boolean;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-contact',
    n: 1,
    name: 'First contact',
    how: 'Open About Flux through the moon',
    said: 'You opened the moon.',
    icon: 'mark',
  },
  {
    id: 'hello-node',
    n: 2,
    name: 'Hello, node',
    how: 'Open a node inspector',
    said: 'You said hello to a node. It did not say anything back.',
    icon: 'server',
  },
  {
    id: 'six-continents',
    n: 3,
    name: 'Six continents',
    how: 'Open nodes on six continents',
    said: 'Six continents, one network.',
    icon: 'globe',
    goal: 6,
  },
  {
    id: 'close-up',
    n: 4,
    name: 'Close up',
    how: 'Zoom the globe in to city level',
    said: 'That is a city. Those are servers.',
    icon: 'zoom-in',
  },
  {
    id: 'fan-out',
    n: 5,
    name: 'Fan out',
    how: 'Open a host to see every node on it',
    said: 'One address, a whole fan of nodes.',
    icon: 'network',
  },
  {
    id: 'constellation',
    n: 6,
    name: 'Constellation',
    how: 'Open an app to see where it runs',
    said: 'An app, drawn as the stars it runs on.',
    icon: 'boxes',
  },
  {
    id: 'archaeologist',
    n: 7,
    name: 'Archaeologist',
    how: "Open a spec diff in an app's history",
    said: "You read an app's old specs. Nobody asked you to.",
    icon: 'history',
  },
  {
    id: 'time-traveller',
    n: 8,
    name: 'Time traveller',
    how: 'Use the time machine',
    said: 'The network, but earlier.',
    icon: 'rewind',
  },
  {
    id: 'witness',
    n: 9,
    name: 'Witness',
    how: 'Watch ten blocks land in one visit',
    said: 'Ten blocks, in person.',
    icon: 'blocks',
    goal: 10,
  },
  {
    id: 'payday',
    n: 10,
    name: 'Payday',
    how: 'See a payment land on a node you watch',
    said: 'A node you watch just got paid.',
    icon: 'coins',
  },
  {
    id: 'on-target',
    n: 11,
    name: 'On target',
    how: 'Watch a block land on a payee the globe had aimed at',
    said: 'The reticle was right.',
    icon: 'crosshair',
  },
  {
    id: 'night-shift',
    n: 12,
    name: 'Night shift',
    how: 'Leave ambient mode running for ten minutes',
    said: 'Ten quiet minutes with the planet.',
    icon: 'orbit',
  },
  {
    id: 'running-late',
    n: 13,
    name: 'Running late',
    how: 'See a block take more than 35 seconds',
    said: 'That block took its time.',
    icon: 'clock',
  },
  {
    id: 'before-and-after',
    n: 14,
    name: 'Before and after',
    how: 'Be present when the first reward cut lands',
    said: 'You were here when the reward changed.',
    icon: 'trending-down',
  },
  {
    id: 'reconnected',
    n: 15,
    name: 'Reconnected',
    how: 'Lose the live stream and keep the page open',
    said: 'The stream dropped and came back. So did you.',
    icon: 'wifi',
  },
  {
    id: 'palette-native',
    n: 16,
    name: 'Palette native',
    how: 'Open the palette with the keyboard ten times',
    said: 'Ten times from the keyboard. You live here now.',
    icon: 'command',
    goal: 10,
  },
  {
    id: 'the-queue',
    n: 17,
    name: 'The queue',
    how: 'Open the payment queue',
    said: 'Everyone is paid in turn. This is the turn.',
    icon: 'circle-dashed',
  },
  {
    id: 'shell-script',
    n: 18,
    name: 'Shell script',
    how: 'Run ten terminal commands',
    said: 'Ten commands. It is a shell, after all.',
    icon: 'square-terminal',
    goal: 10,
  },
  {
    id: 'tail-f',
    n: 19,
    name: 'Tail -f',
    how: 'Run a streaming command in the terminal',
    said: 'Following along, one line at a time.',
    icon: 'activity',
  },
  {
    id: 'watcher',
    n: 20,
    name: 'Watcher',
    how: 'Watch a node',
    said: 'Now you will know when it is paid.',
    icon: 'eye',
  },
  {
    id: 'landlord',
    n: 21,
    name: 'Landlord',
    how: 'Open an operator view',
    said: 'Whose nodes are these? Now you know.',
    icon: 'user-round-check',
  },
  {
    id: 'link-sharer',
    n: 22,
    name: 'Link sharer',
    how: 'Copy a link to a view',
    said: 'That link holds the exact view you were on.',
    icon: 'link',
  },
  {
    id: 'keeping-it-calm',
    n: 23,
    name: 'Keeping it calm',
    how: 'Switch Motion to Reduced, or use lite mode',
    said: 'Calmer by choice. Noted.',
    icon: 'sliders-horizontal',
  },
  {
    id: 'easter-egg',
    n: 24,
    name: 'Easter egg',
    how: 'Find the hidden one',
    said: 'gm.',
    icon: 'sparkles',
    hidden: true,
  },
];

export const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;

const BY_ID: ReadonlyMap<string, AchievementDef> = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

export const achievementById = (id: string): AchievementDef | undefined => BY_ID.get(id);
