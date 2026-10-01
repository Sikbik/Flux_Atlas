import { describe, expect, it } from 'vitest';
import { ApiError } from '../../api/http';
import { describeError } from './describeError';

const api = (code: ConstructorParameters<typeof ApiError>[0], status = 500, retryAfterS?: number) =>
  new ApiError(code, `${code} message`, status, '/api/v1/x', retryAfterS);

describe('describeError', () => {
  it('a missing record is neutral and not worth retrying', () => {
    const info = describeError(api('not_found', 404));
    expect(info.tone).toBe('neutral');
    expect(info.retryable).toBe(false);
    expect(info.code).toBe('not_found');
  });

  it('a bad request shows the server message and is not retryable', () => {
    const info = describeError(api('bad_request', 400));
    expect(info.tone).toBe('error');
    expect(info.retryable).toBe(false);
    expect(info.text).toBe('bad_request message');
  });

  it('a lagging upstream and a starting server are warnings that can be retried', () => {
    for (const code of ['upstream', 'unavailable'] as const) {
      const info = describeError(api(code, 503));
      expect(info.tone).toBe('warn');
      expect(info.retryable).toBe(true);
    }
  });

  it('rate limiting names the wait when the server sent Retry-After', () => {
    expect(describeError(api('rate_limited', 429, 12)).text).toBe('Try again in 12 s.');
    expect(describeError(api('rate_limited', 429)).text).toBe('Wait a moment, then try again.');
  });

  it('a network failure is an error that can be retried and says what to check', () => {
    const info = describeError(api('network', 0));
    expect(info.tone).toBe('error');
    expect(info.retryable).toBe(true);
    expect(info.text).toMatch(/network/i);
  });

  it('an unknown API error retries only when the status says a retry could help', () => {
    expect(describeError(api('http', 500)).retryable).toBe(true);
    expect(describeError(api('http', 418)).retryable).toBe(false);
  });

  it('a plain Error keeps its message, and an unthrown value gets a generic line', () => {
    expect(describeError(new Error('kaboom')).text).toBe('kaboom');
    expect(describeError(undefined).title).toBe('Something went wrong');
    expect(describeError('oops').code).toBeNull();
  });

  it('never apologises (voice rule: say what happened and what to do next)', () => {
    const samples = [
      api('not_found', 404),
      api('bad_request', 400),
      api('upstream', 502),
      api('unavailable', 503),
      api('rate_limited', 429),
      api('network', 0),
      api('http', 500),
      new Error('x'),
      null,
    ];
    for (const e of samples) {
      const { title, text } = describeError(e);
      expect(`${title} ${text}`).not.toMatch(/sorry|oops|unfortunately/i);
    }
  });
});
