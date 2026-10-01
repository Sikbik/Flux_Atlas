// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mount } from '../internal/testing';
import { Amount, formatAmountText } from './Amount';
import { Endpoint } from './Endpoint';
import { EntityLink } from './EntityLink';
import { Hash } from './Hash';
import { Height } from './Height';
import { RelativeTime } from './RelativeTime';
import { Unknown } from './Unknown';

const HASH = '8aa97365b148e2125de355988b4c1be4870edc0e869587f831f8c0d65871beec';

describe('Hash', () => {
  it('middle-truncates visibly but keeps the whole value in the text for selection and copy', () => {
    const m = mount(<Hash value={HASH} />);
    const text = m.container.querySelector('.ui-hash__text');
    // textContent is what a drag-select copies: head, the hidden middle and the tail, joined.
    expect(text?.textContent).toBe(HASH);
    expect(m.container.querySelector('.ui-hash__gap')).not.toBeNull();
    expect(text?.getAttribute('title')).toBe(HASH);
    m.unmount();
  });

  it('shows the whole value, wrapping, in full mode', () => {
    const m = mount(<Hash value={HASH} full />);
    expect(m.container.querySelector('.ui-hash__gap')).toBeNull();
    expect(m.container.querySelector('.ui-hash__text')?.textContent).toBe(HASH);
    m.unmount();
  });

  it('adds a copy button named for what it copies, and none when copy is off', () => {
    const on = mount(<Hash value={HASH} what="transaction id" />);
    expect(on.container.querySelector('button')?.getAttribute('aria-label')).toBe('Copy transaction id');
    on.unmount();
    const off = mount(<Hash value={HASH} copy={false} />);
    expect(off.container.querySelector('button')).toBeNull();
    off.unmount();
  });

  it('renders Unknown for a missing value', () => {
    for (const v of [null, undefined, '']) {
      const m = mount(<Hash value={v} />);
      expect(m.container.textContent).toBe('Unknown');
      m.unmount();
    }
  });

  it('does not truncate a short value', () => {
    const m = mount(<Hash value="abc123" />);
    expect(m.container.querySelector('.ui-hash__gap')).toBeNull();
    expect(m.container.querySelector('.ui-hash__text')?.textContent).toBe('abc123');
    m.unmount();
  });
});

describe('Amount', () => {
  it('formats FLUX with two decimals and a unit by default', () => {
    const m = mount(<Amount value="14.00000000" />);
    expect(m.container.textContent).toBe('14.00FLUX');
    m.unmount();
  });

  it('shows eight decimals with the trailing zeros dimmed in exact mode', () => {
    const m = mount(<Amount value="9.5" exact />);
    expect(m.container.querySelector('.ui-amount__figure')?.textContent).toBe('9.50000000');
    expect(m.container.querySelector('.ui-amount__dim')?.textContent).toBe('000000');
    m.unmount();
  });

  it('prefixes a plus when asked and tints gains and losses with the sign as the second cue', () => {
    const m = mount(
      <>
        <Amount value="1" sign="always" tone="signed" />
        <Amount value="-2.5" tone="signed" />
      </>,
    );
    const items = Array.from(m.container.querySelectorAll('.ui-amount'));
    expect(items[0]?.textContent).toContain('+1.00');
    expect(items[0]?.getAttribute('data-dir')).toBe('pos');
    expect(items[1]?.textContent).toContain('-2.50');
    expect(items[1]?.getAttribute('data-dir')).toBe('neg');
    m.unmount();
  });

  it('can drop the unit or replace it', () => {
    const none = mount(<Amount value="3" unit={false} />);
    expect(none.container.textContent).toBe('3.00');
    none.unmount();
    const custom = mount(<Amount value="3" unit="zat" />);
    expect(custom.container.textContent).toBe('3.00zat');
    custom.unmount();
  });

  it('says Unknown for a missing or unparseable amount, and keeps a real zero', () => {
    for (const v of [null, undefined, 'abc']) {
      const m = mount(<Amount value={v} />);
      expect(m.container.textContent).toBe('Unknown');
      m.unmount();
    }
    const zero = mount(<Amount value="0.00000000" />);
    expect(zero.container.querySelector('.ui-amount__figure')?.textContent).toBe('0.00');
    zero.unmount();
  });

  it('formatAmountText returns null for unknown values', () => {
    expect(formatAmountText(null)).toBeNull();
    expect(formatAmountText('nope')).toBeNull();
    expect(formatAmountText('1234.5')).toBe('1,234.50');
  });
});

describe('Height', () => {
  it('groups digits and links to the block', () => {
    const m = mount(<Height value={2996929} />);
    const a = m.container.querySelector('a');
    expect(a?.textContent).toBe('2,996,929');
    expect(a?.getAttribute('href')).toBe('/block/2996929');
    m.unmount();
  });

  it('renders plain text when the link is off, and Unknown when missing', () => {
    const plain = mount(<Height value={5} link={false} />);
    expect(plain.container.querySelector('a')).toBeNull();
    expect(plain.container.textContent).toBe('5');
    plain.unmount();
    const unknown = mount(<Height value={null} />);
    expect(unknown.container.textContent).toBe('Unknown');
    unknown.unmount();
  });
});

