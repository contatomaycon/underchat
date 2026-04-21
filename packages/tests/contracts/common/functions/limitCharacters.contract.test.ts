import { limitCharacters } from '@core/common/functions/limitCharacters';

describe('limitCharacters', () => {
  it('returns empty string for missing text', () => {
    expect(limitCharacters(10)).toBe('');
    expect(limitCharacters(10, null)).toBe('');
  });

  it('returns original text when it fits max length', () => {
    expect(limitCharacters(5, 'abc')).toBe('abc');
    expect(limitCharacters(3, 'abc')).toBe('abc');
  });

  it('truncates text without suffix', () => {
    expect(limitCharacters(4, 'abcdef')).toBe('abcd');
  });

  it('truncates text accounting suffix length', () => {
    expect(limitCharacters(8, 'abcdefghijk', '...')).toBe('abcde...');
  });

  it('keeps current behavior when suffix is longer than max', () => {
    expect(limitCharacters(2, 'abcdef', '....')).toBe('ab....');
  });
});
