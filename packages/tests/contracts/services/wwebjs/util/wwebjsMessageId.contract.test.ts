import { extractWwebjsMessageId } from '@core/services/wwebjs/util/wwebjsMessageId';

describe('extractWwebjsMessageId', () => {
  it('extracts the new production id shape from $1 without _serialized', () => {
    const message = {
      id: {
        fromMe: false,
        remote: '158733669765176@lid',
        remoteJid: '158733669765176@lid',
        id: '3EB0D96A98D7EC10E7C610',
        $1: 'false_158733669765176@lid_3EB0D96A98D7EC10E7C610',
        name: 'MessageKey',
      },
    };

    expect(extractWwebjsMessageId(message)).toBe(
      'false_158733669765176@lid_3EB0D96A98D7EC10E7C610'
    );
  });

  it('keeps distinct new-shape ids distinct', () => {
    const first = {
      fromMe: true,
      remote: '158733669765176@lid',
      id: 'STANZA-ONE',
      $1: 'true_158733669765176@lid_STANZA-ONE',
    };
    const second = {
      fromMe: true,
      remote: '158733669765176@lid',
      id: 'STANZA-TWO',
      $1: 'true_158733669765176@lid_STANZA-TWO',
    };

    expect(extractWwebjsMessageId(first)).toBe(
      'true_158733669765176@lid_STANZA-ONE'
    );
    expect(extractWwebjsMessageId(second)).toBe(
      'true_158733669765176@lid_STANZA-TWO'
    );
    expect(extractWwebjsMessageId(first)).not.toBe(
      extractWwebjsMessageId(second)
    );
  });

  it('reconstructs an id from fromMe, remote and stanza id', () => {
    expect(
      extractWwebjsMessageId({
        id: {
          fromMe: true,
          remote: {
            server: 'c.us',
            user: '5511999999999',
            _serialized: '5511999999999@c.us',
          },
          id: 'ABC123',
        },
      })
    ).toBe('true_5511999999999@c.us_ABC123');

    expect(
      extractWwebjsMessageId({
        fromMe: false,
        remoteJid: '5511888888888@c.us',
        stanzaId: 'DEF456',
      })
    ).toBe('false_5511888888888@c.us_DEF456');
  });

  it('preserves participant when reconstructing a four-part message id', () => {
    expect(
      extractWwebjsMessageId({
        id: {
          fromMe: false,
          remote: '120363012345678@g.us',
          id: 'ABC123',
          participant: {
            _serialized: '5511999999999@s.whatsapp.net',
          },
        },
      })
    ).toBe('false_120363012345678@g.us_ABC123_5511999999999@s.whatsapp.net');
  });

  it('preserves legacy snake-case and boolean-like key aliases', () => {
    expect(
      extractWwebjsMessageId({
        from_me: 'true',
        remote_jid: '5511999999999@c.us',
        ID: 'LEGACY-ONE',
      })
    ).toBe('true_5511999999999@c.us_LEGACY-ONE');

    expect(
      extractWwebjsMessageId({
        fromMe: 0,
        remote_jid_alt: '5511888888888@c.us',
        stanzaID: 'LEGACY-TWO',
      })
    ).toBe('false_5511888888888@c.us_LEGACY-TWO');
  });

  it('supports serialized strings and _serialized ids', () => {
    expect(extractWwebjsMessageId(' message-id ')).toBe('message-id');
    expect(
      extractWwebjsMessageId({
        id: { _serialized: 'false_5511@c.us_MESSAGE' },
      })
    ).toBe('false_5511@c.us_MESSAGE');
  });

  it('never serializes an object as [object Object]', () => {
    expect(extractWwebjsMessageId({ id: {} })).toBeUndefined();
    expect(extractWwebjsMessageId({ arbitrary: true })).toBeUndefined();
    expect(extractWwebjsMessageId('[object Object]')).toBeUndefined();
  });
});
