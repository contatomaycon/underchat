import { extractFieldValue } from '@core/common/functions/extractFieldValue';

describe('extractFieldValue', () => {
  it('returns empty string for nullish values', () => {
    expect(extractFieldValue(null)).toBe('');
    expect(extractFieldValue(undefined)).toBe('');
  });

  it('returns value from object shape', () => {
    expect(extractFieldValue({ value: 'abc' })).toBe('abc');
    expect(extractFieldValue({ value: undefined as never })).toBe('');
  });

  it('returns input when value is string', () => {
    expect(extractFieldValue('text')).toBe('text');
  });

  it('returns empty string for unsupported runtime types', () => {
    expect(extractFieldValue(123 as never)).toBe('');
  });
});
