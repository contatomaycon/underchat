import { isDefinedFilter } from '@core/common/functions/isDefinedFilter';

describe('isDefinedFilter', () => {
  it('returns true when condition is defined', () => {
    expect(isDefinedFilter({ sql: 'x' } as never)).toBe(true);
  });

  it('returns false when condition is undefined', () => {
    expect(isDefinedFilter(undefined)).toBe(false);
  });
});
