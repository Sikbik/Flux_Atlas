// The row of go-to tiles under the hero: the three sections of this page that are worth a jump (the owners, where apps
// run, what apps pay), and the two views elsewhere that go deeper (the capacity of the network, and the app messages
// waiting for a block). Each carries one live line. The economy is the tile the reader came for, so it is lit a little
// more.

import { Coins, Earth, Gauge, Rocket, UsersRound } from 'lucide-react';
import { useMemo } from 'react';
import type { AppEconomyDto } from '../../../api/generated/AppEconomyDto';
import type { AppsOverviewDto } from '../../../api/generated/AppsOverviewDto';
import { useNetwork, usePendingApps } from '../../../app/context';
import { type HubQuery, HubTile, HubTiles } from '..';
import { Ghost } from './ghost';
import { railRows } from './lib/capacity';
import { economyGlance } from './lib/economy';
import { GHOST_RESOURCES } from './lib/placeholders';
import {
  capacityTileText,
  countriesTileText,
  economyTileText,
  ownersTileText,
  pendingText,
} from './lib/tiles';
import { useJump, useMinute } from './parts';

/**
 * What each tile says while its answer is on the way, made up and drawn as a block: a tile with a live line is two
 * lines of text, and one without is a single line, so a tile that waits must hold the room of the line it will have.
 */
const GHOST = {
  owners: ownersTileText(1_396),
  countries: countriesTileText(54),
  economy: economyTileText(31_234),
  capacity: capacityTileText(railRows(GHOST_RESOURCES)),
};

const made = (text: string | undefined, waiting: boolean) =>
  waiting && text !== undefined ? <Ghost as="span">{text}</Ghost> : undefined;

export interface AppsTilesProps {
  overview: HubQuery<AppsOverviewDto>;
  economy: HubQuery<AppEconomyDto>;
}

export function AppsTiles({ overview, economy }: AppsTilesProps) {
  const jump = useJump();
  const now = useMinute();
  const pending = usePendingApps();
  const installing = useNetwork((s) => s.installing.size);
  const o = overview.data;
  const eco = economy.data;

  const waiting = useMemo(() => pending.filter((p) => p.state === 'pending').length, [pending]);
  const capacity = useMemo(() => (o ? capacityTileText(railRows(o.resources)) : undefined), [o]);
  const paid = useMemo(() => (eco ? economyGlance(eco, now).paid30d : null), [eco, now]);

  return (
    <HubTiles label="Quick links">
      <HubTile
        icon={UsersRound}
        title="Top owners"
        caption={ownersTileText(o ? o.total_owners : null) ?? made(GHOST.owners, overview.isPending)}
        to="/apps#owners"
        onClick={jump('owners')}
      />
      <HubTile
        icon={Earth}
        title="Where apps run"
        caption={
          countriesTileText(o ? o.countries.length : null) ?? made(GHOST.countries, overview.isPending)
        }
        to="/apps#countries"
        onClick={jump('countries')}
      />
      <HubTile
        emphasis
        icon={Coins}
        title="Apps economy"
        caption={economyTileText(paid) ?? made(GHOST.economy, economy.isPending)}
        to="/apps#economy"
        onClick={jump('economy')}
      />
      <HubTile
        icon={Gauge}
        title="Capacity"
        caption={capacity ?? made(GHOST.capacity, overview.isPending)}
        to={{ type: 'analytics', key: 'capacity' }}
      />
      <HubTile
        icon={Rocket}
        title="Pending apps"
        caption={pendingText(waiting, installing)}
        to={{ type: 'mempool', key: null }}
      />
    </HubTiles>
  );
}
