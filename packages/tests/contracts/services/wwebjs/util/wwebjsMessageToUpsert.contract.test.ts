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

  it('uses $1 as the canonical id for the new WWebJS message shape', async () => {
    const serializedId = 'false_158733669765176@lid_3EB0D96A98D7EC10E7C610';
    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      id: {
        fromMe: false,
        remote: '158733669765176@lid',
        remoteJid: '158733669765176@lid',
        id: '3EB0D96A98D7EC10E7C610',
        $1: serializedId,
        name: 'MessageKey',
      },
      type: 'chat',
      body: 'Oi',
      from: '158733669765176@lid',
      fromMe: false,
    } as never);

    expect(upsert?.message.key.id).toBe(serializedId);
    expect(upsert?.message.key.id).not.toBe('[object Object]');
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

  it('converts native flow CTA URL payloads into official display metadata', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      type: 'chat',
      body: 'Clique no link para abrir',
      _data: {
        interactiveMessage: {
          body: { text: 'Clique no link para abrir' },
          nativeFlowMessage: {
            buttons: [
              {
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: 'Underchat',
                  url: 'https://underchat.com.br/',
                }),
              },
            ],
          },
        },
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;

    expect(upsert?.type).toBe(EMessageType.text);
    expect(upsert?.content).toMatchObject({
      type: EMessageType.text,
      message: 'Clique no link para abrir',
      official: {
        provider: 'meta_whatsapp',
        type: 'interactive',
        display: {
          kind: 'cta_url',
          raw_type: 'cta_url',
          body: 'Clique no link para abrir',
          action_label: 'Underchat',
          actions: [
            {
              type: 'cta_url',
              title: 'Underchat',
              url: 'https://underchat.com.br/',
            },
          ],
        },
      },
    });
    expect(innerMessage.interactiveMessage).toMatchObject({
      body: { text: 'Clique no link para abrir' },
      nativeFlowMessage: {
        buttons: [
          expect.objectContaining({
            name: 'cta_url',
          }),
        ],
      },
    });
  });

  it('converts WWebJS template chat echoes into official template display metadata', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const body =
      'O seu pedido Brasil está registado. Entraremos em contato com você dentro de 48 horas.';
    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      id: {
        ...baseMessage.id,
        fromMe: true,
        id: 'CEC299B0592B74D4AA3D',
        _serialized: 'true_158733669765176@lid_CEC299B0592B74D4AA3D',
      },
      type: 'chat',
      body,
      fromMe: true,
      from: '556192037138@c.us',
      to: '158733669765176@lid',
      _data: {
        body,
        isFromTemplate: true,
        templateId: 'pedido_brasil',
        hsmCategory: 'utility',
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;

    expect(upsert?.type).toBe(EMessageType.text);
    expect(innerMessage.conversation).toBe(body);
    expect(upsert?.content).toMatchObject({
      type: EMessageType.text,
      message: body,
      official_template: {
        name: 'pedido_brasil',
        language: '',
      },
      official: {
        provider: 'meta_whatsapp',
        type: 'template',
        display: {
          kind: 'template',
          raw_type: 'template',
          title: null,
          body,
          footer: null,
          actions: [],
        },
      },
    });
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

  it('uses WWebJS button response display text instead of the selected button id', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      type: 'buttons_response',
      body: '1',
      _data: {
        body: 'Atendimento',
        selectedButtonId: '1',
        quotedMsg: {
          type: 'chat',
          body: 'Escolha uma opção',
          isDynamicReplyButtonsMsg: true,
          dynamicReplyButtons: [
            {
              buttonId: '1',
              buttonText: { displayText: 'Atendimento' },
              type: 1,
            },
          ],
        },
        quotedStanzaID: 'BUTTONS_MESSAGE_ID',
        quotedParticipant: '5500000000000@c.us',
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;

    expect(upsert?.type).toBe(EMessageType.text);
    expect(upsert?.content?.message).toBe('Atendimento');
    expect(innerMessage.conversation).toBe('Atendimento');
    expect(innerMessage.buttonsResponseMessage).toEqual({
      selectedDisplayText: 'Atendimento',
    });
    expect(innerMessage.extendedTextMessage).toMatchObject({
      contextInfo: {
        stanzaId: 'BUTTONS_MESSAGE_ID',
        quotedMessage: {
          buttonsMessage: {
            contentText: 'Escolha uma opção',
            buttons: [
              {
                buttonId: '1',
                buttonText: { displayText: 'Atendimento' },
                type: 1,
              },
            ],
          },
        },
      },
    });
  });

  it('converts WWebJS list payloads into text content with list metadata', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      id: {
        ...baseMessage.id,
        id: 'LIST_MESSAGE_ID',
        _serialized: 'true_5511999999999@c.us_LIST_MESSAGE_ID',
      },
      fromMe: true,
      type: 'list',
      body: '',
      _data: {
        list: {
          description: 'Escolha uma opção',
          buttonText: 'Selecionar',
          listType: 1,
          sections: [
            {
              rows: [
                {
                  rowId: '1',
                  title: 'Endereço e finalizar',
                  description: 'Descrição da opção 1',
                },
                {
                  rowId: '2',
                  title: 'Opção 2',
                  description: 'Localização e Atendimento',
                },
              ],
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
        list: expect.objectContaining({
          text: 'Escolha uma opção',
          button_text: 'Selecionar',
          list_type: 1,
          sections: [
            {
              id: 'section-1',
              title: null,
              rows: [
                {
                  id: '1',
                  title: 'Endereço e finalizar',
                  description: 'Descrição da opção 1',
                },
                {
                  id: '2',
                  title: 'Opção 2',
                  description: 'Localização e Atendimento',
                },
              ],
            },
          ],
        }),
      })
    );
    expect(innerMessage.listMessage).toEqual(
      expect.objectContaining({
        description: 'Escolha uma opção',
        buttonText: 'Selecionar',
        listType: 1,
      })
    );
    expect(warn).toHaveBeenCalledWith(
      '[WWEBJS_INCOMING_DEBUG]',
      expect.stringContaining('wwebjs.message_to_upsert.list')
    );
  });

  it('uses WWebJS list response title with quoted list metadata', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    const upsert = await wwebjsMessageToUpsert({
      ...baseMessage,
      id: {
        ...baseMessage.id,
        id: 'LIST_RESPONSE_ID',
        _serialized: 'false_5511999999999@c.us_LIST_RESPONSE_ID',
      },
      type: 'list_response',
      body: '2',
      _data: {
        body: 'Opção 2\nLocalização e Atendimento',
        listResponse: {
          title: 'Opção 2',
          description: 'Localização e Atendimento',
          singleSelectReply: {
            selectedRowId: '2',
          },
        },
        quotedMsg: {
          type: 'list',
          list: {
            description: 'Escolha uma opção',
            buttonText: 'Selecionar',
            listType: 1,
            sections: [
              {
                rows: [
                  {
                    rowId: '2',
                    title: 'Opção 2',
                    description: 'Localização e Atendimento',
                  },
                ],
              },
            ],
          },
        },
        quotedStanzaID: 'LIST_MESSAGE_ID',
        quotedParticipant: '5500000000000@c.us',
      },
    } as never);

    const innerMessage = upsert?.message.message as Record<string, any>;

    expect(upsert?.type).toBe(EMessageType.text);
    expect(upsert?.content?.message).toBe('Opção 2');
    expect(innerMessage.conversation).toBe('Opção 2');
    expect(innerMessage.listResponseMessage).toEqual({
      title: 'Opção 2',
      description: 'Localização e Atendimento',
      singleSelectReply: {
        selectedRowId: '2',
      },
    });
    expect(innerMessage.extendedTextMessage).toMatchObject({
      contextInfo: {
        stanzaId: 'LIST_MESSAGE_ID',
        quotedMessage: {
          listMessage: {
            description: 'Escolha uma opção',
            buttonText: 'Selecionar',
            listType: 1,
          },
        },
      },
    });
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

  it('routes quoted-message SDK lookup through the supplied provider boundary', async () => {
    const getQuotedMessage = jest.fn(async () => ({
      ...baseMessage,
      id: {
        ...baseMessage.id,
        id: 'QUOTED_MESSAGE_ID',
        _serialized: 'false_5511999999999@c.us_QUOTED_MESSAGE_ID',
      },
      type: 'chat',
      body: 'mensagem citada',
    }));
    let invokeProviderCalls = 0;
    const invokeProvider = async <T>(invoke: () => Promise<T>): Promise<T> => {
      invokeProviderCalls += 1;
      return invoke();
    };

    const upsert = await wwebjsMessageToUpsert(
      {
        ...baseMessage,
        type: 'chat',
        body: 'resposta',
        hasQuotedMsg: true,
        getQuotedMessage,
      } as never,
      undefined,
      undefined,
      undefined,
      invokeProvider
    );

    expect(upsert).not.toBeNull();
    expect(invokeProviderCalls).toBe(1);
    expect(getQuotedMessage).toHaveBeenCalledTimes(1);
  });

  it('does not downgrade a quoted-message provider fence into missing context', async () => {
    const providerFenceError = Object.assign(
      new Error('quoted-message lookup timed out'),
      {
        code: 'WHATSAPP_PROVIDER_AUXILIARY_TIMEOUT',
      }
    );
    const getQuotedMessage = jest.fn();
    let invokeProviderCalls = 0;
    const invokeProvider = async <T>(_invoke: () => Promise<T>): Promise<T> => {
      invokeProviderCalls += 1;
      throw providerFenceError;
    };

    await expect(
      wwebjsMessageToUpsert(
        {
          ...baseMessage,
          type: 'chat',
          body: 'resposta',
          hasQuotedMsg: true,
          getQuotedMessage,
        } as never,
        undefined,
        undefined,
        undefined,
        invokeProvider
      )
    ).rejects.toBe(providerFenceError);

    expect(invokeProviderCalls).toBe(1);
    expect(getQuotedMessage).not.toHaveBeenCalled();
  });
});
