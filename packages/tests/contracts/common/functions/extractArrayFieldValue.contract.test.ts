import { extractArrayFieldValue } from '@core/common/functions/extractArrayFieldValue';

describe('extractArrayFieldValue', () => {
  it('returns empty array for nullish values', () => {
    expect(extractArrayFieldValue(null)).toEqual([]);
    expect(extractArrayFieldValue(undefined)).toEqual([]);
  });

  it('returns string array unchanged', () => {
    expect(extractArrayFieldValue(['a', 'b'])).toEqual(['a', 'b']);
    expect(extractArrayFieldValue([])).toEqual([]);
  });

  it('maps arrays of objects to their value field', () => {
    expect(
      extractArrayFieldValue([{ value: 'x' }, { value: 'y' }] as never)
    ).toEqual(['x', 'y']);
  });

  it('handles object value as string, array and null', () => {
    expect(extractArrayFieldValue({ value: 'z' })).toEqual(['z']);
    expect(extractArrayFieldValue({ value: ['m', 'n'] })).toEqual(['m', 'n']);
    expect(extractArrayFieldValue({ value: null })).toEqual([]);
    expect(extractArrayFieldValue({ value: 123 as never })).toEqual([]);
    expect(extractArrayFieldValue('invalid' as never)).toEqual([]);
  });
});
