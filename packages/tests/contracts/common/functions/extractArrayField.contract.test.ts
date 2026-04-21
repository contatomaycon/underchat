import { extractArrayField } from '@core/common/functions/extractArrayField';

describe('extractArrayField', () => {
  it('returns empty array for missing field', () => {
    expect(extractArrayField(undefined)).toEqual([]);
  });

  it('processes string values and json-array strings', () => {
    expect(extractArrayField({ value: '  abc  ' })).toEqual(['abc']);
    expect(extractArrayField({ value: '["a"," b ",""]' })).toEqual(['a', 'b']);
  });

  it('falls back to plain trimmed string when json parsing has no items', () => {
    expect(extractArrayField({ value: '[]' })).toEqual(['[]']);
    expect(extractArrayField({ value: '[1,2]' })).toEqual(['[1,2]']);
    expect(extractArrayField({ value: '[a]' })).toEqual(['[a]']);
    expect(extractArrayField({ value: '["a"' })).toEqual(['["a"']);
    expect(extractArrayField({ value: '"just-string-json"' })).toEqual([
      '"just-string-json"',
    ]);
    expect(extractArrayField({ value: '   ' })).toEqual([]);
  });

  it('processes array values and expands nested json-array items', () => {
    expect(
      extractArrayField({
        value: ['x', '  ', '["a"," b "]', '[1,2]'],
      })
    ).toEqual(['x', 'a', 'b', '[1,2]']);
  });

  it('returns empty array for unsupported runtime value type', () => {
    expect(extractArrayField({ value: 123 as never })).toEqual([]);
  });
});
