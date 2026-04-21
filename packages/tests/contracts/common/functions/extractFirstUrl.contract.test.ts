import { extractFirstUrl } from '@core/common/functions/extractFirstUrl';

describe('extractFirstUrl', () => {
  it('returns null for empty or text without URL', () => {
    expect(extractFirstUrl()).toBeNull();
    expect(extractFirstUrl('')).toBeNull();
    expect(extractFirstUrl('texto sem links')).toBeNull();
  });

  it('extracts an HTTP/HTTPS URL and trims trailing punctuation', () => {
    expect(extractFirstUrl('Veja isso: https://example.com/path?a=1).')).toBe(
      'https://example.com/path?a=1'
    );
  });

  it('normalizes www links to https', () => {
    expect(extractFirstUrl('Acesse www.example.com/teste!')).toBe(
      'https://www.example.com/teste'
    );
  });

  it('returns the earliest URL occurrence', () => {
    expect(
      extractFirstUrl(
        'Primeiro www.first.com e depois https://second.example.com'
      )
    ).toBe('https://www.first.com/');
  });
});
