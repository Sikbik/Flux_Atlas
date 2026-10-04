import { describe, expect, it } from 'vitest';
import type { ParallelChain, ParallelClaim } from '../types';
import {
  chainName,
  chainTicker,
  chainTotals,
  claimEfficiency,
  claimedShare,
  claimLink,
  explorerUrl,
  feeShareText,
  safeHttpUrl,
  sortChains,
  verdictView,
} from './parallel';

const chain = (id: string, over: Partial<ParallelChain> = {}): ParallelChain => ({
  chain: id,
  name: id.toUpperCase(),
  active: true,
  mined: 150_000,
  claimed: 106_000,
  received: 106_000,
  fees_paid: 40,
  claimable: 43_555.5,
  claim_fee: 10,
  explorer_tx: `https://explorer.example/${id}/tx/{txid}`,
  explorer_address: null,
  ...over,
});

describe('claimEfficiency', () => {
  it('calls a huge claim against a small fee worth it', () => {
    const e = claimEfficiency(chain('kda'));
    expect(e.gross).toBe(43_555.5);
    expect(e.net).toBe(43_545.5);
    expect(e.feeShare).toBeCloseTo(10 / 43_555.5, 12);
    expect(e.verdict).toBe('worth');
  });

  it('grades by the fee as a share of the claim', () => {
    expect(claimEfficiency(chain('a', { claimable: 1000, claim_fee: 10 })).verdict).toBe('worth');
    expect(claimEfficiency(chain('a', { claimable: 500, claim_fee: 10 })).verdict).toBe('fair');
    expect(claimEfficiency(chain('a', { claimable: 200, claim_fee: 31 })).verdict).toBe('wait');
    expect(claimEfficiency(chain('a', { claimable: 20, claim_fee: 31 })).verdict).toBe('underwater');
    expect(claimEfficiency(chain('a', { claimable: 31, claim_fee: 31 })).verdict).toBe('underwater');
  });

  it('never goes below zero net, and names the claim size where a fee is one percent', () => {
    const e = claimEfficiency(chain('a', { claimable: 20, claim_fee: 31 }));
    expect(e.net).toBe(0);
    expect(e.worthAt).toBeCloseTo(3100, 9);
  });

  it('has nothing to say about an empty chain, and nothing at all about an ended one', () => {
    const none = claimEfficiency(chain('a', { claimable: 0 }));
    expect(none.verdict).toBe('nothing');
    expect(none.feeShare).toBeNull();
    const ended = claimEfficiency(chain('erg', { active: false }));
    expect(ended.verdict).toBe('inactive');
    expect(ended.gross).toBe(43_555.5);
  });

  it('treats a negative figure from a bad feed as zero', () => {
    const e = claimEfficiency(chain('a', { claimable: -5, claim_fee: -1 }));
    expect(e.gross).toBe(0);
    expect(e.fee).toBe(0);
  });
});

describe('verdictView and feeShareText', () => {
  it('gives every verdict a word and a role', () => {
    expect(verdictView('worth')).toEqual({ label: 'Worth claiming', tone: 'ok' });
    expect(verdictView('underwater').tone).toBe('crit');
    expect(verdictView('inactive').label).toBe('Ended in Fusion');
  });

  it('writes a share the way it reads', () => {
    expect(feeShareText(0.0002296)).toBe('0.02%');
    expect(feeShareText(0.000001)).toBe('under 0.01%');
    expect(feeShareText(0.014)).toBe('1.4%');
    expect(feeShareText(0.155)).toBe('15.5%');
    expect(feeShareText(1.7)).toBe('over 100%');
    expect(feeShareText(null)).toBe('Unknown');
  });
});

describe('sortChains and chainTotals', () => {
  const chains = [
    chain('erg', { active: false, claimable: 90_000 }),
    chain('kda', { claimable: 100 }),
    chain('eth', { claimable: 5_000 }),
    chain('bsc', { claimable: 5_000, name: 'BNB Smart Chain' }),
  ];

  it('puts active chains first, then the biggest claim, then by name', () => {
    expect(sortChains(chains).map((c) => c.chain)).toEqual(['bsc', 'eth', 'kda', 'erg']);
  });

  it('does not mutate the input', () => {
    const copy = [...chains];
    sortChains(chains);
    expect(chains).toEqual(copy);
  });

  it('adds up only the chains that can be claimed', () => {
    const t = chainTotals(chains);
    expect(t).toEqual({ claimable: 10_100, fees: 30, net: 10_070, active: 3, inactive: 1 });
  });
});

describe('claimedShare', () => {
  it('is the share of what was mined that was claimed', () => {
    expect(claimedShare({ mined: 1_500_904, claimed: 1_065_349 })).toBeCloseTo(0.7098, 3);
    expect(claimedShare({ mined: 0, claimed: 0 })).toBeNull();
    expect(claimedShare({ mined: 10, claimed: 12 })).toBe(1);
  });
});

describe('links', () => {
  it('accepts a web address and nothing else', () => {
    expect(safeHttpUrl('https://etherscan.io/tx/0xabc')).toBe('https://etherscan.io/tx/0xabc');
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<b>')).toBeNull();
    expect(safeHttpUrl('not a url')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });

  it('fills a template with an encoded value', () => {
    expect(explorerUrl('https://x.io/tx/{txid}', { txid: 'abc123' })).toBe('https://x.io/tx/abc123');
    expect(explorerUrl('https://x.io/tx/{txid}', { txid: 'a b/c' })).toBe('https://x.io/tx/a%20b%2Fc');
    expect(explorerUrl(null, { txid: 'a' })).toBeNull();
    expect(explorerUrl('javascript:{txid}', { txid: 'a' })).toBeNull();
  });

  it("prefers the server's own link, then the chain's template", () => {
    const chains = [chain('eth', { explorer_tx: 'https://etherscan.io/tx/{txid}' })];
    const own: ParallelClaim = {
      chain: 'eth',
      amount: 1,
      txid: '0xabc',
      to: '0xdef',
      explorer_url: 'https://etherscan.io/tx/0xabc?x=1',
      time_ms: 1,
    };
    expect(claimLink(own, chains)).toBe('https://etherscan.io/tx/0xabc?x=1');
    expect(claimLink({ ...own, explorer_url: null }, chains)).toBe('https://etherscan.io/tx/0xabc');
    expect(claimLink({ ...own, explorer_url: 'javascript:1' }, chains)).toBe('https://etherscan.io/tx/0xabc');
    expect(claimLink({ ...own, explorer_url: null, chain: 'zzz' }, chains)).toBeNull();
  });
});

describe('tickers and names', () => {
  it('has a ticker for each chain and a fallback for a new one', () => {
    expect(chainTicker('kda')).toBe('KDA');
    expect(chainTicker('matic')).toBe('MATIC');
    expect(chainTicker('newchain')).toBe('NEWCH');
  });

  it('names a chain from its card, else by its ticker', () => {
    const chains = [chain('kda', { name: 'Kadena' })];
    expect(chainName('kda', chains)).toBe('Kadena');
    expect(chainName('sol', chains)).toBe('SOL');
  });
});
