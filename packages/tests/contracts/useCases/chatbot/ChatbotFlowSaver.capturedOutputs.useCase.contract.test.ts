import 'reflect-metadata';

import { getUpstreamApiContracts } from '@core/common/functions/chatbotApiGraph';
import {
  createApiRequestFingerprint,
  signApiRequestProof,
} from '@core/common/functions/chatbotApiRequestSecurity';
import type {
  ApiRequestConfig,
  ChatbotFlowData,
} from '@core/schema/chatbot/chatbotFlow.schema';
import { ChatbotFlowSaverUseCase } from '@core/useCases/chatbot/ChatbotFlowSaver.useCase';

const t = ((key: string) => key) as never;

const apiConfig = (): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_1',
  method: 'GET',
  url: 'https://example.com/customers/{{ data_1.value }}',
  queryParams: [],
  headers: [],
  auth: {
    type: 'none',
    bearer: { token: { id: 'bearer' } },
    apiKey: {
      placement: 'header',
      name: 'X-API-Key',
      value: { id: 'api-key' },
    },
    basic: {
      username: { id: 'username' },
      password: { id: 'password' },
    },
  },
  body: {
    id: 'body',
    type: 'none',
    json: '',
    raw: '',
    contentType: 'text/plain',
    sensitive: false,
    formFields: [],
    multipart: [],
  },
  execution: {
    mode: 'once',
    itemsExpression: '',
    concurrency: 1,
    failurePolicy: 'failFast',
    timeoutMs: 10_000,
    retry: { maxAttempts: 1, initialDelayMs: 100 },
    idempotencyKey: '',
  },
  capture: {
    mode: 'full',
    paths: [],
    responseHeaders: [],
    contract: [{ path: 'id', type: 'string' }],
    availableResponseHeaders: ['content-type'],
  },
  test: { state: 'untested', evidence: null },
});

const unsignedFlow = (): ChatbotFlowData => ({
  chatbot_id: 'chatbot-1',
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
        text: 'Confirme para continuar',
        continueType: 'after_response',
        outputKey: 'message_1',
      },
    },
    {
      id: 'api-node',
      type: 'apiRequest',
      position: { x: 3, y: 0 },
      data: { apiRequest: apiConfig() },
    },
    { id: 'success', type: 'finish', position: { x: 4, y: 0 }, data: {} },
    { id: 'failure', type: 'finish', position: { x: 4, y: 1 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'data-node' },
    { id: 'e2', source: 'data-node', target: 'message-node' },
    { id: 'e3', source: 'message-node', target: 'api-node' },
    {
      id: 'e4',
      source: 'api-node',
      target: 'success',
      sourceHandle: 'success',
    },
    {
      id: 'e5',
      source: 'api-node',
      target: 'failure',
      sourceHandle: 'failure',
    },
  ],
});

const signedFlow = (): ChatbotFlowData => {
  const flow = unsignedFlow();
  const config = flow.nodes.find((node) => node.id === 'api-node')?.data
    .apiRequest;
  if (!config) throw new Error('api-node config is required');

  const fingerprint = createApiRequestFingerprint(
    config,
    getUpstreamApiContracts(flow, 'api-node')
  );
  const testedAt = '2026-07-12T12:00:00.000Z';
  config.test = {
    state: 'tested',
    evidence: {
      proof: signApiRequestProof({
        accountId: 'account-1',
        chatbotId: flow.chatbot_id,
        nodeId: 'api-node',
        fingerprint,
        testedAt,
        statusCode: 200,
        bodyType: 'json',
        contract: config.capture.contract,
        responseHeaders: config.capture.availableResponseHeaders,
      }),
      fingerprint,
      testedAt,
      statusCode: 200,
      durationMs: 10,
      bodyType: 'json',
    },
  };
  return flow;
};

const flowWithoutApi = (): ChatbotFlowData => {
  const flow = unsignedFlow();
  flow.nodes = flow.nodes.filter(
    (node) => node.id !== 'api-node' && node.id !== 'failure'
  );
  flow.edges = [
    { id: 'e1', source: 'start', target: 'data-node' },
    { id: 'e2', source: 'data-node', target: 'message-node' },
    { id: 'e3', source: 'message-node', target: 'success' },
  ];
  return flow;
};

