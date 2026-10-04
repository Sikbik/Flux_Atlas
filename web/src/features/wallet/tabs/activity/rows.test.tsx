import { Boxes, Coins, Info, ShieldAlert } from 'lucide-react';
import { isValidElement, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Money } from '../../hooks/useMoney';
import type { FleetRow } from '../../lib/fleet';
import type { WalletActivity } from '../../types';
import { activityItems, type RowContext } from './rows';

const KEY = '8aa97365aa97365aa97365aa97365aa97365aa97365aa97365aa97365aa97365:0';

const act = (over: Partial<WalletActivity> = {}): WalletActivity => ({
  t_ms: 1_000,
  kind: 'paid',
  node_key: KEY,
  height: 3_006_439,
  detail: 'Paid 9.00000000 FLUX (stratus)',
  ...over,
});

const money = (price: number | null): Money =>
  ({ price, text: (flux: number) => `$${((price ?? 0) * flux).toFixed(2)}` }) as unknown as Money;

const row = { key: KEY, endpoint: '65.109.18.205:16127', tier: 'stratus' } as FleetRow;
const ctx = (over: Partial<RowContext> = {}): RowContext => ({
  rows: new Map([[KEY, row]]),
  money: money(0.07),
  hover: vi.fn(),
  ...over,
});

const metaOf = (i: ReturnType<typeof activityItems>[number]) => {
  expect(isValidElement(i.meta)).toBe(true);
  return (i.meta as ReactElement<Record<string, unknown>>).props;
};

describe('activityItems', () => {
  it('reads a payment as its amount in two decimals, with its block, tier and worth', () => {
    const [item] = activityItems([act()], ctx());
    expect(item?.title).toBe('Paid 9.00 FLUX');
    expect(item?.icon).toBe(Coins);
    expect(item?.tone).toBe('accent');
    expect(item?.time).toBe(1_000);
    expect(item?.block).toBe(3_006_439);
    const meta = item ? metaOf(item) : {};
    expect(meta).toMatchObject({ nodeKey: KEY, tier: 'stratus', value: '$0.63', row });
  });

  it('keeps the server sentence for anything that is not a payment', () => {
    const [item] = activityItems(
      [act({ kind: 'dos', detail: 'Moved to the DOS list: not confirmed in time', height: null })],
      ctx(),
    );
    expect(item?.title).toBe('Moved to the DOS list: not confirmed in time');
    expect(item?.icon).toBe(ShieldAlert);
    expect(item?.tone).toBe('crit');
    expect(item && 'block' in item).toBe(false);
  });

  it('gives a payment with no amount in its sentence the sentence, and no worth', () => {
    const [item] = activityItems([act({ detail: 'Payment received' })], ctx());
    expect(item?.title).toBe('Payment received');
    expect(item ? metaOf(item).value : 'x').toBeNull();
  });

  it('leaves out what a payment is worth while the price is unknown', () => {
    const [item] = activityItems([act()], ctx({ money: money(null) }));
    expect(item ? metaOf(item).value : 'x').toBeNull();
    expect(item?.title).toBe('Paid 9.00 FLUX');
  });

  it('takes the tier of a node from the fleet when the sentence names none', () => {
    const [item] = activityItems(
      [act({ kind: 'unreachable', detail: "The node's API stopped answering" })],
      ctx(),
    );
    expect(item ? metaOf(item).tier : null).toBe('stratus');
  });

  it('copes with a node the fleet does not have', () => {
    const [item] = activityItems(
      [act({ kind: 'left', detail: 'Left the node list' })],
      ctx({ rows: new Map() }),
    );
    const meta = item ? metaOf(item) : {};
    expect(meta.row).toBeNull();
    expect(meta.tier).toBeNull();
    expect(meta.nodeKey).toBe(KEY);
  });

  it('files a kind it does not know under information, in a quiet colour', () => {
    const [item] = activityItems([act({ kind: 'brand_new_kind', detail: 'Something new' })], ctx());
    expect(item?.icon).toBe(Info);
    expect(item?.tone).toBe('neutral');
    const [apps] = activityItems([act({ kind: 'apps', detail: '2 apps running' })], ctx());
    expect(apps?.icon).toBe(Boxes);
    expect(apps?.tone).toBe('neutral');
  });

  it('keeps every key unique, even for two rows that say the same thing at the same moment', () => {
    const items = activityItems([act(), act(), act({ kind: 'apps', detail: '1 app running' }), act()], ctx());
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe(`1000:paid:${KEY}`);
    expect(ids[1]).toBe(`1000:paid:${KEY}#1`);
    expect(ids[3]).toBe(`1000:paid:${KEY}#2`);
  });

  it('keeps the order it is given, and is empty for nothing', () => {
    const items = activityItems([act({ t_ms: 3 }), act({ t_ms: 2 }), act({ t_ms: 1 })], ctx());
    expect(items.map((i) => i.time)).toEqual([3, 2, 1]);
    expect(activityItems([], ctx())).toEqual([]);
  });
});
