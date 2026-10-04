import { describe, expect, it } from 'vitest';
import { csvCell, csvFilename, dateStamp, dateTimeStamp, toCsv } from './csv';

describe('csvCell', () => {
  it('writes plain text, numbers and booleans as they are', () => {
    expect(csvCell('Hetzner')).toBe('Hetzner');
    expect(csvCell(9.5)).toBe('9.5');
    expect(csvCell(-3)).toBe('-3');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(false)).toBe('false');
  });

  it('writes nothing for nothing, and for a number that is not one', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('quotes text with a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvCell('Hetzner Online GmbH, Falkenstein')).toBe('"Hetzner Online GmbH, Falkenstein"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\nb')).toBe('"a\nb"');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
  });

  it('defangs text a spreadsheet would run as a formula', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@sys')).toBe("'@sys");
    expect(csvCell('=A,B')).toBe('"\'=A,B"');
  });

  it('leaves a negative number alone but not a negative number written as text', () => {
    expect(csvCell(-0.5)).toBe('-0.5');
    expect(csvCell('-0.5')).toBe("'-0.5");
  });
});

describe('toCsv', () => {
  it('writes a header and rows, CRLF between and after', () => {
    const out = toCsv(
      ['node', 'flux'],
      [
        ['a:0', 9],
        ['b, c', null],
      ],
    );
    expect(out).toBe('node,flux\r\na:0,9\r\n"b, c",\r\n');
  });

  it('writes just the header for no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });

  it('quotes a header that needs it', () => {
    expect(toCsv(['Value (USD, approx.)'], [[1]])).toBe('"Value (USD, approx.)"\r\n1\r\n');
  });
});

describe('names and stamps', () => {
  const ms = Date.UTC(2026, 9, 3, 14, 5, 9);
  it('stamps a date and a date with a time in UTC', () => {
    expect(dateStamp(ms)).toBe('2026-10-03');
    expect(dateTimeStamp(ms)).toBe('2026-10-03 14:05:09');
  });

  it('names a file for what it is, whose it is and when', () => {
    expect(csvFilename('nodes', 't3c4EfxLoXXSRZCRnPRF3RpjPi9mBzF5yoJ', ms)).toBe(
      'flux-wallet-t3c4EfxLoX-nodes-2026-10-03.csv',
    );
    expect(csvFilename('claims', '', ms)).toBe('flux-wallet-wallet-claims-2026-10-03.csv');
  });
});
