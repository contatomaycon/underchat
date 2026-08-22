import 'reflect-metadata';

jest.mock('@core/common/vendors/nodeRdkafka', () => ({ rdkafka: {} }));

jest.mock('@whiskeysockets/baileys', () => ({
  jidNormalizedUser: jest.fn((jid: string) => jid),
  proto: {},
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(async (_redis, _key, fn: () => Promise<unknown>) => fn()),
}));

import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import type { IChat } from '@core/common/interfaces/IChat';
import type { IUpsertMessage } from '@core/common/interfaces/IUpsertMessage';
import type { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import {
  createChatbotFlowCacheKey,
  createChatbotInactivityCacheKey,
  createChatbotOfficialResponsePendingCacheKey,
} from '@core/common/functions/createCacheKey';

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
  const officialWhatsappConversationWindowService = {
    resolveAuthoritativeForChat: jest.fn(async () => ({
      state: 'open',
      can_send_freeform: true,
    })),
  };

  const dependencies = [
    redis as never,
    {} as never,
    chatService as never,
    {} as never,
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
  (
    service as unknown as {
      officialWhatsappConversationWindowService: typeof officialWhatsappConversationWindowService;
    }
  ).officialWhatsappConversationWindowService =
    officialWhatsappConversationWindowService;

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

interface RedisOperation {
  command: 'set' | 'zadd' | 'del' | 'zrem';
  args: unknown[];
}

const makeRuntimeService = (options?: {
  flow?: ListChatbotFlowResponse;
  configurations?: unknown;
}) => {
  const values = new Map<string, string>();
  const transactions: RedisOperation[][] = [];
  const redis = {
    get: jest.fn(async (key: string) => values.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (...keys: string[]) => {
      let deleted = 0;
      for (const key of keys) {
        if (values.delete(key)) {
          deleted += 1;
        }
      }
      return deleted;
    }),
    multi: jest.fn(() => {
      const operations: RedisOperation[] = [];
      const transaction = {
        set: jest.fn(),
        zadd: jest.fn(),
        del: jest.fn(),
        zrem: jest.fn(),
        exec: jest.fn(),
      };

      transaction.set.mockImplementation((...args: unknown[]) => {
        operations.push({ command: 'set', args });
        return transaction;
      });
      transaction.zadd.mockImplementation((...args: unknown[]) => {
        operations.push({ command: 'zadd', args });
        return transaction;
      });
      transaction.del.mockImplementation((...args: unknown[]) => {
        operations.push({ command: 'del', args });
        return transaction;
      });
      transaction.zrem.mockImplementation((...args: unknown[]) => {
        operations.push({ command: 'zrem', args });
        return transaction;
      });
      transaction.exec.mockImplementation(async () => {
        for (const operation of operations) {
          if (
            operation.command === 'set' &&
            typeof operation.args[0] === 'string' &&
            typeof operation.args[1] === 'string'
          ) {
            values.set(operation.args[0], operation.args[1]);
          }

          if (operation.command === 'del') {
            for (const key of operation.args) {
              if (typeof key === 'string') {
                values.delete(key);
              }
            }
          }
        }
        transactions.push(operations);
        return operations.map(() => [null, 'OK']);
      });

      return transaction;
    }),
  };
  const chat = makeChat();
  const chatbotService = {
    findChatbotFlowConfigurationsByChatbotId: jest.fn(
      async () => options?.configurations ?? null
    ),
    findChatbotFlowByChatbotId: jest.fn(async () => options?.flow ?? null),
  };
  const chatService = {
    findChatByChatId: jest.fn(async () => chat),
  };
  const chatMessageService = {
    sendMessage: jest.fn(async () => true),
    publishPreparedMessage: jest.fn(async () => true),
  };
  const contactService = {
    getContactByPhone: jest.fn(async () => null),
  };
  const officialWhatsappConversationWindowService = {
    resolveAuthoritativeForChat: jest.fn(async () => ({
      state: 'open',
      can_send_freeform: true,
    })),
  };

  const dependencies = [
    redis as never,
    chatbotService as never,
    chatService as never,
    {} as never,
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
  (
    service as unknown as {
      officialWhatsappConversationWindowService: typeof officialWhatsappConversationWindowService;
    }
  ).officialWhatsappConversationWindowService =
    officialWhatsappConversationWindowService;

  return {
    service,
    chat,
    redis,
    values,
    transactions,
    chatbotService,
    chatMessageService,
    officialWhatsappConversationWindowService,
  };
};

const makeTemplateFlow = (
  nextNode: ListChatbotFlowResponse['nodes'][number]
): ListChatbotFlowResponse => ({
  chatbot_flow_id: 'flow-1',
  chatbot_id: 'chatbot-1',
  account_id: 'account-1',
  nodes: [
    {
      id: 'template-node',
      type: 'officialTemplate',
      position: { x: 0, y: 0 },
      data: {
        title: 'Template oficial',
        templateName: 'abertura',
      },
    },
    nextNode,
  ],
  edges: [
    {
      id: 'template-edge',
      source: 'template-node',
      target: nextNode.id,
    },
  ],
  created_at: '2026-07-01T12:00:00.000Z',
  updated_at: '2026-07-01T12:00:00.000Z',
});

const makeInboundText = (text = 'continuar'): IUpsertMessage =>
  ({
    type: EMessageType.text,
    message: {
      key: { fromMe: false },
      message: { conversation: text },
    },
  }) as unknown as IUpsertMessage;

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

  it('rejects a body that exceeds the limit after variable resolution', async () => {
    const { service, chatMessageService } = makeService();
    const runner = service as unknown as {
      sendOfficialInteractiveNode: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<boolean>;
    };
    const chat = makeChat();
    chat.name = 'N'.repeat(1025);
    const node: ListChatbotFlowResponse['nodes'][number] = {
      id: 'buttons-node',
      type: 'officialReplyButtons',
      position: { x: 0, y: 0 },
      data: {
        message: '{{ name }}',
        options: [{ id: '1', text: 'Continuar' }],
      },
    };

    await expect(
      runner.sendOfficialInteractiveNode((key) => key, chat, node)
    ).rejects.toThrow('official_whatsapp_interactive_limit_exceeded');
    expect(chatMessageService.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps every configured option so invalid legacy flows fail instead of being truncated', async () => {
    const { service } = makeService();
    const runner = service as unknown as {
      buildOfficialInteractivePayload: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<{
        action: {
          buttons?: unknown[];
          sections?: Array<{ rows?: unknown[] }>;
        };
      } | null>;
    };
    const replyPayload = await runner.buildOfficialInteractivePayload(
      (key) => key,
      makeChat(),
      {
        id: 'buttons-node',
        type: 'officialReplyButtons',
        position: { x: 0, y: 0 },
        data: {
          message: 'Escolha',
          options: Array.from({ length: 4 }, (_, index) => ({
            id: String(index),
            text: `Opção ${index}`,
          })),
        },
      }
    );
    const listPayload = await runner.buildOfficialInteractivePayload(
      (key) => key,
      makeChat(),
      {
        id: 'list-node',
        type: 'officialList',
        position: { x: 0, y: 0 },
        data: {
          message: 'Escolha',
          buttonText: 'Selecionar',
          options: Array.from({ length: 11 }, (_, index) => ({
            id: String(index),
            text: `Opção ${index}`,
          })),
        },
      }
    );

    expect(replyPayload?.action.buttons).toHaveLength(4);
    expect(listPayload?.action.sections?.[0]?.rows).toHaveLength(11);
  });

  it('omits a stale legacy header from single-product payloads', async () => {
    const { service } = makeService();
    const runner = service as unknown as {
      buildOfficialInteractivePayload: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<Record<string, unknown> | null>;
    };

    const payload = await runner.buildOfficialInteractivePayload(
      (key) => key,
      makeChat(),
      {
        id: 'product-node',
        type: 'officialSingleProduct',
        position: { x: 0, y: 0 },
        data: {
          message: 'Produto',
          header: 'Cabeçalho legado',
          footer: 'Rodapé',
          catalogId: 'catalog-1',
          productRetailerId: 'product-1',
        },
      }
    );

    expect(payload).not.toHaveProperty('header');
    expect(payload).toHaveProperty('footer.text', 'Rodapé');
  });

  it('sends a CTA URL and advances to redirect even with a stale response wait', async () => {
    const googleSitesUrl =
      'https://sites.google.com/contabilidadehohl.com.br/atendimento';
    const ctaNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'cta-node',
      type: 'officialCtaUrl',
      position: { x: 100, y: 0 },
      data: {
        title: 'CTA URL',
        header: 'CTA URL',
        message: 'Abrir link',
        buttonText: 'Clique aqui',
        url: `  ${googleSitesUrl}  `,
        // Legacy/editor data must not park a CTA because opening its link
        // does not produce a WhatsApp response webhook.
        continueType: 'after_response',
      },
    };
    const redirectNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'redirect-node',
      type: 'redirect',
      position: { x: 200, y: 0 },
      data: {
        title: 'Redirecionar',
        redirectType: 'sector',
        selectedSector: 'sector-1',
      },
    };
    const flow: ListChatbotFlowResponse = {
      chatbot_flow_id: 'flow-cta',
      chatbot_id: 'chatbot-1',
      account_id: 'account-1',
      nodes: [ctaNode, redirectNode],
      edges: [
        {
          id: 'cta-to-redirect',
          source: ctaNode.id,
          target: redirectNode.id,
        },
      ],
    };
    const { service, chat, chatMessageService } = makeRuntimeService();
    const runner = service as unknown as {
      processOfficialNodeType: (
        t: (key: string) => string,
        createChat: IChat,
        chatbotFlow: ListChatbotFlowResponse,
        currentNode: ListChatbotFlowResponse['nodes'][number],
        currentFlowId: string
      ) => Promise<boolean>;
      processNextNode: jest.Mock;
    };
    runner.processNextNode = jest.fn(async () => true);

    await expect(
      runner.processOfficialNodeType(
        (key) => key,
        chat,
        flow,
        ctaNode,
        ctaNode.id
      )
    ).resolves.toBe(true);

    expect(chatMessageService.sendMessage).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        type: EMessageType.official_interactive,
        message: 'Abrir link',
        officialInteractive: {
          type: 'cta_url',
          summary: 'Abrir link',
          interactive: {
            type: 'cta_url',
            header: { type: 'text', text: 'CTA URL' },
            body: { text: 'Abrir link' },
            action: {
              name: 'cta_url',
              parameters: {
                display_text: 'Clique aqui',
                url: googleSitesUrl,
              },
            },
          },
        },
      })
    );
    expect(runner.processNextNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      flow,
      redirectNode.id,
      undefined,
      undefined
    );
  });

  it('does not advance a CTA when enqueueing the message really fails', async () => {
    const ctaNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'cta-node',
      type: 'officialCtaUrl',
      position: { x: 100, y: 0 },
      data: {
        message: 'Abrir link',
        buttonText: 'Clique aqui',
        url: 'https://sites.google.com/contabilidadehohl.com.br/atendimento',
      },
    };
    const flow: ListChatbotFlowResponse = {
      chatbot_flow_id: 'flow-cta',
      chatbot_id: 'chatbot-1',
      account_id: 'account-1',
      nodes: [
        ctaNode,
        {
          id: 'redirect-node',
          type: 'redirect',
          position: { x: 200, y: 0 },
          data: { redirectType: 'sector', selectedSector: 'sector-1' },
        },
      ],
      edges: [
        {
          id: 'cta-to-redirect',
          source: ctaNode.id,
          target: 'redirect-node',
        },
      ],
    };
    const { service, chat } = makeRuntimeService();
    const runner = service as unknown as {
      processOfficialNodeType: (
        t: (key: string) => string,
        createChat: IChat,
        chatbotFlow: ListChatbotFlowResponse,
        currentNode: ListChatbotFlowResponse['nodes'][number],
        currentFlowId: string
      ) => Promise<boolean>;
      sendOfficialNode: jest.Mock;
      processNextNode: jest.Mock;
    };
    runner.sendOfficialNode = jest.fn(async () => false);
    runner.processNextNode = jest.fn(async () => true);

    await expect(
      runner.processOfficialNodeType(
        (key) => key,
        chat,
        flow,
        ctaNode,
        ctaNode.id
      )
    ).resolves.toBe(false);

    expect(runner.processNextNode).not.toHaveBeenCalled();
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

  it('advances to the selected edge when a button_reply is received', async () => {
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
        {
          id: 'buttons-node',
          type: 'officialReplyButtons',
          position: { x: 0, y: 0 },
          data: {
            title: 'Botões oficiais',
            message: 'Escolha uma opção',
            options: [
              { id: 'documentation', text: 'Documentação' },
              { id: 'support', text: 'Atendimento' },
            ],
          },
        },
        {
          id: 'support-node',
          type: 'message',
          position: { x: 100, y: 0 },
          data: { title: 'Atendimento', text: 'Como posso ajudar?' },
        },
      ],
      edges: [
        {
          id: 'support-edge',
          source: 'buttons-node',
          target: 'support-node',
          sourceHandle: 'support',
        },
      ],
    };
    const upsert = {
      type: EMessageType.text,
      content: {
        type: EMessageType.text,
        official: {
          provider: 'meta_whatsapp',
          type: 'interactive',
          interactive: {
            type: 'button_reply',
            id: 'support',
            title: 'Atendimento',
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
        'buttons-node'
      )
    ).resolves.toBe(true);

    expect(runner.processNextNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      flow,
      'support-node',
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
        id: 'template-node',
        type: 'officialTemplate',
        position: { x: 100, y: 0 },
        data: {
          title: 'Template oficial',
          templateName: ' abertura ',
          templateLanguage: ' pt_BR ',
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
              value: '{{ name }}',
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
              body: 'Olá Maycon',
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

  it('rejects malformed Meta template placeholders before publishing the chatbot message', async () => {
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
        id: 'template-node-malformed',
        type: 'officialTemplate',
        position: { x: 100, y: 0 },
        data: {
          title: 'Template oficial inválido',
          templateName: 'followup_comercial',
          templateLanguage: 'pt_BR',
          templateParameterFormat: 'NAMED',
          templateComponents: [
            {
              type: 'BODY',
              text: 'Olá {{Name}}',
            },
          ],
          templatePreview: { body: 'Olá {{Name}}' },
          templateVariables: [
            {
              key: 'BODY:name',
              component_type: 'BODY',
              index: 1,
              parameter_name: 'name',
              value: 'Maycon',
            },
          ],
        },
      })
    ).rejects.toThrow('official_template_variable_syntax_invalid');

    expect(chatMessageService.publishPreparedMessage).not.toHaveBeenCalled();
  });

  it('resolves numeric upstream outputs to canonical text in official templates', async () => {
    const { service, chatService, chatMessageService } = makeService();
    const runner = service as unknown as {
      sendOfficialNode: (
        t: (key: string) => string,
        createChat: IChat,
        node: ListChatbotFlowResponse['nodes'][number]
      ) => Promise<boolean>;
      flowRuntimeContextService?: unknown;
    };
    runner.flowRuntimeContextService = {
      load: jest.fn(async () => ({})),
      toVariableScope: jest.fn(
        (_context: unknown, builtIns: Record<string, unknown>) => ({
          ...builtIns,
          api_1: { amount: 42 },
        })
      ),
    };
    const chat = makeChat();
    chatService.findChatByChatId.mockResolvedValue(chat);

    await expect(
      runner.sendOfficialNode((key) => key, chat, {
        id: 'template-node-numeric-output',
        type: 'officialTemplate',
        position: { x: 100, y: 0 },
        data: {
          title: 'Template oficial',
          templateName: 'abertura',
          templateLanguage: 'pt_BR',
          templateComponents: [
            { type: 'BODY', text: 'Olá {{1}}, valor {{2}}' },
          ],
          templatePreview: { body: 'Olá {{1}}, valor {{2}}' },
          templateVariables: [
            {
              key: 'BODY:1',
              component_type: 'BODY',
              index: 1,
              value: '{{ name }}',
            },
            {
              key: 'BODY:2',
              component_type: 'BODY',
              index: 2,
              value: '{{ api_1.amount }}',
            },
          ],
        },
      })
    ).resolves.toBe(true);

    expect(chatMessageService.publishPreparedMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          message: 'Olá Maycon, valor 42',
          official_template: expect.objectContaining({
            variables: [
              expect.objectContaining({ value: 'Maycon' }),
              expect.objectContaining({ value: '42' }),
            ],
          }),
        }),
      })
    );
  });
});

