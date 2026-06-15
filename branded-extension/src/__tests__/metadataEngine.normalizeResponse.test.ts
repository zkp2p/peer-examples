import { describe, expect, it } from 'vitest';
import { normalizeResponse } from '@utils/metadataEngine';

describe('metadataEngine.normalizeResponse', () => {
  it('handles JSON string input', () => {
    const input = '{"a":1}';
    const res = normalizeResponse(input);
    expect(res.str).toBe(input);
    expect(res.json).toEqual({ a: 1 });
  });

  it('handles non-JSON string input', () => {
    const input = 'hello';
    const res = normalizeResponse(input);
    expect(res.str).toBe('hello');
    expect(res.json).toBeUndefined();
  });

  it('handles plain object', () => {
    const input = { x: 2 };
    const res = normalizeResponse(input);
    expect(res.str).toBe(JSON.stringify(input));
    expect(res.json).toEqual(input);
  });
});