const useCase = new ChatbotFlowSaverUseCase(
  {
    hasOfficialOnlineChannel: jest.fn(),
    hasNonOfficialLinkedChannel: jest.fn(),
  } as never,
  { existsAccountById: jest.fn(async () => true) } as never,
  {} as never,
  {} as never
);

describe('ChatbotFlowSaver captured output proof contract', () => {
  it('accepts evidence signed with the guaranteed Data and Message contracts', async () => {
    const flow = signedFlow();

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).resolves.toBeUndefined();
  });

  it('invalidates evidence when Data changes semantic type', async () => {
    const flow = signedFlow();
    const dataNode = flow.nodes.find((node) => node.id === 'data-node');
    if (dataNode) dataNode.data.dataType = 'cpf';

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_api_test_invalid');
  });

  it('invalidates evidence when Message stops capturing a response', async () => {
    const flow = signedFlow();
    const messageNode = flow.nodes.find((node) => node.id === 'message-node');
    if (messageNode) messageNode.data.continueType = 'automatic';

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_api_test_invalid');
  });
});

describe('ChatbotFlowSaver captured output persistence contract', () => {
  it('persists server-owned keys after reconciling them by node identity', async () => {
    const previous: ChatbotFlowData = {
      chatbot_id: 'chatbot-1',
      nodes: [
        { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
        {
          id: 'data-node',
          type: 'data',
          position: { x: 1, y: 0 },
          data: { dataType: 'email', outputKey: 'data_7' },
        },
        {
          id: 'message-node',
          type: 'message',
          position: { x: 2, y: 0 },
          data: { continueType: 'automatic', outputKey: 'message_4' },
        },
      ],
      edges: [],
    };
    const submitted = structuredClone(previous);
    const submittedData = submitted.nodes.find(
      (node) => node.id === 'data-node'
    );
    const submittedMessage = submitted.nodes.find(
      (node) => node.id === 'message-node'
    );
    if (submittedData) submittedData.data.outputKey = 'data_99';
    if (submittedMessage) submittedMessage.data.outputKey = 'message_99';
    submitted.nodes.push({
      id: 'new-data-node',
      type: 'data',
      position: { x: 3, y: 0 },
      data: { dataType: 'cpf', outputKey: 'data_7' },
    });

    const saveChatbotFlow = jest.fn(async () => 'flow-saved');
    const saver = new ChatbotFlowSaverUseCase(
      {
        findChatbotFlowByChatbotId: jest.fn(async () => previous),
        saveChatbotFlow,
      } as never,
      {} as never,
      {} as never,
      {} as never
    );
    jest.spyOn(saver, 'validate').mockResolvedValue(undefined);

    await saver.execute(t, { request: JSON.stringify(submitted) }, 'account-1');

    expect(saveChatbotFlow).toHaveBeenCalledTimes(1);
    const persisted = (saveChatbotFlow as jest.Mock).mock.calls[0]?.[0] as
      ChatbotFlowData | undefined;
    const keys = Object.fromEntries(
      (persisted?.nodes ?? [])
        .filter((node) => node.type === 'data' || node.type === 'message')
        .map((node) => [node.id, node.data.outputKey])
    );
    expect(keys).toEqual({
      'data-node': 'data_7',
      'message-node': 'message_4',
      'new-data-node': 'data_1',
    });
  });
});

describe('ChatbotFlowSaver captured output type validation', () => {
  it('rejects an unknown Data type on new saves', async () => {
    const flow = flowWithoutApi();
    const dataNode = flow.nodes.find((node) => node.id === 'data-node');
    if (dataNode) dataNode.data.dataType = 'phone';

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_data_type_required');
  });

  it('rejects an unknown Message continuation mode on new saves', async () => {
    const flow = flowWithoutApi();
    const messageNode = flow.nodes.find((node) => node.id === 'message-node');
    if (messageNode) messageNode.data.continueType = 'later';

    await expect(
      useCase.validate(t, flow, { request: flow }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_continue_type_required');
  });
});
