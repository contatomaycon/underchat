import { escapeShellSingleQuotes } from '@core/common/functions/escapeShellSingleQuotes';

describe('escapeShellSingleQuotes', () => {
  it('escapes single quotes for shell-safe usage', () => {
    expect(escapeShellSingleQuotes("it's ok")).toBe(`it'"'"'s ok`);
    expect(escapeShellSingleQuotes("a'b'c")).toBe(`a'"'"'b'"'"'c`);
  });

  it('keeps values without single quotes unchanged', () => {
    expect(escapeShellSingleQuotes('plain text')).toBe('plain text');
  });
});
