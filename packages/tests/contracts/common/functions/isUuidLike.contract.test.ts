import { isUuidLike } from '@core/common/functions/isUuidLike';

describe('isUuidLike', () => {
  it('returns false for empty values', () => {
    expect(isUuidLike(undefined)).toBe(false);
    expect(isUuidLike(null)).toBe(false);
    expect(isUuidLike('')).toBe(false);
  });

  it('validates UUID version and variant', () => {
    expect(isUuidLike('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuidLike('550e8400-e29b-01d4-a716-446655440000')).toBe(false);
    expect(isUuidLike('550e8400-e29b-41d4-c716-446655440000')).toBe(false);
  });
});
