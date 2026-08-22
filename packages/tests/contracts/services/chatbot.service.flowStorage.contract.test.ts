import 'reflect-metadata';

jest.mock('uuid', () => ({
  v7: jest.fn(() => 'flow-id-1'),
}));

import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { ChatbotService } from '@core/services/chatbot.service';

const makeService = () => {
  const elasticDatabaseService = {
    indices: jest.fn<Promise<boolean>, any[]>(async () => true),
    updateWithOCC: jest.fn<Promise<'created'>, any[]>(async () => 'created'),
    select: jest.fn<Promise<any>, any[]>(),
  };
  const chatbotListerRepository = {
    listChatbots: jest.fn(async () => [
      {
        chatbot_id: 'chatbot-1',
        name: 'Chatbot',
        type: 'input',
        status: 'active',
      },
    ]),
  };

  const service = new ChatbotService(
    {} as never,
    chatbotListerRepository as never,
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
    elasticDatabaseService as never
  );

  return { service, elasticDatabaseService, chatbotListerRepository };
};

describe('ChatbotService flow storage', () => {
  it('stores official location coordinates outside dynamic latitude/longitude mapping', async () => {
    const { service, elasticDatabaseService } = makeService();

    await service.saveChatbotFlow(
      {
        chatbot_id: 'chatbot-1',
        nodes: [
          {
            id: 'node-1',
            type: 'officialLocation',
            position: { x: 0, y: 0 },
            data: {
              title: 'Localização',
              latitude: -15.466496,
              longitude: -47.6053504,
            },
          },
        ],
        edges: [],
      },
      'account-1'
    );

    expect(elasticDatabaseService.updateWithOCC).toHaveBeenCalledWith(
      EElasticIndex.chatbot_flow,
      'flow-id-1',
      expect.objectContaining({
        nodes: [
          expect.objectContaining({
            data: expect.not.objectContaining({
              latitude: expect.anything(),
              longitude: expect.anything(),
            }),
          }),
        ],
      }),
      expect.objectContaining({ upsert: true })
    );
    const savedDocument = elasticDatabaseService.updateWithOCC.mock
      .calls[0]?.[2] as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    const storedData = savedDocument.nodes[0]?.data;

    expect(storedData).not.toHaveProperty('latitude');
    expect(storedData).not.toHaveProperty('longitude');
    expect(storedData).toEqual(
      expect.objectContaining({
        latitudeText: '-15.466496',
        longitudeText: '-47.6053504',
      })
    );
  });

  it('removes empty coordinates and stale coordinate text from the stored node data', async () => {
    const { service, elasticDatabaseService } = makeService();

    await service.saveChatbotFlow(
      {
        chatbot_id: 'chatbot-1',
        nodes: [
          {
            id: 'node-1',
            type: 'officialLocation',
            position: { x: 0, y: 0 },
            data: {
              title: 'Localização',
              latitude: null,
              longitude: '',
              latitudeText: '-15.466496',
              longitudeText: '-47.6053504',
            },
          },
        ],
        edges: [],
      },
      'account-1'
    );

    const savedDocument = elasticDatabaseService.updateWithOCC.mock
      .calls[0]?.[2] as {
      nodes: Array<{ data: Record<string, unknown> }>;
    };
    const storedData = savedDocument.nodes[0]?.data;

    expect(storedData).not.toHaveProperty('latitude');
    expect(storedData).not.toHaveProperty('longitude');
    expect(storedData).not.toHaveProperty('latitudeText');
    expect(storedData).not.toHaveProperty('longitudeText');
  });

  it('canonicalizes official nodes that must wait for a response before storage', async () => {
    const { service, elasticDatabaseService } = makeService();

    await service.saveChatbotFlow(
      {
        chatbot_id: 'chatbot-1',
        nodes: [
          {
            id: 'buttons-1',
            type: 'officialReplyButtons',
            position: { x: 0, y: 0 },
            data: {
              title: 'Botões oficiais',
              continueType: 'automatic',
            },
          },
          {
            id: 'list-1',
            type: 'officialList',
            position: { x: 1, y: 0 },
            data: {
              title: 'Lista oficial',
            },
          },
          {
            id: 'template-1',
            type: 'officialTemplate',
            position: { x: 2, y: 0 },
            data: {
              title: 'Template oficial',
              continueType: 'after_response',
            },
          },
          {
            id: 'cta-1',
            type: 'officialCtaUrl',
            position: { x: 2.5, y: 0 },
            data: {
              title: 'Abrir link',
              continueType: 'after_response',
              buttonText: 'Clique aqui',
              url: 'https://sites.google.com/contabilidadehohl.com.br/atendimento',
            },
          },
          {
            id: 'location-1',
            type: 'officialLocation',
            position: { x: 3, y: 0 },
            data: {
              title: 'Localização',
              latitude: -15.466496,
              longitude: -47.6053504,
            },
          },
        ],
        edges: [],
      },
      'account-1'
    );

    const savedDocument = elasticDatabaseService.updateWithOCC.mock
      .calls[0]?.[2] as {
      nodes: Array<{ id: string; data: Record<string, unknown> }>;
    };

    expect(savedDocument.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'buttons-1',
          data: expect.objectContaining({ continueType: 'after_response' }),
        }),
        expect.objectContaining({
          id: 'list-1',
          data: expect.objectContaining({ continueType: 'after_response' }),
        }),
        expect.objectContaining({
          id: 'template-1',
          data: expect.objectContaining({ continueType: 'after_response' }),
        }),
        expect.objectContaining({
          id: 'cta-1',
          data: expect.objectContaining({ continueType: 'automatic' }),
        }),
        expect.objectContaining({
          id: 'location-1',
          data: expect.objectContaining({
            latitudeText: '-15.466496',
            longitudeText: '-47.6053504',
          }),
        }),
      ])
    );
  });

  it('hydrates stored coordinate text and canonicalizes official waiting nodes', async () => {
    const { service, elasticDatabaseService } = makeService();
    elasticDatabaseService.select.mockResolvedValueOnce({
      hits: {
        hits: [
          {
            _source: {
              chatbot_flow_id: 'flow-id-1',
              chatbot_id: 'chatbot-1',
              account_id: 'account-1',
              nodes: [
                {
                  id: 'buttons-1',
                  type: 'officialReplyButtons',
                  position: { x: 0, y: 0 },
                  data: {
                    title: 'Botões oficiais',
                    continueType: 'automatic',
                  },
                },
                {
                  id: 'list-1',
                  type: 'officialList',
                  position: { x: 1, y: 0 },
                  data: {
                    title: 'Lista oficial',
                  },
                },
                {
                  id: 'template-1',
                  type: 'officialTemplate',
                  position: { x: 2, y: 0 },
                  data: {
                    title: 'Template oficial',
                    continueType: 'after_response',
                  },
                },
                {
                  id: 'cta-1',
                  type: 'officialCtaUrl',
                  position: { x: 2.5, y: 0 },
                  data: {
                    title: 'Abrir link',
                    continueType: 'after_response',
                    buttonText: 'Clique aqui',
                    url: 'https://sites.google.com/contabilidadehohl.com.br/atendimento',
                  },
                },
                {
                  id: 'node-1',
                  type: 'officialLocation',
                  position: { x: 0, y: 0 },
                  data: {
                    title: 'Localização',
                    latitudeText: '-15.466496',
                    longitudeText: '-47.6053504',
                  },
                },
              ],
              edges: [],
              created_at: '2026-07-01T12:00:00.000Z',
              updated_at: '2026-07-01T12:00:00.000Z',
            },
          },
        ],
      },
    });

    const result = await service.findChatbotFlowByChatbotId(
      'account-1',
      'chatbot-1'
    );

    expect(result?.nodes[0].data).toEqual(
      expect.objectContaining({ continueType: 'after_response' })
    );
    expect(result?.nodes[1].data).toEqual(
      expect.objectContaining({ continueType: 'after_response' })
    );
    expect(result?.nodes[2].data).toEqual(
      expect.objectContaining({ continueType: 'after_response' })
    );
    expect(result?.nodes[3].data).toEqual(
      expect.objectContaining({ continueType: 'automatic' })
    );
    expect(result?.nodes[4].data).toEqual(
      expect.objectContaining({
        latitude: '-15.466496',
        longitude: '-47.6053504',
      })
    );
  });

  it('can read the persisted flow for authorization even when the chatbot is inactive', async () => {
    const { service, elasticDatabaseService, chatbotListerRepository } =
      makeService();
    chatbotListerRepository.listChatbots.mockResolvedValueOnce([]);

    await expect(
      service.findChatbotFlowByChatbotId('account-1', 'chatbot-1')
    ).resolves.toBeNull();
    expect(elasticDatabaseService.select).not.toHaveBeenCalled();

    elasticDatabaseService.select.mockResolvedValueOnce({
      hits: {
        hits: [
          {
            _source: {
              chatbot_flow_id: 'flow-id-1',
              chatbot_id: 'chatbot-1',
              account_id: 'account-1',
              nodes: [],
              edges: [],
            },
          },
        ],
      },
    });

    await expect(
      service.findChatbotFlowByChatbotId('account-1', 'chatbot-1', {
        includeInactive: true,
      })
    ).resolves.toMatchObject({ chatbot_flow_id: 'flow-id-1' });
    expect(chatbotListerRepository.listChatbots).toHaveBeenCalledTimes(1);
  });
});
