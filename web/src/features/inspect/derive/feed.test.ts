import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../../api/generated/FeedItem';
import { describeFeedItem, nodeRefs } from './feed';

const item = (
  kind: FeedItem['kind'],
  params: Record<string, string> = {},
  refs: FeedItem['refs'] = [],
): FeedItem => ({
  kind,
  ts_ms: 1,
  text_key: `feed.${kind}`,
  refs,
  params,
});

describe('describeFeedItem', () => {
  it('reads the common node events', () => {
    expect(describeFeedItem(item('node_heartbeat', { height: '2997561' })).text).toBe(
      'Checked in at block 2,997,561',
    );
    expect(describeFeedItem(item('node_joined', { height: '12' }))).toMatchObject({
      text: 'Joined the network at block 12',
      tone: 'ok',
      icon: 'join',
      height: 12,
    });
    expect(describeFeedItem(item('node_paid', { amount: '9.00000000', height: '5' })).text).toBe(
      'Paid 9.00 FLUX at block 5',
    );
    expect(
      describeFeedItem(item('node_ip_changed', { old: '1.1.1.1:16127', new: '2.2.2.2:16127' })).text,
    ).toBe('IP changed from 1.1.1.1:16127 to 2.2.2.2:16127');
    expect(describeFeedItem(item('node_at_risk', { blocks: '561' })).text).toBe(
      'At risk of expiry, 561 blocks since the last check-in',
    );
  });

  it('separates predicted from confirmed expiry and explains removals', () => {
    expect(describeFeedItem(item('node_expired', { predicted: 'true' })).text).toBe('Expected to expire');
    expect(describeFeedItem(item('node_expired', { predicted: 'false' })).text).toBe('Expired');
    expect(describeFeedItem(item('node_left', { reason: 'collateral_spent' })).text).toBe(
      'Left the network, its collateral was spent',
    );
    expect(describeFeedItem(item('node_left')).text).toBe('Left the network');
  });

  it('takes the height from a block reference when the params lack it', () => {
    const f = describeFeedItem(item('node_heartbeat', {}, [{ kind: 'block', height: 99 }]));
    expect(f.height).toBe(99);
    expect(f.text).toContain('99');
  });

  it('falls back to a plain label and never throws on unknown kinds', () => {
    expect(describeFeedItem(item('version_milestone')).text).toBe('version milestone');
    expect(describeFeedItem(item('node_unreachable')).icon).toBe('offline');
  });

  it('lists referenced nodes', () => {
    expect(
      nodeRefs(
        item('node_joined', {}, [
          { kind: 'node', id: 4 },
          { kind: 'block', height: 1 },
          { kind: 'node', id: 9 },
        ]),
      ),
    ).toEqual([4, 9]);
  });
});