describe('RelativeTime', () => {
  it('renders a time element with a machine-readable stamp and the full UTC time in the title', () => {
    const ts = Date.now() - 12_000;
    const m = mount(<RelativeTime ts={ts} />);
    const t = m.container.querySelector('time');
    expect(t?.getAttribute('datetime')).toBe(new Date(ts).toISOString());
    expect(t?.getAttribute('title')).toMatch(/UTC/);
    expect(t?.textContent).toMatch(/ago$/);
    m.unmount();
  });

  it('drops the word ago in age-only mode', () => {
    const m = mount(<RelativeTime ts={Date.now() - 12_000} ageOnly />);
    expect(m.container.querySelector('time')?.textContent).not.toMatch(/ago/);
    m.unmount();
  });

  it('says Unknown for a missing moment', () => {
    const m = mount(<RelativeTime ts={null} />);
    expect(m.container.textContent).toBe('Unknown');
    expect(m.container.querySelector('time')).toBeNull();
    m.unmount();
  });
});

describe('Endpoint', () => {
  it('links an ip and port to the node, and an ip alone to the host', () => {
    const node = mount(<Endpoint value="65.109.26.93:16147" />);
    expect(node.container.querySelector('a')?.getAttribute('href')).toBe('/node/65.109.26.93%3A16147');
    node.unmount();
    const host = mount(<Endpoint ip="65.109.26.93" />);
    expect(host.container.querySelector('a')?.getAttribute('href')).toBe('/host/65.109.26.93');
    host.unmount();
  });

  it('brackets IPv6 and can drop the default port', () => {
    const v6 = mount(<Endpoint value="[2a01:4f8::1]:16147" />);
    expect(v6.container.textContent).toBe('[2a01:4f8::1]:16147');
    v6.unmount();
    const hidden = mount(<Endpoint value="65.109.26.93:16127" hideDefaultPort />);
    expect(hidden.container.textContent).toBe('65.109.26.93');
    hidden.unmount();
  });

  it('adds a copy button for the full endpoint and says Unknown when missing', () => {
    const m = mount(<Endpoint value="65.109.26.93:16127" hideDefaultPort copy />);
    expect(m.container.querySelector('button')?.getAttribute('aria-label')).toBe('Copy endpoint');
    m.unmount();
    const none = mount(<Endpoint value={null} />);
    expect(none.container.textContent).toBe('Unknown');
    none.unmount();
  });
});

describe('EntityLink', () => {
  it('resolves every kind to its route (plain anchors outside a router)', () => {
    const cases: Array<[Parameters<typeof EntityLink>[0]['kind'], string, string]> = [
      ['node', '65.109.26.93:16147', '/node/65.109.26.93%3A16147'],
      ['host', '65.109.26.93', '/host/65.109.26.93'],
      ['app', 'bitcoinwhitepaper', '/app/bitcoinwhitepaper'],
      ['block', '2996929', '/block/2996929'],
      ['tx', HASH, `/tx/${HASH}`],
      ['address', 't1abc', '/address/t1abc'],
      ['operator', 't1abc', '/operator/t1abc'],
      ['country', 'DE', '/?cc=DE'],
      ['provider', 'Hetzner Online GmbH', '/?org=Hetzner%20Online%20GmbH'],
      ['version', '8.20.0', '/?ver=8.20.0'],
    ];
    for (const [kind, value, href] of cases) {
      const m = mount(<EntityLink kind={kind} value={value} />);
      expect(m.container.querySelector('a')?.getAttribute('href')).toBe(href);
      m.unmount();
    }
  });

  it('truncates long ids visually, keeps the full value in the title and the accessible name', () => {
    const m = mount(<EntityLink kind="tx" value={HASH} />);
    const a = m.container.querySelector('a');
    expect(a?.textContent).toBe('8aa973…1beec');
    expect(a?.getAttribute('title')).toBe(HASH);
    expect(a?.getAttribute('aria-label')).toContain(HASH);
    expect(a?.getAttribute('aria-label')).toContain('transaction');
    m.unmount();
  });

  it('uses custom children as the visible text', () => {
    const m = mount(
      <EntityLink kind="app" value="bitcoinwhitepaper">
        Bitcoin Whitepaper
      </EntityLink>,
    );
    expect(m.container.querySelector('a')?.textContent).toBe('Bitcoin Whitepaper');
    m.unmount();
  });

  it('renders Unknown instead of a dead link when the value is missing', () => {
    for (const v of [null, undefined, '']) {
      const m = mount(<EntityLink kind="node" value={v} />);
      expect(m.container.querySelector('a')).toBeNull();
      expect(m.container.textContent).toBe('Unknown');
      m.unmount();
    }
  });

  it('sets ids in Plex Mono and names in the interface font', () => {
    const m = mount(
      <>
        <EntityLink kind="block" value="1" />
        <EntityLink kind="app" value="x" />
      </>,
    );
    const links = Array.from(m.container.querySelectorAll('a'));
    expect(links[0]?.hasAttribute('data-mono')).toBe(true);
    expect(links[1]?.hasAttribute('data-mono')).toBe(false);
    m.unmount();
  });

  it('adds an icon and a copy button for the full value on request', () => {
    const m = mount(<EntityLink kind="address" value="t1abc" icon copy />);
    expect(m.container.querySelector('a svg')).not.toBeNull();
    expect(m.container.querySelector('button')?.getAttribute('aria-label')).toBe('Copy address');
    m.unmount();
  });
});

describe('Unknown', () => {
  it('renders the word, or the word the caller chooses', () => {
    const a = mount(<Unknown />);
    expect(a.container.textContent).toBe('Unknown');
    a.unmount();
    const b = mount(<Unknown>Not reported</Unknown>);
    expect(b.container.textContent).toBe('Not reported');
    b.unmount();
  });
});
