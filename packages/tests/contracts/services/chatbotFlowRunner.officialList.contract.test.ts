import 'reflect-metadata';

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';

const makeService = () => {
  const redis = {
    del: jest.fn(async () => 1),
  };
  const chatService = {
    findChatByChatId: jest.fn(),
  };
  const chatMessageService = {
    sendMessage: jest.fn(async () => true),
    publishPreparedMessage: jest.fn(async () => true),
  };
  const contactService = {
    getContactByPhone: jest.fn(async () => null),
  };

  const dependencies = [
    redis as never,
    {} as never,
    chatService as never,
    chatMessageService as never,
    contactService as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ] satisfies ConstructorParameters<typeof ChatbotFlowRunnerService>;

  const service = new ChatbotFlowRunnerService(...dependencies);

  return {
    service,
    redis,
    chatService,
    chatMessageService,
    contactService,
  };
};

const makeChat = (): IChat =>
  ({
    chat_id: 'chat-1',
    status: EChatStatus.ura,
    name: 'Maycon',
    account: { id: 'account-1', name: 'Underchat' },
    worker: { id: 'worker-1', name: 'Oficial WhatsApp' },
    user: null,
    sector: null,
  }) as unknown as IChat;

const makeListNode = (): ListChatbotFlowResponse['nodes'][number] => ({
  id: 'list-node',
  type: 'officialList',
  position: { x: 0, y: 0 },
  data: {
    title: 'Lista oficial',
    message: 'Escolha uma opção',
    buttonText: 'Selecionar',
    sections: [],
    options: [
      {
        id: '1',
        text: 'Endereço e finalizar',
        description: 'Descrição da opção 1',
      },
      {
        id: '2',
        text: 'Linha',
        description: '',
      },
    ],
  },
});

describe('ChatbotFlowRunnerService official list payload', () => {
  it('uses node options when internal sections data is empty', async () => {
    const { service } = makeService();
    const runner = service as unknown as {
      buildOfficialInteractivePayload: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<Record<string, unknown> | null>;
    };

    const interactive = await runner.buildOfficialInteractivePayload(
      (key) => key,
      makeChat(),
      makeListNode()
    );

    expect(interactive).toEqual(
      expect.objectContaining({
        type: 'list',
        action: {
          button: 'Selecionar',
          sections: [
            {
              title: 'Opções',
              rows: [
                {
                  id: '1',
                  title: 'Endereço e finalizar',
                  description: 'Descrição da opção 1',
                },
                {
                  id: '2',
                  title: 'Linha',
                },
              ],
            },
          ],
        },
      })
    );
  });

  it('advances to the selected edge when a list_reply is received', async () => {
    const { service } = makeService();
    const runner = service as unknown as {
      processOfficialOptionNodeResponse: (
        t: (key: string) => string,
        data: IUpsertMessage,
        createChat: IChat,
        chatbotFlow: ListChatbotFlowResponse,
        currentFlowId: string
      ) => Promise<boolean>;
      processNextNode: jest.Mock;
      resetFailedAttempts: jest.Mock;
    };
    runner.processNextNode = jest.fn(async () => true);
    runner.resetFailedAttempts = jest.fn(async () => undefined);

    const chat = makeChat();
    const flow: ListChatbotFlowResponse = {
      chatbot_flow_id: 'flow-1',
      chatbot_id: 'chatbot-1',
      account_id: 'account-1',
      nodes: [
        makeListNode(),
        {
          id: 'address-node',
          type: 'officialAddress',
          position: { x: 100, y: 0 },
          data: {
            title: 'Endereço',
            message: 'Informe seu endereço',
            addressCountry: 'BR',
          },
        },
      ],
      edges: [
        {
          id: 'edge-1',
          source: 'list-node',
          target: 'address-node',
          sourceHandle: '1',
        },
      ],
      created_at: '2026-07-01T12:00:00.000Z',
      updated_at: '2026-07-01T12:00:00.000Z',
    };
    const upsert = {
      type: EMessageType.text,
      content: {
        type: EMessageType.text,
        message: 'Endereço e finalizar',
        official: {
          provider: 'meta_whatsapp',
          type: 'interactive',
          interactive: {
            type: 'list_reply',
            id: '1',
            title: 'Endereço e finalizar',
            description: 'Descrição da opção 1',
          },
        },
      },
    } as unknown as IUpsertMessage;

    await expect(
      runner.processOfficialOptionNodeResponse(
        (key) => key,
        upsert,
        chat,
        flow,
        'list-node'
      )
    ).resolves.toBe(true);

    expect(runner.processNextNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      flow,
      'address-node',
      undefined,
      upsert
    );
  });

  it('falls back to a text question for address collection when the official address country is unsupported', async () => {
    const { service, chatService, chatMessageService } = makeService();
    const runner = service as unknown as {
      sendOfficialNode: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<boolean>;
    };
    const chat = makeChat();
    chatService.findChatByChatId.mockResolvedValue(chat);

    await expect(
      runner.sendOfficialNode((key) => key, chat, {
        id: 'address-node',
        type: 'officialAddress',
        position: { x: 100, y: 0 },
        data: {
          title: 'Endereço',
          message: 'Informe seu endereço',
          addressCountry: 'BR',
          action: {
            name: 'address_message',
            parameters: {
              country: 'BR',
            },
          },
        },
      })
    ).resolves.toBe(true);

    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        type: EMessageType.text,
        message: 'Informe seu endereço',
        typeUser: 'bot',
      })
    );
  });

  it('keeps official template metadata when publishing a prepared template message', async () => {
    const { service, chatMessageService } = makeService();
    const runner = service as unknown as {
      sendOfficialNode: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<boolean>;
    };

    await expect(
      runner.sendOfficialNode((key) => key, makeChat(), {
        id: 'template-node',
        type: 'officialTemplate',
        position: { x: 100, y: 0 },
        data: {
          title: 'Template oficial',
          templateName: 'abertura',
          templateLanguage: 'pt_BR',
          templateCategory: 'MARKETING',
          templateComponents: [
            {
              type: 'BODY',
              text: 'Olá {{1}}',
            },
          ],
          templatePreview: {
            body: 'Olá {{1}}',
            buttons: ['Continuar'],
          },
          templateVariables: [
            {
              key: 'BODY:1',
              component_type: 'BODY',
              index: 1,
              button_index: null,
              value: 'Maycon',
            },
          ],
        },
      })
    ).resolves.toBe(true);

    expect(chatMessageService.publishPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          official_template: expect.objectContaining({
            name: 'abertura',
            language: 'pt_BR',
            category: 'MARKETING',
            components: [
              {
                type: 'BODY',
                text: 'Olá {{1}}',
              },
            ],
            preview: {
              body: 'Olá {{1}}',
              buttons: ['Continuar'],
            },
          }),
          official: expect.objectContaining({
            display: expect.objectContaining({
              body: 'Olá {{1}}',
              actions: [
                {
                  id: '0',
                  title: 'Continuar',
                  type: 'button',
                },
              ],
            }),
          }),
        }),
      })
    );
  });
});
