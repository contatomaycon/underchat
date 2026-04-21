import {
  getAuthorJid,
  isGroupMessage,
} from '@core/common/functions/getAuthorJid';

describe('getAuthorJid helpers', () => {
  it('detects group messages by group jid or participant field', () => {
    expect(
      isGroupMessage({
        key: { remoteJid: '123@g.us' },
      } as never)
    ).toBe(true);

    expect(
      isGroupMessage({
        key: {
          remoteJid: '123@s.whatsapp.net',
          participant: 'x@s.whatsapp.net',
        },
      } as never)
    ).toBe(true);
  });

  it('returns participant for group message when available', () => {
    expect(
      getAuthorJid({
        key: { remoteJid: '123@g.us', participant: '5511@s.whatsapp.net' },
      } as never)
    ).toBe('5511@s.whatsapp.net');
  });

  it('returns socket user id for own group messages without participant', () => {
    expect(
      getAuthorJid(
        { key: { remoteJid: '123@g.us', fromMe: true } } as never,
        { user: { id: 'me@s.whatsapp.net' } } as never
      )
    ).toBe('me@s.whatsapp.net');
  });

  it('falls back to remoteJid for non-group messages', () => {
    expect(
      getAuthorJid({
        key: { remoteJid: '5511@s.whatsapp.net' },
      } as never)
    ).toBe('5511@s.whatsapp.net');
  });

  it('treats messages without group jid and participant as non-group', () => {
    expect(
      isGroupMessage({
        key: { remoteJid: '5511@s.whatsapp.net' },
      } as never)
    ).toBe(false);

    expect(
      isGroupMessage({
        key: {},
      } as never)
    ).toBe(false);
  });
});
