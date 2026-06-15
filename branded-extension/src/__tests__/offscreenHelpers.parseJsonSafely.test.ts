import { describe, expect, it } from 'vitest';
import { parseJsonSafely } from '@utils/offscreenHelpers';

describe('offscreenHelpers.parseJsonSafely', () => {
  it('parses a valid JSON string', () => {
    expect(parseJsonSafely('{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a double-stringified JSON with escaped quotes', () => {
    const double = JSON.stringify(JSON.stringify({ a: 1 }));
    expect(parseJsonSafely(double)).toEqual({ a: 1 });
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseJsonSafely('{oops')).toBeUndefined();
  });
});
