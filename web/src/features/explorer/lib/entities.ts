// Known entities: addresses the network publishes or the chain makes obvious. Labels are shown next to
// an address wherever it appears (explorer, tx flow, rich list). Only facts with a source belong here.

export type EntityKind = 'dev-fund' | 'swap-pool';

export interface KnownEntity {
  kind: EntityKind;
  label: string;
  /** One sentence of context, shown on hover and in the address header. */
  note: string;
}

/** The dev fund receives 0.5 FLUX plus the fees of every Proof of Node block (fluxd `strDevFundAddress`). */
export const DEV_FUND_ADDRESS = 't3hPu1YDeGUCp8m7BQCnnNUmRMJBa5RadyA';
/** The swap pool: 22M FLUX every 21,600 blocks from height 837,714 (chainparams); still the #1 rich-list entry. */
export const SWAP_POOL_ADDRESS = 't3ThbWogDoAjGuS6DEnmN1GWJBRbVjSUK4T';

const ENTITIES: Record<string, KnownEntity> = {
  [DEV_FUND_ADDRESS]: {
    kind: 'dev-fund',
    label: 'Dev fund',
    note: 'Receives 0.5 FLUX plus the fees of every Proof of Node block.',
  },
  [SWAP_POOL_ADDRESS]: {
    kind: 'swap-pool',
    label: 'Swap pool',
    note: 'The swap pool address. Chain parameters pay it 22M FLUX every 21,600 blocks, ten times from height 837,714.',
  },
};

export function knownEntity(address: string | null | undefined): KnownEntity | null {
  if (!address) return null;
  return ENTITIES[address] ?? null;
}
