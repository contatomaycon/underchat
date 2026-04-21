import { truncateContactName } from '@core/common/functions/truncateContactName';

describe('truncateContactName', () => {
  it('returns null for null, undefined and non-string values', () => {
    expect(truncateContactName(null)).toBeNull();
    expect(truncateContactName(undefined)).toBeNull();
    expect(truncateContactName(10 as never)).toBeNull();
  });

  it('keeps value when within max length', () => {
    expect(truncateContactName('John', 10)).toBe('John');
  });

  it('truncates when value exceeds max length', () => {
    expect(truncateContactName('ABCDEFGHIJ', 4)).toBe('ABCD');
  });
});