describe('ChatbotFlowRunnerService official response waits', () => {
  it.each([
    ['automatic', 'automatic'],
    ['missing', undefined],
    ['after_response', 'after_response'],
  ] as const)(
    'keeps an official template waiting when continueType is %s',
    async (_label, continueType) => {
      const nextNode: ListChatbotFlowResponse['nodes'][number] = {
        id: 'next-node',
        type: 'menu',
        position: { x: 100, y: 0 },
        data: { title: 'Próximo menu', message: 'Escolha uma opção' },
      };
      const flow = makeTemplateFlow(nextNode);
      if (continueType) {
        flow.nodes[0].data.continueType = continueType;
      }

      const { service, chat, transactions } = makeRuntimeService();
      const runner = service as unknown as {
        processOfficialNodeType: (
          t: (key: string) => string,
          createChat: IChat,
          chatbotFlow: ListChatbotFlowResponse,
          currentNode: ListChatbotFlowResponse['nodes'][number],
          currentFlowId: string
        ) => Promise<boolean>;
        sendOfficialNode: jest.Mock;
        processNextNode: jest.Mock;
      };
      runner.sendOfficialNode = jest.fn(async () => true);
      runner.processNextNode = jest.fn(async () => true);

      await expect(
        runner.processOfficialNodeType(
          (key) => key,
          chat,
          flow,
          flow.nodes[0],
          'template-node'
        )
      ).resolves.toBe(true);

      expect(runner.sendOfficialNode).toHaveBeenCalledWith(
        expect.any(Function),
        chat,
        flow.nodes[0]
      );
      expect(runner.processNextNode).not.toHaveBeenCalled();

      const operations = transactions.flat();
      const flowCacheKey = createChatbotFlowCacheKey(
        'account-1',
        'worker-1',
        'chat-1'
      );
      const pendingCacheKey = createChatbotOfficialResponsePendingCacheKey(
        'account-1',
        'worker-1',
        'chat-1'
      );
      expect(operations).toContainEqual({
        command: 'set',
        args: [flowCacheKey, 'next-node', 'EX', 259200],
      });

      const pendingSet = operations.find(
        (operation) =>
          operation.command === 'set' && operation.args[0] === pendingCacheKey
      );
      expect(pendingSet).toEqual(
        expect.objectContaining({
          args: [pendingCacheKey, expect.any(String), 'EX', 259200],
        })
      );
      expect(JSON.parse(String(pendingSet?.args[1]))).toEqual({
        templateNodeId: 'template-node',
        nextFlowId: 'next-node',
      });
      const inactivityCacheKey = createChatbotInactivityCacheKey(
        'account-1',
        'worker-1',
        'chat-1'
      );
      expect(operations).toContainEqual({
        command: 'del',
        args: [inactivityCacheKey],
      });
      expect(operations).toContainEqual({
        command: 'zrem',
        args: ['underchat:chatbot-inactivity-schedule', inactivityCacheKey],
      });
    }
  );

  it('cancels inactivity after a terminal official template without a next node', async () => {
    const templateNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'template-node',
      type: 'officialTemplate',
      position: { x: 0, y: 0 },
      data: { title: 'Template oficial', templateName: 'abertura' },
    };
    const flow: ListChatbotFlowResponse = {
      chatbot_flow_id: 'flow-1',
      chatbot_id: 'chatbot-1',
      account_id: 'account-1',
      nodes: [templateNode],
      edges: [],
    };
    const { service, chat, transactions } = makeRuntimeService();
    const runner = service as unknown as {
      processOfficialNodeType: (
        t: (key: string) => string,
        createChat: IChat,
        chatbotFlow: ListChatbotFlowResponse,
        currentNode: ListChatbotFlowResponse['nodes'][number],
        currentFlowId: string
      ) => Promise<boolean>;
      sendOfficialNode: jest.Mock;
    };
    runner.sendOfficialNode = jest.fn(async () => true);

    await expect(
      runner.processOfficialNodeType(
        (key) => key,
        chat,
        flow,
        templateNode,
        'template-node'
      )
    ).resolves.toBe(true);

    const operations = transactions.flat();
    const inactivityCacheKey = createChatbotInactivityCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    expect(operations).toContainEqual({
      command: 'del',
      args: [inactivityCacheKey],
    });
    expect(operations).toContainEqual({
      command: 'zrem',
      args: ['underchat:chatbot-inactivity-schedule', inactivityCacheKey],
    });
    expect(
      operations.some(
        ({ command, args }) =>
          command === 'set' &&
          args[0] ===
            createChatbotOfficialResponsePendingCacheKey(
              'account-1',
              'worker-1',
              'chat-1'
            )
      )
    ).toBe(false);
  });

  it.each(['officialReplyButtons', 'officialList'] as const)(
    'does not auto-advance %s before a valid option is selected',
    async (nodeType) => {
      const node: ListChatbotFlowResponse['nodes'][number] = {
        id: 'official-node',
        type: nodeType,
        position: { x: 0, y: 0 },
        data: {
          title: 'Escolha uma opção',
          message: 'Escolha uma opção',
          options: [{ id: 'option-1', text: 'Opção 1' }],
        },
      };
      const nextNode: ListChatbotFlowResponse['nodes'][number] = {
        id: 'next-node',
        type: 'message',
        position: { x: 100, y: 0 },
        data: { title: 'Próxima mensagem', text: 'Próxima mensagem' },
      };
      const flow: ListChatbotFlowResponse = {
        chatbot_flow_id: 'flow-1',
        chatbot_id: 'chatbot-1',
        account_id: 'account-1',
        nodes: [node, nextNode],
        edges: [
          {
            id: 'official-edge',
            source: 'official-node',
            target: 'next-node',
            sourceHandle: 'option-1',
          },
        ],
      };
      const { service, chat } = makeRuntimeService();
      const runner = service as unknown as {
        processOfficialNodeType: (
          t: (key: string) => string,
          createChat: IChat,
          chatbotFlow: ListChatbotFlowResponse,
          currentNode: ListChatbotFlowResponse['nodes'][number],
          currentFlowId: string
        ) => Promise<boolean>;
        sendOfficialNode: jest.Mock;
        processNextNode: jest.Mock;
      };
      runner.sendOfficialNode = jest.fn(async () => true);
      runner.processNextNode = jest.fn(async () => true);

      await expect(
        runner.processOfficialNodeType(
          (key) => key,
          chat,
          flow,
          node,
          'official-node'
        )
      ).resolves.toBe(true);

      expect(runner.processNextNode).not.toHaveBeenCalled();
    }
  );

  it('resumes a template into an official list without reusing the response as an option', async () => {
    const listNode = makeListNode();
    const flow = makeTemplateFlow(listNode);
    const { service, chat, values } = makeRuntimeService();
    const pendingCacheKey = createChatbotOfficialResponsePendingCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    values.set(
      pendingCacheKey,
      JSON.stringify({
        templateNodeId: 'template-node',
        nextFlowId: 'list-node',
      })
    );
    const runner = service as unknown as {
      resumeOfficialTemplateResponsePendingIfNeeded: (
        t: (key: string) => string,
        createChat: IChat,
        chatbotFlow: ListChatbotFlowResponse,
        currentFlowId: string
      ) => Promise<boolean | null>;
      sendOfficialNode: jest.Mock;
      sendTextOptionInvalidMessage: jest.Mock;
    };
    runner.sendOfficialNode = jest.fn(async () => true);
    runner.sendTextOptionInvalidMessage = jest.fn(async () => undefined);

    await expect(
      runner.resumeOfficialTemplateResponsePendingIfNeeded(
        (key) => key,
        chat,
        flow,
        'list-node'
      )
    ).resolves.toBe(true);

    expect(runner.sendOfficialNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      listNode
    );
    expect(runner.sendTextOptionInvalidMessage).not.toHaveBeenCalled();
    expect(values.has(pendingCacheKey)).toBe(false);
  });

  it('keeps the replacement marker when a template response leads to another template', async () => {
    const secondTemplate: ListChatbotFlowResponse['nodes'][number] = {
      id: 'second-template-node',
      type: 'officialTemplate',
      position: { x: 100, y: 0 },
      data: {
        title: 'Segundo template',
        templateName: 'segundo-template',
        continueType: 'automatic',
      },
    };
    const afterTemplate: ListChatbotFlowResponse['nodes'][number] = {
      id: 'after-template-node',
      type: 'message',
      position: { x: 200, y: 0 },
      data: { title: 'Depois do template', text: 'Depois do template' },
    };
    const flow: ListChatbotFlowResponse = {
      chatbot_flow_id: 'flow-1',
      chatbot_id: 'chatbot-1',
      account_id: 'account-1',
      nodes: [
        {
          id: 'template-node',
          type: 'officialTemplate',
          position: { x: 0, y: 0 },
          data: { title: 'Primeiro template', templateName: 'primeiro' },
        },
        secondTemplate,
        afterTemplate,
      ],
      edges: [
        {
          id: 'first-template-edge',
          source: 'template-node',
          target: 'second-template-node',
        },
        {
          id: 'second-template-edge',
          source: 'second-template-node',
          target: 'after-template-node',
        },
      ],
    };
    const { service, chat, values } = makeRuntimeService();
    const pendingCacheKey = createChatbotOfficialResponsePendingCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    values.set(
      pendingCacheKey,
      JSON.stringify({
        templateNodeId: 'template-node',
        nextFlowId: 'second-template-node',
      })
    );
    const runner = service as unknown as {
      resumeOfficialTemplateResponsePendingIfNeeded: (
        t: (key: string) => string,
        createChat: IChat,
        chatbotFlow: ListChatbotFlowResponse,
        currentFlowId: string
      ) => Promise<boolean | null>;
      sendOfficialNode: jest.Mock;
    };
    runner.sendOfficialNode = jest.fn(async () => true);

    await expect(
      runner.resumeOfficialTemplateResponsePendingIfNeeded(
        (key) => key,
        chat,
        flow,
        'second-template-node'
      )
    ).resolves.toBe(true);

    expect(runner.sendOfficialNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      secondTemplate
    );
    expect(JSON.parse(String(values.get(pendingCacheKey)))).toEqual({
      templateNodeId: 'second-template-node',
      nextFlowId: 'after-template-node',
    });
  });

  it('keeps a pending template response untouched while text triggers are disabled, then resumes when text is enabled', async () => {
    const nextNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'next-node',
      type: 'menu',
      position: { x: 100, y: 0 },
      data: { title: 'Próximo menu', message: 'Escolha uma opção' },
    };
    const flow = makeTemplateFlow(nextNode);
    const configurations = {
      configurations: {
        trigger_events: [] as string[],
        inactivity_alert: {
          status: 'active',
          quantity: 1,
          time: 5,
          action: 'finish',
        },
      },
    };
    const {
      service,
      chat,
      values,
      transactions,
      officialWhatsappConversationWindowService,
    } = makeRuntimeService({
      flow,
      configurations,
    });
    chat.worker.is_official = true;
    const flowCacheKey = createChatbotFlowCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    const pendingCacheKey = createChatbotOfficialResponsePendingCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    const pending = JSON.stringify({
      templateNodeId: 'template-node',
      nextFlowId: 'next-node',
    });
    values.set(flowCacheKey, 'next-node');
    values.set(pendingCacheKey, pending);

    const runner = service as unknown as {
      processNextNode: jest.Mock;
    };
    runner.processNextNode = jest.fn(async () => true);
    const inbound = makeInboundText();

    await expect(
      service.execute(
        ((key: string) => key) as never,
        inbound,
        chat,
        'chatbot-1'
      )
    ).resolves.toBeNull();

    expect(runner.processNextNode).not.toHaveBeenCalled();
    expect(values.get(pendingCacheKey)).toBe(pending);

    configurations.configurations.trigger_events = ['text'];

    await expect(
      service.execute(
        ((key: string) => key) as never,
        inbound,
        chat,
        'chatbot-1'
      )
    ).resolves.toBe('next-node');

    expect(runner.processNextNode).toHaveBeenCalledTimes(1);
    expect(runner.processNextNode.mock.calls[0]).toHaveLength(5);
    expect(runner.processNextNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      flow,
      'next-node',
      undefined
    );
    expect(values.has(pendingCacheKey)).toBe(false);
    expect(
      officialWhatsappConversationWindowService.resolveAuthoritativeForChat
    ).toHaveBeenCalledTimes(1);
    const inactivityCacheKey = createChatbotInactivityCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    const inactivitySet = transactions
      .flat()
      .find(
        ({ command, args }) =>
          command === 'set' && args[0] === inactivityCacheKey
      );
    expect(inactivitySet).toBeDefined();
    expect(JSON.parse(String(inactivitySet?.args[1]))).toEqual(
      expect.objectContaining({
        alertCount: 0,
        lastAlertTime: null,
        chatbotId: 'chatbot-1',
      })
    );
  });

  it('discards an inconsistent template marker without starting its successor', async () => {
    const nextNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'next-node',
      type: 'menu',
      position: { x: 100, y: 0 },
      data: { title: 'Próximo menu', message: 'Escolha uma opção' },
    };
    const flow = makeTemplateFlow(nextNode);
    const { service, chat, values } = makeRuntimeService();
    const flowCacheKey = createChatbotFlowCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    const pendingCacheKey = createChatbotOfficialResponsePendingCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    values.set(flowCacheKey, 'next-node');
    values.set(
      pendingCacheKey,
      JSON.stringify({
        templateNodeId: 'template-node',
        nextFlowId: 'different-node',
      })
    );
    const runner = service as unknown as {
      resumeOfficialTemplateResponsePendingIfNeeded: (
        t: (key: string) => string,
        createChat: IChat,
        chatbotFlow: ListChatbotFlowResponse,
        currentFlowId: string
      ) => Promise<boolean | null>;
      processNextNode: jest.Mock;
    };
    runner.processNextNode = jest.fn(async () => true);

    await expect(
      runner.resumeOfficialTemplateResponsePendingIfNeeded(
        (key) => key,
        chat,
        flow,
        'next-node'
      )
    ).resolves.toBeNull();

    expect(runner.processNextNode).not.toHaveBeenCalled();
    expect(values.get(flowCacheKey)).toBe('next-node');
    expect(values.has(pendingCacheKey)).toBe(false);
  });

  it('does not consume a pending template response from a fromMe echo', async () => {
    const nextNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'next-node',
      type: 'start',
      position: { x: 100, y: 0 },
      data: { title: 'Próximo nó' },
    };
    const flow = makeTemplateFlow(nextNode);
    const { service, chat, values } = makeRuntimeService({
      flow,
      configurations: {
        configurations: {
          trigger_events: [],
          inactivity_alert: {
            status: 'active',
            quantity: 1,
            time: 5,
            action: 'finish',
          },
        },
      },
    });
    const flowCacheKey = createChatbotFlowCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    const pendingCacheKey = createChatbotOfficialResponsePendingCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );
    const pending = JSON.stringify({
      templateNodeId: 'template-node',
      nextFlowId: 'next-node',
    });
    values.set(flowCacheKey, 'next-node');
    values.set(pendingCacheKey, pending);
    const runner = service as unknown as {
      processNextNode: jest.Mock;
      processStartNode: jest.Mock;
      scheduleInactivityCheck: jest.Mock;
      cancelInactivityCheck: jest.Mock;
    };
    runner.processNextNode = jest.fn(async () => true);
    runner.processStartNode = jest.fn(async () => true);
    runner.scheduleInactivityCheck = jest.fn(async () => undefined);
    runner.cancelInactivityCheck = jest.fn(async () => undefined);
    const echo = makeInboundText('eco');
    (echo.message?.key as { fromMe?: boolean }).fromMe = true;

    await expect(
      service.execute(((key: string) => key) as never, echo, chat, 'chatbot-1')
    ).resolves.toBe('next-node');

    expect(runner.processStartNode).not.toHaveBeenCalled();
    expect(runner.processNextNode).not.toHaveBeenCalled();
    expect(runner.scheduleInactivityCheck).not.toHaveBeenCalled();
    expect(runner.cancelInactivityCheck).toHaveBeenCalledWith(chat);
    expect(values.get(pendingCacheKey)).toBe(pending);
  });

  it('starts an official template node while the freeform window is closed without arming inactivity', async () => {
    const nextNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'next-node',
      type: 'message',
      position: { x: 100, y: 0 },
      data: { title: 'Próximo nó', text: 'Próxima mensagem' },
    };
    const templateFlow = makeTemplateFlow(nextNode);
    const startNode: ListChatbotFlowResponse['nodes'][number] = {
      id: 'start-node',
      type: 'start',
      position: { x: -100, y: 0 },
      data: { title: 'Início' },
    };
    const flow: ListChatbotFlowResponse = {
      ...templateFlow,
      nodes: [startNode, ...templateFlow.nodes],
      edges: [
        {
          id: 'start-edge',
          source: 'start-node',
          target: 'template-node',
        },
        ...templateFlow.edges,
      ],
    };
    const { service, chat, officialWhatsappConversationWindowService } =
      makeRuntimeService({
        flow,
        configurations: {
          configurations: {
            trigger_events: [],
            inactivity_alert: {
              status: 'active',
              quantity: 1,
              time: 5,
              action: 'finish',
            },
          },
        },
      });
    chat.worker.is_official = true;
    officialWhatsappConversationWindowService.resolveAuthoritativeForChat.mockResolvedValueOnce(
      {
        state: 'closed',
        can_send_freeform: false,
      }
    );
    const runner = service as unknown as {
      sendOfficialNode: jest.Mock;
      scheduleInactivityCheck: jest.Mock;
    };
    runner.sendOfficialNode = jest.fn(async () => true);
    runner.scheduleInactivityCheck = jest.fn(async () => undefined);
    const bootstrap = makeInboundText('');
    (bootstrap.message?.key as { fromMe?: boolean }).fromMe = true;

    await expect(
      service.execute(
        ((key: string) => key) as never,
        bootstrap,
        chat,
        'chatbot-1'
      )
    ).resolves.toBe('start-node');

    expect(runner.sendOfficialNode).toHaveBeenCalledWith(
      expect.any(Function),
      chat,
      flow.nodes[1]
    );
    expect(runner.scheduleInactivityCheck).not.toHaveBeenCalled();
  });

  it.each(['officialReplyButtons', 'officialList'] as const)(
    'does not treat a fromMe echo as a response to %s',
    async (nodeType) => {
      const node: ListChatbotFlowResponse['nodes'][number] = {
        id: 'official-node',
        type: nodeType,
        position: { x: 0, y: 0 },
        data: {
          title: 'Escolha uma opção',
          message: 'Escolha uma opção',
          options: [{ id: 'option-1', text: 'Opção 1' }],
        },
      };
      const flow: ListChatbotFlowResponse = {
        chatbot_flow_id: 'flow-1',
        chatbot_id: 'chatbot-1',
        account_id: 'account-1',
        nodes: [node],
        edges: [],
      };
      const { service, chat, values } = makeRuntimeService({
        flow,
        configurations: { configurations: { trigger_events: [] } },
      });
      const flowCacheKey = createChatbotFlowCacheKey(
        'account-1',
        'worker-1',
        'chat-1'
      );
      values.set(flowCacheKey, 'official-node');
      const runner = service as unknown as {
        processOfficialOptionNodeResponse: jest.Mock;
      };
      runner.processOfficialOptionNodeResponse = jest.fn(async () => true);
      const echo = makeInboundText('eco');
      (echo.message?.key as { fromMe?: boolean }).fromMe = true;

      await expect(
        service.execute(
          ((key: string) => key) as never,
          echo,
          chat,
          'chatbot-1'
        )
      ).resolves.toBe('official-node');

      expect(runner.processOfficialOptionNodeResponse).not.toHaveBeenCalled();
    }
  );

  it('clears the template response marker with the rest of the runtime state', async () => {
    const { service, transactions } = makeRuntimeService();
    const pendingCacheKey = createChatbotOfficialResponsePendingCacheKey(
      'account-1',
      'worker-1',
      'chat-1'
    );

    await service.clearFlowCacheForChat('account-1', 'worker-1', 'chat-1');

    const deleteOperation = transactions
      .flat()
      .find(
        (operation) =>
          operation.command === 'del' &&
          operation.args.includes(pendingCacheKey)
      );
    expect(deleteOperation).toBeDefined();
  });
});
