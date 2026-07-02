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
  afterEach(() => {
    jest.restoreAllMocks();
  });

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

  it('converts WWebJS button payloads into text content with button metadata', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      type: 'buttons',
      body: '',
      _data: {
        buttonsMessage: {
          contentText: 'Escolha uma opção',
          footerText: 'Underchat',
          headerType: 1,
          buttons: [
            {
              buttonId: '1',
              buttonText: { displayText: 'Atendimento' },
              type: 1,
            },
            {
              buttonId: '2',
              buttonText: { displayText: 'Financeiro' },
              type: 1,
            },
          ],
        },
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;

    expect(upsert?.type).toBe(EMessageType.text);
    expect(upsert?.content).toEqual(
      expect.objectContaining({
        message: 'Escolha uma opção',
        buttons: expect.objectContaining({
          text: 'Escolha uma opção',
          footer: 'Underchat',
          buttons: [
            {
              id: '1',
              display_text: 'Atendimento',
              type: 1,
            },
            {
              id: '2',
              display_text: 'Financeiro',
              type: 1,
            },
          ],
        }),
      })
    );
    expect(innerMessage.buttonsMessage).toEqual(
      expect.objectContaining({
        contentText: 'Escolha uma opção',
        buttons: [
          {
            buttonId: '1',
            buttonText: { displayText: 'Atendimento' },
            type: 1,
          },
          {
            buttonId: '2',
            buttonText: { displayText: 'Financeiro' },
            type: 1,
          },
        ],
      })
    );
    expect(warn).toHaveBeenCalledWith(
      '[WWEBJS_INCOMING_DEBUG]',
      expect.stringContaining('wwebjs.message_to_upsert.buttons')
    );
  });

  it('converts unknown WWebJS message types with body into system fallback', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      type: 'unknown_reaction_status',
      body: 'this should not become a chatbot text trigger',
      _data: {
        type: 'unknown_reaction_status',
      },
    } as never);

    expect(upsert?.type).toBe(EMessageType.system);
    expect(upsert?.content?.message).toBe(
      'this should not become a chatbot text trigger'
    );
  });
});
