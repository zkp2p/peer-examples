import { describe, expect, it } from 'vitest';
import { interpolateIndex } from '@utils/selectorUtils';

describe('selectorUtils.interpolateIndex', () => {
  it('replaces {{INDEX}} tokens with the provided index', () => {
    expect(interpolateIndex('item-{{INDEX}}', 3)).toBe('item-3');
    expect(interpolateIndex('{{INDEX}}-{{INDEX}}', 1)).toBe('1-1');
  });

  it('returns input if not a string', () => {
    // @ts-expect-error intentionally wrong type
    expect(interpolateIndex(42, 1)).toBe('42');
  });
});
