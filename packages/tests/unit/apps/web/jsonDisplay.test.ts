import {
  formatJsonForDisplay,
  parseSerializedJson,
} from '@core/common/functions/jsonDisplay';

describe('outbound webhook JSON display', () => {
  it('formats a JSON response body with real line breaks', () => {
    expect(formatJsonForDisplay('{"ok":true,"received":true}', '—')).toBe(
      ['{', '  "ok": true,', '  "received": true', '}'].join('\n')
    );
  });

  it('decodes a response body serialized twice', () => {
    const body = JSON.stringify(
      JSON.stringify({ ok: true, nested: { value: 1 } })
    );

    expect(parseSerializedJson(body)).toEqual({
      ok: true,
      nested: { value: 1 },
    });
    expect(formatJsonForDisplay(body, '—')).toContain('\n  "nested": {\n');
  });

  it('formats JSON response bodies nested in the attempt history', () => {
    const formatted = formatJsonForDisplay(
      [
        {
          attemptNumber: 1,
          outcome: 'succeeded',
          responseBody: '{\n  "ok": true,\n  "received": true\n}',
        },
      ],
      '—'
    );

    expect(formatted).toContain(
      [
        '    "responseBody": {',
        '      "ok": true,',
        '      "received": true',
      ].join('\n')
    );
    expect(formatted).not.toContain('\\n');
  });

  it('preserves plain text and its existing line breaks', () => {
    const body = 'accepted\nwithout a JSON document';

    expect(formatJsonForDisplay(body, '—')).toBe(body);
  });

  it('uses the supplied empty-state label for nullish content', () => {
    expect(formatJsonForDisplay(null, 'Sem conteúdo')).toBe('Sem conteúdo');
    expect(formatJsonForDisplay(undefined, 'Sem conteúdo')).toBe(
      'Sem conteúdo'
    );
  });
});
