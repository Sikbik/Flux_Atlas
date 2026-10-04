import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { FILL_RETRIES, isFilling, operatorsKey, retryWhileFilling } from './api';

const unavailable = new ApiError('unavailable', 'Warming up', 503, '/api/v1/network/operators', 5);
const missing = new ApiError('not_found', 'No such thing', 404, '/api/v1/network/operators');
const broken = new ApiError('upstream', 'Bad gateway', 502, '/api/v1/network/operators');

describe('isFilling', () => {
  it('is the 503 a server answers while it does not know the tip yet', () => {
    expect(isFilling(unavailable)).toBe(true);
    expect(isFilling(broken)).toBe(false);
    expect(isFilling(missing)).toBe(false);
  });

  it('is not a thing that was never an API error', () => {
    expect(isFilling(new Error('boom'))).toBe(false);
    expect(isFilling(null)).toBe(false);
    expect(isFilling(undefined)).toBe(false);
  });
});

describe('retryWhileFilling', () => {
  it('keeps asking while the server says to wait, for about a minute', () => {
    expect(retryWhileFilling(0, unavailable)).toBe(true);
    expect(retryWhileFilling(FILL_RETRIES - 1, unavailable)).toBe(true);
    expect(retryWhileFilling(FILL_RETRIES, unavailable)).toBe(false);
  });

  it('asks again a few times for a failure that may pass, and not at all for one that will not', () => {
    expect(retryWhileFilling(0, broken)).toBe(true);
    expect(retryWhileFilling(2, broken)).toBe(true);
    expect(retryWhileFilling(3, broken)).toBe(false);
    expect(retryWhileFilling(0, missing)).toBe(false);
  });

  it('treats an error that is not the API own like a network failure', () => {
    expect(retryWhileFilling(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retryWhileFilling(3, new TypeError('Failed to fetch'))).toBe(false);
  });
});

describe('operatorsKey', () => {
  it('keeps each ranking and size in a cache entry of its own, under the network keys', () => {
    expect(operatorsKey('zelid', 25)).not.toEqual(operatorsKey('address', 25));
    expect(operatorsKey('zelid', 25)).not.toEqual(operatorsKey('zelid', 50));
    expect(operatorsKey('zelid', 25).slice(-3)).toEqual(['operators', 'zelid', 25]);
  });
});
