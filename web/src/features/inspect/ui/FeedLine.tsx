import {
  Activity,
  Ban,
  Boxes,
  Coins,
  Info,
  LogOut,
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
import { formatAgo, formatInt } from '../../../lib/format';
import { describeFeedItem, type FeedIcon, type FeedTone } from '../derive/feed';
import { BlockLink } from './links';

const ICONS: Record<FeedIcon, typeof Activity> = {
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

export const feedToneClass = (t: FeedTone): string => `ix-ev-${t}`;

/** One event of a node's recent history: an icon tile in the event's colour, a sentence, an age. */
export function FeedLine({ item, nowMs }: { item: FeedItem; nowMs: number }) {
  const line = describeFeedItem(item);
  const Icon = ICONS[line.icon];
  // "... at block 2,997,561": the height becomes a link to the block.
  const suffix = line.height ? ` at block ${formatInt(line.height)}` : '';
  const lead = suffix && line.text.endsWith(suffix) ? line.text.slice(0, -suffix.length) : null;
  return (
    <li className="ix-ev" data-tone={line.tone}>
      <span className="ix-ev-i" aria-hidden="true">
        <Icon size={13} strokeWidth={1.75} />
      </span>
      <span className="ix-ev-t">
        {lead !== null && line.height ? (
          <>
            {lead} at block{' '}
            <BlockLink height={line.height} className="ix-mono">
              {formatInt(line.height)}
            </BlockLink>
          </>
        ) : (
          line.text
        )}
      </span>
      <time className="ix-dim ix-mono" dateTime={new Date(item.ts_ms).toISOString()}>
        {formatAgo(nowMs - item.ts_ms)}
      </time>
    </li>
  );
}
