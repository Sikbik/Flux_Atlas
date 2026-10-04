import { describe, expect, it } from 'vitest';
import type { PaChain, PaClaim } from '../types';
import {
  chainName,
  chainTicker,
  chainTotals,
  claimChainLabel,
  claimEfficiency,
  claimedShare,
  claimHistoryTotals,
  claimLink,
  explorerUrl,
  feeShareText,
  isClaimAll,
  receivingLink,
  safeHttpUrl,
  sortChains,
  verdictView,
} from './parallel';

const claim = (over: Partial<PaClaim> = {}): PaClaim => ({
  chain: 'eth',
  amount: 100,
  txid: '0xabc',
  to: '0xdef',
  explorer_url: 'https://etherscan.io/tx/0xabc',
  time_ms: 1_700_000_000_000,
  main_txid: null,
  fee: 2,
  ...over,
});

const MAIN = 'a'.repeat(64);

const chain = (id: string, over: Partial<PaChain> = {}): PaChain => ({
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

  it('does not call a claim worth it when the chain published no fee', () => {
    // The server sends 0 for a chain whose fee Fusion did not list.
    const e = claimEfficiency(chain('a', { claimable: 5_000, claim_fee: 0 }));
    expect(e.feeKnown).toBe(false);
    expect(e.feeShare).toBeNull();
    expect(e.verdict).toBe('unknown');
    expect(verdictView('unknown')).toEqual({ label: 'Fee not published', tone: 'off' });
    expect(claimEfficiency(chain('a', { claimable: 5_000, claim_fee: 10 })).feeKnown).toBe(true);
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
    const own = claim({ amount: 1, explorer_url: 'https://etherscan.io/tx/0xabc?x=1', time_ms: 1 });
    expect(claimLink(own, chains)).toBe('https://etherscan.io/tx/0xabc?x=1');
    expect(claimLink({ ...own, explorer_url: null }, chains)).toBe('https://etherscan.io/tx/0xabc');
    expect(claimLink({ ...own, explorer_url: 'javascript:1' }, chains)).toBe('https://etherscan.io/tx/0xabc');
    expect(claimLink({ ...own, explorer_url: null, chain: 'zzz' }, chains)).toBeNull();
  });
});

describe('claim-all and history', () => {
  const chains = [
    chain('eth', { name: 'Ethereum', explorer_address: 'https://etherscan.io/address/{address}' }),
    chain('kda', { name: 'Kadena', explorer_address: null }),
  ];
  const all = claim({
    chain: 'flux',
    txid: `flux:${MAIN}`,
    main_txid: MAIN,
    to: 't3abc',
    explorer_url: `https://explorer.runonflux.io/tx/${MAIN}`,
    amount: 5_000,
    fee: 20,
    time_ms: 1_790_000_000_000,
  });

  it('tells a claim-all from a claim on one chain', () => {
    expect(isClaimAll(all)).toBe(true);
    expect(isClaimAll(claim())).toBe(false);
    expect(claimChainLabel(all, chains)).toBe('All chains');
    expect(claimChainLabel(claim(), chains)).toBe('Ethereum');
    expect(claimChainLabel(claim({ chain: 'zzz' }), chains)).toBe('ZZZ');
  });

  it('links a claim-all to the Flux explorer the server named', () => {
    expect(claimLink(all, chains)).toBe(`https://explorer.runonflux.io/tx/${MAIN}`);
  });

  it("finds where a chain's claims went, from its newest claim on that chain", () => {
    const list = [all, claim({ to: '0xnewest' }), claim({ to: '0xolder', time_ms: 1 })];
    expect(receivingLink(chains[0] as PaChain, list)).toEqual({
      address: '0xnewest',
      url: 'https://etherscan.io/address/0xnewest',
    });
    // A claim-all is not a claim on that chain; a chain with no template or no claim has no link.
    expect(receivingLink(chains[0] as PaChain, [all])).toBeNull();
    expect(receivingLink(chains[1] as PaChain, [claim({ chain: 'kda', to: 'k:abc' })])).toBeNull();
    expect(receivingLink(chains[0] as PaChain, [])).toBeNull();
  });

  it('adds up the history and finds its newest claim', () => {
    expect(
      claimHistoryTotals([all, claim({ amount: 10, fee: 1, time_ms: 5 }), claim({ time_ms: null })]),
    ).toEqual({
      count: 3,
      amount: 5_110,
      fees: 23,
      lastMs: 1_790_000_000_000,
    });
    expect(claimHistoryTotals([])).toEqual({ count: 0, amount: 0, fees: 0, lastMs: null });
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
