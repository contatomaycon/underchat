import { parseSerializedMessageId } from '@core/common/functions/parseSerializedMessageId';

describe('parseSerializedMessageId', () => {
  it('returns null for empty or malformed values', () => {
    expect(parseSerializedMessageId()).toBeNull();
    expect(parseSerializedMessageId(null)).toBeNull();
    expect(parseSerializedMessageId('   ')).toBeNull();
    expect(parseSerializedMessageId('invalid')).toBeNull();
    expect(parseSerializedMessageId('maybe_remote_stanza')).toBeNull();
    expect(parseSerializedMessageId('true__stanza')).toBeNull();
    expect(parseSerializedMessageId('true_remote_')).toBeNull();
  });

  it('parses valid serialized value', () => {
    expect(parseSerializedMessageId('true_12345@s.whatsapp.net_ABCD')).toEqual({
      fromMe: true,
      remoteJid: '12345@s.whatsapp.net',
      stanzaId: 'ABCD',
    });
  });

  it('supports underscores inside the remoteJid segment', () => {
    expect(
      parseSerializedMessageId('false_group_name@g.us_message-123')
    ).toEqual({
      fromMe: false,
      remoteJid: 'group_name@g.us',
      stanzaId: 'message-123',
    });
  });
});
