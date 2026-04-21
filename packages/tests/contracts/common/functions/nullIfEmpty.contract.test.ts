import { nullIfEmpty } from '@core/common/functions/nullIfEmpty';

describe('nullIfEmpty', () => {
  it('returns null for null, undefined and blank strings', () => {
    expect(nullIfEmpty(null)).toBeNull();
    expect(nullIfEmpty(undefined)).toBeNull();
    expect(nullIfEmpty('')).toBeNull();
    expect(nullIfEmpty('   ')).toBeNull();
  });

  it('keeps non-empty string unchanged', () => {
    expect(nullIfEmpty('value')).toBe('value');
    expect(nullIfEmpty('  value  ')).toBe('  value  ');
  });
});
