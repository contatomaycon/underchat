jest.mock('@core/config/environments', () => ({
  wwebjsEnvironment: {
    wwebjsWorkerId: 'worker-1',
    wwebjsAccountId: 'account-1',
  },
}));

jest.mock('@core/common/functions/normalizeJid', () => ({
  normalizeJid: jest.fn((jid: string) => jid),
}));

import { EMessageType } from '@core/common/enums/EMessageType';
import { wwebjsMessageToUpsert } from '@core/services/wwebjs/util/wwebjsMessageToUpsert';

const baseMessage = {
  id: {
    fromMe: false,
    remote: '5511999999999@c.us',
    id: 'ABCDEF1234567890',
    _serialized: 'false_5511999999999@c.us_ABCDEF1234567890',
  },
  ack: 0,
  from: '5511999999999@c.us',
  to: '5500000000000@c.us',
  fromMe: false,
  timestamp: 1778113722,
  hasQuotedMsg: false,
};

describe('wwebjsMessageToUpsert', () => {
  it('converts automated greeting messages into readable text with ad context', async () => {
    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      type: 'automated_greeting_message',
      body: '',
      _data: {
        ctwaContext: {
          sourceApp: 'instagram',
          sourceType: 'ad',
          sourceUrl: 'https://www.instagram.com/p/example/',
          greetingMessageBody: 'Hello! How can we help you?',
          automatedGreetingMessageShown: true,
        },
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;
    const externalAdReply =
      innerMessage.extendedTextMessage.contextInfo.externalAdReply;

    expect(upsert?.type).toBe(EMessageType.text);
    expect(innerMessage.conversation).toBe('Hello! How can we help you?');
    expect(innerMessage.extendedTextMessage.text).toBe(
      'Hello! How can we help you?'
    );
    expect(externalAdReply).toEqual(
      expect.objectContaining({
        sourceApp: 'instagram',
        sourceType: 'ad',
        sourceUrl: 'https://www.instagram.com/p/example/',
        greetingMessageBody: 'Hello! How can we help you?',
        automatedGreetingMessageShown: true,
      })
    );
  });

  it('uses interactive captions and headers for text and ad title metadata', async () => {
    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      id: {
        ...baseMessage.id,
        id: 'INTERACTIVE123',
        _serialized: 'false_5511999999999@c.us_INTERACTIVE123',
      },
      type: 'interactive',
      body: '',
      _data: {
        caption: 'Hello! How can we help you?',
        ctwaContext: {
          sourceApp: 'facebook',
          greetingMessageBody: 'Hello! How can we help you?',
          automatedGreetingMessageShown: true,
        },
        interactiveHeader: {
          title: 'Facebook ad',
          subtitle: 'Show details',
          thumbnail: 'https://cdn.test/ad.jpg',
          hasMediaAttachment: true,
        },
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;
    const externalAdReply =
      innerMessage.extendedTextMessage.contextInfo.externalAdReply;

    expect(upsert?.type).toBe(EMessageType.text);
    expect(innerMessage.extendedTextMessage.text).toBe(
      'Hello! How can we help you?'
    );
    expect(externalAdReply).toEqual(
      expect.objectContaining({
        title: 'Facebook ad',
        thumbnailUrl: 'https://cdn.test/ad.jpg',
        sourceApp: 'facebook',
        greetingMessageBody: 'Hello! How can we help you?',
        automatedGreetingMessageShown: true,
      })
    );
  });

  it('converts ciphertext into a visible system fallback message', async () => {
    const fallbackText =
      'Você recebeu uma mensagem, mas ela não pôde ser descriptografada neste dispositivo.\nIsso pode ocorrer por ser uma mensagem de anúncio ou por estar em processo de sincronização. Verifique no dispositivo principal.';

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      type: 'ciphertext',
      body: '',
      _data: {
        subtype: 'fanout',
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;

    expect(upsert?.type).toBe(EMessageType.system);
    expect(innerMessage.conversation).toBe(fallbackText);
  });

  it('uses the same fallback for ciphertext without a subtype', async () => {
    const fallbackText =
      'Você recebeu uma mensagem, mas ela não pôde ser descriptografada neste dispositivo.\nIsso pode ocorrer por ser uma mensagem de anúncio ou por estar em processo de sincronização. Verifique no dispositivo principal.';

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      type: 'ciphertext',
      body: '',
      _data: {},
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;

    expect(upsert?.type).toBe(EMessageType.system);
    expect(innerMessage.conversation).toBe(fallbackText);
  });
});
