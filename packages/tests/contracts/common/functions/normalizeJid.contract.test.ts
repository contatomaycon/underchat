import {
  createJidNormalizer,
  normalizeJid,
} from '@core/common/functions/normalizeJid';

describe('normalizeJid', () => {
  it('returns undefined for empty jid', () => {
    expect(normalizeJid(undefined)).toBeUndefined();
    expect(normalizeJid(null)).toBeUndefined();
    expect(normalizeJid('')).toBeUndefined();
  });

  it.each([
    ['PN', '5511999999999@s.whatsapp.net', '5511999999999@s.whatsapp.net'],
    ['c.us', '5511999999999@c.us', '5511999999999@s.whatsapp.net'],
    [
      'device',
      '5511999999999:17@s.whatsapp.net',
      '5511999999999@s.whatsapp.net',
    ],
    [
      'agent/domain type',
      '5511999999999_128:17@hosted',
      '5511999999999@hosted',
    ],
    ['LID', '987654321:4@lid', '987654321@lid'],
    ['hosted', '5511999999999:8@hosted', '5511999999999@hosted'],
    ['hosted LID', '987654321_129:8@hosted.lid', '987654321@hosted.lid'],
    ['group', '120363012345678@g.us', '120363012345678@g.us'],
    ['broadcast', 'status@broadcast', 'status@broadcast'],
    ['newsletter', '123456789@newsletter', '123456789@newsletter'],
    ['malformed value', 'invalid', ''],
    [
      'surrounding whitespace',
      '  5511999999999@s.whatsapp.net  ',
      '5511999999999@s.whatsapp.net',
    ],
    ['whitespace-only value', '   ', ''],
  ])('matches jidNormalizedUser for %s jids', (_case, input, expected) => {
    expect(normalizeJid(input)).toBe(expected);
  });

  it('falls back to the trimmed raw value when normalization throws', () => {
    const normalizeWithFailure = createJidNormalizer(() => {
      throw new Error('invalid');
    });

    expect(normalizeWithFailure('  5511999999999:17@lid  ')).toBe(
      '5511999999999:17@lid'
    );
    expect(normalizeWithFailure('5511999999999@c.us')).toBe(
      '5511999999999@s.whatsapp.net'
    );
  });
});
