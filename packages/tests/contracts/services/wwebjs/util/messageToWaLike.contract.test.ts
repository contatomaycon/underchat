import { messageToWaLike } from '@core/services/wwebjs/util/messageToWaLike';

describe('messageToWaLike', () => {
  it('returns undefined when message has no id', () => {
    expect(messageToWaLike(null)).toBeUndefined();
    expect(messageToWaLike({} as never)).toBeUndefined();
  });

  it('maps group messages with author as participant', () => {
    const output = messageToWaLike({
      id: { _serialized: 'id1', remoteJid: '123@g.us' },
      to: '123@g.us',
      fromMe: true,
      author: '5511@s.whatsapp.net',
    } as never);

    expect(output).toEqual({
      key: {
        id: 'id1',
        remoteJid: '123@g.us',
        remote_jid: '123@g.us',
        fromMe: true,
        from_me: true,
        participant: '5511@s.whatsapp.net',
      },
    });
  });

  it('maps non-group messages and defaults fromMe to false', () => {
    const output = messageToWaLike({
      id: 'id2',
      from: '5511@s.whatsapp.net',
      to: '5522@s.whatsapp.net',
      fromMe: false,
    } as never);

    expect(output).toEqual({
      key: {
        id: 'id2',
        remoteJid: '5522@s.whatsapp.net',
        remote_jid: '5522@s.whatsapp.net',
        fromMe: false,
        from_me: false,
        participant: undefined,
      },
    });
  });

  it('maps the new WWebJS id shape without _serialized', () => {
    const serializedId = 'false_158733669765176@lid_3EB0D96A98D7EC10E7C610';
    const output = messageToWaLike({
      id: {
        fromMe: false,
        remote: '158733669765176@lid',
        remoteJid: '158733669765176@lid',
        id: '3EB0D96A98D7EC10E7C610',
        $1: serializedId,
        name: 'MessageKey',
      },
      from: '158733669765176@lid',
      fromMe: false,
    } as never);

    expect(output?.key.id).toBe(serializedId);
    expect(output?.key.id).not.toBe('[object Object]');
    expect(output?.key.remoteJid).toBe('158733669765176@lid');
  });
});
