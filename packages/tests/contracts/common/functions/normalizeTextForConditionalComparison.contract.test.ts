import { normalizeTextForConditionalComparison } from '@core/common/functions/normalizeTextForConditionalComparison';

describe('normalizeTextForConditionalComparison', () => {
  it('normalizes case, trims spaces and removes accents', () => {
    expect(normalizeTextForConditionalComparison('  Çafé COM Leite  ')).toBe(
      'cafe com leite'
    );
  });

  it('returns empty string for invalid values at runtime', () => {
    expect(normalizeTextForConditionalComparison('')).toBe('');
    expect(normalizeTextForConditionalComparison(null as never)).toBe('');
    expect(normalizeTextForConditionalComparison(123 as never)).toBe('');
  });
});
