import { escapeShellDoubleQuotes } from '@core/common/functions/escapeShellDoubleQuotes';

describe('escapeShellDoubleQuotes', () => {
  it('escapes shell-sensitive chars used inside double quotes', () => {
    expect(escapeShellDoubleQuotes('$HOME "quoted" \\path `cmd`')).toBe(
      '\\$HOME \\"quoted\\" \\\\path \\`cmd\\`'
    );
  });

  it('keeps regular text unchanged', () => {
    expect(escapeShellDoubleQuotes('hello world')).toBe('hello world');
  });
});
