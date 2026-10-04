import { Download, FileSpreadsheet } from 'lucide-react';
import { useMemo } from 'react';
import { Button, Menu, type MenuItem } from '../../../ui';
import type { Money } from '../hooks/useMoney';
import { csvFilename, downloadCsv, toCsv } from '../lib/csv';
import { buildDaily, claimsCsv, dailyCsv, parallelRatio } from '../lib/earnings';
import { type FleetRow, nodesCsvHeader, nodesCsvRows } from '../lib/fleet';
import { flux } from '../lib/money';
import type { ParallelAssetsDto, WalletDto } from '../types';

/**
 * The downloads: the nodes, the daily earnings (each day at its own price) and the parallel-asset claims. A file is
 * built when it is asked for, from what the page already holds, so nothing is fetched and nothing is sent anywhere.
 */
export function ExportMenu({
  dto,
  rows,
  money,
  assets,
}: {
  dto: WalletDto;
  rows: readonly FleetRow[];
  money: Money;
  assets: ParallelAssetsDto | undefined;
}) {
  const address = dto.address;
  const items = useMemo<MenuItem[]>(() => {
    const save = (kind: string, header: string[], body: Parameters<typeof toCsv>[1]) =>
      downloadCsv(csvFilename(kind, address, Date.now()), toCsv(header, body));
    return [
      { type: 'label', label: 'Download as CSV' },
      {
        id: 'nodes',
        label: `Nodes (${rows.length.toLocaleString('en-US')})`,
        icon: FileSpreadsheet,
        disabled: rows.length === 0,
        onSelect: () => save('nodes', nodesCsvHeader(), nodesCsvRows(rows)),
      },
      {
        id: 'earnings',
        label: 'Daily earnings',
        icon: FileSpreadsheet,
        disabled: dto.earnings.days.length === 0,
        onSelect: () => {
          const e = dto.earnings;
          const daily = buildDaily({
            days: e.days,
            ratio: parallelRatio(flux(e.native_per_day), flux(e.pa_per_day)),
            history: money.history,
            spot: money.spot,
            currency: money.currency,
            nowMs: Date.now(),
          });
          const { header, rows: body } = dailyCsv(daily, money.currency, money.history, money.spot);
          save('earnings', header, body);
        },
      },
      {
        id: 'claims',
        label: assets
          ? `Parallel asset claims (${assets.claims.length.toLocaleString('en-US')})`
          : 'Parallel asset claims (unavailable)',
        icon: FileSpreadsheet,
        disabled: !assets || assets.claims.length === 0,
        onSelect: () => {
          if (!assets) return;
          const { header, rows: body } = claimsCsv(assets.claims);
          save('claims', header, body);
        },
      },
    ];
  }, [address, dto, rows, money.history, money.spot, money.currency, assets]);

  return (
    <Menu
      aria-label="Export"
      placement="bottom-end"
      items={items}
      trigger={
        <Button size="sm" icon={Download} title="Download this wallet's data as CSV">
          Export
        </Button>
      }
    />
  );
}
