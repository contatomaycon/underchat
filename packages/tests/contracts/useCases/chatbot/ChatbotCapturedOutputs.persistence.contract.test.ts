import 'reflect-metadata';

import fastJson from 'fast-json-stringify';
import { Value } from '@sinclair/typebox/value';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import {
  listChatbotFlowResponseSchema,
  type ListChatbotFlowResponse,
} from '@core/schema/chatbot/listChatbotFlow/response.schema';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';
import { ChatbotClonerUseCase } from '@core/useCases/chatbot/ChatbotCloner.useCase';
import { ChatbotFlowListerUseCase } from '@core/useCases/chatbot/ChatbotFlowLister.useCase';

type FlowWithCapturedOutputKeys = ListChatbotFlowResponse & {
  nodes: Array<
    ListChatbotFlowResponse['nodes'][number] & {
      data: ListChatbotFlowResponse['nodes'][number]['data'] & {
        outputKey?: string;
      };
    }
  >;
};

const flowWithCapturedOutputKeys = (): FlowWithCapturedOutputKeys => ({
  chatbot_flow_id: 'flow-original',
  chatbot_id: 'chatbot-original',
  account_id: 'account-1',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'data-node',
      type: 'data',
      position: { x: 1, y: 0 },
      data: {
        dataType: 'email',
        email: 'Qual e o seu e-mail?',
        outputKey: 'data_1',
      },
    },
    {
      id: 'message-node',
      type: 'message',
      position: { x: 2, y: 0 },
      data: {
        messageType: 'text',
        text: 'Deseja continuar?',
        continueType: 'after_response',
        outputKey: 'message_1',
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'data-node' },
    { id: 'e2', source: 'data-node', target: 'message-node' },
  ],
  created_at: '2026-07-12T12:00:00.000Z',
  updated_at: '2026-07-12T12:00:00.000Z',
});

const capturedOutputKeys = (flow: FlowWithCapturedOutputKeys) =>
  Object.fromEntries(
    flow.nodes
      .filter((node) => node.type === 'data' || node.type === 'message')
      .map((node) => [node.id, node.data.outputKey])
  );

describe('captured Data and Message output persistence', () => {
  it('declares outputKey explicitly without dynamic Elasticsearch fields', () => {
    const mapping = chatbotFlowMappings() as any;
    const dataProperties =
      mapping.mappings.properties.nodes.properties.data.properties;

    expect(dataProperties.outputKey).toEqual({ type: 'keyword' });
    expect(dataProperties.apiRequest).toEqual({
      type: 'object',
      enabled: false,
    });
  });

  it('retains output keys in the serialized list response contract', () => {
    const serialize = fastJson(listChatbotFlowResponseSchema as never);
    const serialized = JSON.parse(
      serialize(flowWithCapturedOutputKeys())
    ) as FlowWithCapturedOutputKeys;

    expect(capturedOutputKeys(serialized)).toEqual({
      'data-node': 'data_1',
      'message-node': 'message_1',
    });
  });

  it('keeps legacy flows without output keys list-compatible', () => {
    const legacy = flowWithCapturedOutputKeys();
    for (const node of legacy.nodes) delete node.data.outputKey;

    expect(Value.Check(listChatbotFlowResponseSchema, legacy)).toBe(true);

    const serialize = fastJson(listChatbotFlowResponseSchema as never);
    const serialized = JSON.parse(
      serialize(legacy)
    ) as FlowWithCapturedOutputKeys;
    expect(
      serialized.nodes.every((node) => node.data.outputKey === undefined)
    ).toBe(true);
  });

  it('keeps stable output keys when listing a stored flow', async () => {
    const storedFlow = flowWithCapturedOutputKeys();
    const lister = new ChatbotFlowListerUseCase({
      findChatbotFlowByChatbotId: jest.fn(async () => storedFlow),
    } as never);

    const listed = (await lister.execute(
      'account-1',
      'chatbot-original'
    )) as FlowWithCapturedOutputKeys;

    expect(capturedOutputKeys(listed)).toEqual({
      'data-node': 'data_1',
      'message-node': 'message_1',
    });
  });

  it('preserves output keys and node identities when cloning a flow', async () => {
    const storedFlow = flowWithCapturedOutputKeys();
    storedFlow.nodes.push({
      id: 'api-node',
      type: 'apiRequest',
      position: { x: 3, y: 0 },
      data: {
        apiRequest: {
          outputKey: 'api_1',
          test: {
            state: 'tested',
            evidence: { proof: 'bound-to-the-original-chatbot' },
          },
        } as unknown as ApiRequestConfig,
      },
    });
    const updateWithOCC = jest.fn(async () => 'created');
    const cloner = new ChatbotClonerUseCase(
      {
        findChatbotById: jest.fn(async () => ({ chatbot_id: 'original' })),
        cloneChatbot: jest.fn(async () => ({
          chatbot_id: 'chatbot-clone',
          name: 'Clone',
          account_id: 'account-1',
          created_at: '2026-07-12T13:00:00.000Z',
          updated_at: '2026-07-12T13:00:00.000Z',
        })),
      } as never,
      {
        existsChatbotByName: jest.fn(async () => false),
        findChatbotFlowByChatbotId: jest.fn(async () => storedFlow),
        findChatbotFlowConfigurationsByChatbotId: jest.fn(async () => null),
      } as never,
      { existsAccountById: jest.fn(async () => true) } as never,
      { validateCanCreateChatbot: jest.fn(async () => undefined) } as never,
      {
        indices: jest.fn(async () => true),
        updateWithOCC,
      } as never
    );

    await cloner.execute(
      (() => '') as never,
      { chatbot_id: 'chatbot-original', name: 'Clone' },
      'account-1'
    );

    expect(updateWithOCC).toHaveBeenCalledTimes(1);
    const clonedFlow = (updateWithOCC as jest.Mock).mock.calls[0]?.[2] as
      FlowWithCapturedOutputKeys | undefined;
    if (!clonedFlow) {
      throw new Error('Expected cloned flow to be persisted');
    }
    expect(clonedFlow.chatbot_id).toBe('chatbot-clone');
    expect(clonedFlow.nodes.map((node) => node.id)).toEqual([
      'start',
      'data-node',
      'message-node',
      'api-node',
    ]);
    expect(capturedOutputKeys(clonedFlow)).toEqual({
      'data-node': 'data_1',
      'message-node': 'message_1',
    });
    expect(
      clonedFlow.nodes.find((node) => node.id === 'api-node')?.data.apiRequest
        ?.test
    ).toEqual({ state: 'untested', evidence: null });
  });
});
