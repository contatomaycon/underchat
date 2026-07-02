import 'reflect-metadata';

import { ChatbotFlowSaverUseCase } from '@core/useCases/chatbot/ChatbotFlowSaver.useCase';
import { SaveChatbotFlowRequestData } from '@core/schema/chatbot/saveChatbotFlow/request.schema';

const t = ((key: string) => key) as never;

const makeFlow = (
  officialNodeData?: Partial<
    SaveChatbotFlowRequestData['nodes'][number]['data']
  >
): SaveChatbotFlowRequestData => ({
  chatbot_id: '11111111-1111-4111-8111-111111111111',
  nodes: [
    {
      id: 'start-1',
      type: 'start',
      position: { x: 0, y: 0 },
      data: {},
    },
    {
      id: 'official-1',
      type: 'officialReplyButtons',
      position: { x: 100, y: 100 },
      data: {
        title: 'Botões oficiais',
        message: 'Escolha uma opção',
        options: [
          { id: '1', text: 'Sim' },
          { id: '2', text: 'Não' },
        ],
        ...officialNodeData,
      },
    },
    {
      id: 'finish-1',
      type: 'finish',
      position: { x: 200, y: 100 },
      data: {},
    },
    {
      id: 'finish-2',
      type: 'finish',
      position: { x: 200, y: 200 },
      data: {},
    },
  ],
  edges: [
    {
      id: 'edge-start-official',
      source: 'start-1',
      target: 'official-1',
    },
    {
      id: 'edge-option-1',
      source: 'official-1',
      sourceHandle: 'option-1-source',
      target: 'finish-1',
    },
    {
      id: 'edge-option-2',
      source: 'official-1',
      sourceHandle: 'option-2-source',
      target: 'finish-2',
    },
  ],
});

const makeMultiProductFlow = (
  officialNodeData?: Partial<
    SaveChatbotFlowRequestData['nodes'][number]['data']
  >
): SaveChatbotFlowRequestData => ({
  chatbot_id: '11111111-1111-4111-8111-111111111111',
  nodes: [
    {
      id: 'start-1',
      type: 'start',
      position: { x: 0, y: 0 },
      data: {},
    },
    {
      id: 'official-products-1',
      type: 'officialMultiProduct',
      position: { x: 100, y: 100 },
      data: {
        title: 'Lista de produtos',
        message: 'Veja os produtos',
        catalogId: 'catalog-1',
        sections: [
          {
            title: 'Produtos',
            product_items: [{ product_retailer_id: 'produto-1' }],
          },
        ],
        ...officialNodeData,
      },
    },
    {
      id: 'finish-1',
      type: 'finish',
      position: { x: 200, y: 100 },
      data: {},
    },
  ],
  edges: [
    {
      id: 'edge-start-official',
      source: 'start-1',
      target: 'official-products-1',
    },
    {
      id: 'edge-official-finish',
      source: 'official-products-1',
      target: 'finish-1',
    },
  ],
});

const makeOfficialTemplateFlow = (
  officialNodeData?: Partial<
    SaveChatbotFlowRequestData['nodes'][number]['data']
  >
): SaveChatbotFlowRequestData => ({
  chatbot_id: '11111111-1111-4111-8111-111111111111',
  nodes: [
    {
      id: 'start-1',
      type: 'start',
      position: { x: 0, y: 0 },
      data: {},
    },
    {
      id: 'official-template-1',
      type: 'officialTemplate',
      position: { x: 100, y: 100 },
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
          buttons: [],
        },
        templateVariables: [
          {
            key: 'BODY:1',
            component_type: 'BODY',
            index: 1,
            button_index: null,
            value: 'Cliente',
          },
        ],
        ...officialNodeData,
      },
    },
    {
      id: 'finish-1',
      type: 'finish',
      position: { x: 200, y: 100 },
      data: {},
    },
  ],
  edges: [
    {
      id: 'edge-start-official',
      source: 'start-1',
      target: 'official-template-1',
    },
    {
      id: 'edge-official-finish',
      source: 'official-template-1',
      target: 'finish-1',
    },
  ],
});

const makeUseCase = (options?: {
  hasOfficialOnlineChannel?: boolean;
  hasNonOfficialLinkedChannel?: boolean;
}) => {
  const chatbotService = {
    hasOfficialOnlineChannel: jest.fn(
      async () => options?.hasOfficialOnlineChannel ?? true
    ),
    hasNonOfficialLinkedChannel: jest.fn(
      async () => options?.hasNonOfficialLinkedChannel ?? false
    ),
    saveChatbotFlow: jest.fn(async () => 'flow-1'),
  };

  const accountService = {
    existsAccountById: jest.fn(async () => true),
  };

  const useCase = new ChatbotFlowSaverUseCase(
    chatbotService as never,
    accountService as never,
    {} as never,
    {} as never
  );

  return { useCase, chatbotService, accountService };
};

describe('ChatbotFlowSaverUseCase official nodes', () => {
  it('accepts official nodes when account has official online channel and no non-official link', async () => {
    const { useCase, chatbotService } = makeUseCase();
    const flow = makeFlow();

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).resolves.toBeUndefined();

    expect(chatbotService.hasOfficialOnlineChannel).toHaveBeenCalledWith(
      'account-1'
    );
    expect(chatbotService.hasNonOfficialLinkedChannel).toHaveBeenCalledWith(
      'account-1',
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('rejects official nodes when the account has no official online channel', async () => {
    const { useCase } = makeUseCase({ hasOfficialOnlineChannel: false });
    const flow = makeFlow();

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_official_nodes_require_online_channel');
  });

  it('rejects official nodes when chatbot is linked to non-official channel', async () => {
    const { useCase } = makeUseCase({ hasNonOfficialLinkedChannel: true });
    const flow = makeFlow();

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow(
      'chatbot_official_nodes_not_allowed_on_non_official_channel'
    );
  });

  it('rejects official reply buttons above Meta option limit', async () => {
    const { useCase, chatbotService } = makeUseCase();
    const flow = makeFlow({
      options: [
        { id: '1', text: 'Um' },
        { id: '2', text: 'Dois' },
        { id: '3', text: 'Três' },
        { id: '4', text: 'Quatro' },
      ],
    });
    flow.edges.push(
      {
        id: 'edge-option-3',
        source: 'official-1',
        sourceHandle: 'option-3-source',
        target: 'finish-1',
      },
      {
        id: 'edge-option-4',
        source: 'official-1',
        sourceHandle: 'option-4-source',
        target: 'finish-2',
      }
    );

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_official_options_limit');
    expect(chatbotService.hasOfficialOnlineChannel).not.toHaveBeenCalled();
  });

  it('rejects official product list without product ids', async () => {
    const { useCase, chatbotService } = makeUseCase();
    const flow = makeMultiProductFlow({
      products: [],
      sections: [
        {
          title: 'Produtos',
          product_items: [{ product_retailer_id: '' }],
        },
      ],
    });

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_official_field_required');
    expect(chatbotService.hasOfficialOnlineChannel).not.toHaveBeenCalled();
  });

  it('accepts official template nodes with selected template metadata', async () => {
    const { useCase } = makeUseCase();
    const flow = makeOfficialTemplateFlow();

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).resolves.toBeUndefined();
  });
});
