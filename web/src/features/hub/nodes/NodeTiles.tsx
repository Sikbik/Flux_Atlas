// The row of go-to tiles under the hero: the top operators (on this page), then geography, hosting and capacity in
// analytics, and the payment queue. Each carries one live line. The operators tile is the one the reader came for, so
// it is lit a little more, and it scrolls to the section instead of opening a window.

import { Cpu, Globe2, Server, UserRoundCheck } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useNetworkCapacity } from '../../../api/queries';
import { useSummary } from '../../../app/context';
import { formatCompact, formatInt } from '../../../lib/format';
import { WINDOW_ICON } from '../../../shell/wm/glyphs';
import { useMotionMode } from '../../../ui';
import { HubTile, HubTiles, useOperators } from '..';
import { OPERATORS_ID } from './lib/operators';

export function NodeTiles() {
  const summary = useSummary();
  const capacity = useNetworkCapacity();
  const operators = useOperators('zelid');
  const mode = useMotionMode();
  const Queue = WINDOW_ICON.queue ?? Server;

  // A plain click scrolls to the section and moves focus to its heading; a modified click or a middle click opens the
  // link as it would anywhere (the page, at the section).
  const toOperators = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const section = document.getElementById(OPERATORS_ID);
    if (!section) return;
    e.preventDefault();
    section.scrollIntoView({ block: 'start', behavior: mode === 'full' ? 'smooth' : 'auto' });
    const heading = section.querySelector<HTMLElement>('h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  };

  return (
    <HubTiles label="Quick links">
      <HubTile
        emphasis
        icon={UserRoundCheck}
        title="Top operators"
        caption={operators.data ? `${formatInt(operators.data.total_operators)} operators` : 'Who runs nodes'}
        to={`/nodes#${OPERATORS_ID}`}
        onClick={toOperators}
      />
      <HubTile
        icon={Globe2}
        title="Geography"
        caption={summary ? `${formatInt(summary.country_count)} countries` : 'Where nodes run'}
        to={{ type: 'analytics', key: 'geography' }}
      />
      <HubTile
        icon={Server}
        title="Hosting"
        caption={summary ? `${formatInt(summary.provider_count)} providers` : 'Who hosts them'}
        to={{ type: 'analytics', key: 'hosting' }}
      />
      <HubTile
        icon={Cpu}
        title="Capacity"
        caption={
          capacity.data ? `${formatCompact(Math.round(capacity.data.total.cores))} cores` : 'What it can run'
        }
        to={{ type: 'analytics', key: 'capacity' }}
      />
      <HubTile
        icon={Queue}
        title="Payment queue"
        caption="Who is paid next"
        to={{ type: 'queue', key: null }}
      />
    </HubTiles>
  );
}
