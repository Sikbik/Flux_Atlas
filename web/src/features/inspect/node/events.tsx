// A node's recent feed items as timeline rows: the kit's Timeline draws the thread, the time gutter and the
// markers; this maps each event kind to its icon and colour.

import {
  Activity,
  Ban,
  Boxes,
  Coins,
  Info,
  LogOut,
  type LucideIcon,
  Network,
  OctagonX,
  Play,
  Rocket,
  ShieldAlert,
  TriangleAlert,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { FeedItem } from '../../../api/generated/FeedItem';
import { formatInt } from '../../../lib/format';
import { Height, type TimelineItem } from '../../../ui';
import { describeFeedItem, type FeedIcon, type FeedTone } from '../derive/feed';

const ICONS: Record<FeedIcon, LucideIcon> = {
  join: Rocket,
  start: Play,
  heartbeat: Activity,
  paid: Coins,
  ip: Network,
  risk: TriangleAlert,
  expired: OctagonX,
  left: LogOut,
  dos: ShieldAlert,
  spent: Ban,
  offline: WifiOff,
  recovered: Wifi,
  app: Boxes,
  info: Info,
};

const TONES: Record<FeedTone, NonNullable<TimelineItem['tone']>> = {
  ok: 'ok',
  warn: 'warn',
  crit: 'crit',
  pay: 'accent',
  info: 'accent',
  muted: 'neutral',
};

/** Timeline rows for feed items, newest first as the server sends them. */
export function feedTimeline(items: readonly FeedItem[], limit = 8): TimelineItem[] {
  return items.slice(0, limit).map((item) => {
    const line = describeFeedItem(item);
    // "... at block 2,997,561": the height moves to the row's own block link.
    const suffix = line.height ? ` at block ${formatInt(line.height)}` : '';
    const title = suffix && line.text.endsWith(suffix) ? line.text.slice(0, -suffix.length) : line.text;
    return {
      id: `${item.kind}:${item.ts_ms}`,
      time: item.ts_ms,
      title,
      icon: ICONS[line.icon],
      tone: TONES[line.tone],
      ...(line.height
        ? {
            meta: (
              <>
                Block <Height value={line.height} />
              </>
            ),
          }
        : null),
    };
  });
}
