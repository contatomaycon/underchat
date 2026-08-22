import 'reflect-metadata';
import { ChatbotFlowSaverUseCase } from '@core/useCases/chatbot/ChatbotFlowSaver.useCase';
import {
  createApiRequestFingerprint,
  signApiRequestProof,
} from '@core/common/functions/chatbotApiRequestSecurity';
import { chatbotFlowMappings } from '@core/mappings/chatbotFlow.mappings';
import type {
  ApiRequestConfig,
  ChatbotFlowData,
} from '@core/schema/chatbot/chatbotFlow.schema';

const t = ((key: string) => key) as never;

const testedConfig = (): ApiRequestConfig => {
  const config: ApiRequestConfig = {
    version: 1,
    outputKey: 'api_1',
    method: 'GET',
    url: 'https://example.com/users',
    queryParams: [],
    headers: [],
    auth: {
      type: 'none',
      bearer: { token: { id: 'bearer', value: '', hasValue: false } },
      apiKey: {
        placement: 'header',
        name: 'X-API-Key',
        value: { id: 'api-key', value: '', hasValue: false },
      },
      basic: {
        username: { id: 'user', value: '', hasValue: false },
        password: { id: 'password', value: '', hasValue: false },
      },
    },
    body: {
      id: 'body',
      type: 'none',
      json: '',
      raw: '',
      contentType: 'text/plain',
      sensitive: false,
      hasValue: false,
      formFields: [],
      multipart: [],
    },
    execution: {
      mode: 'once',
      itemsExpression: '',
      concurrency: 1,
      failurePolicy: 'failFast',
      timeoutMs: 10000,
      retry: { maxAttempts: 2, initialDelayMs: 200 },
      idempotencyKey: '',
    },
    capture: {
      mode: 'full',
      paths: [],
      responseHeaders: ['x-token'],
      contract: [{ path: 'data.results[].name', type: 'string' }],
      availableResponseHeaders: ['content-type', 'x-token'],
    },
    test: { state: 'untested', evidence: null },
  };
  const fingerprint = createApiRequestFingerprint(config, {});
  const testedAt = '2026-07-12T12:00:00.000Z';
  config.test = {
    state: 'tested',
    evidence: {
      fingerprint,
      testedAt,
      statusCode: 200,
      durationMs: 20,
      bodyType: 'json',
      proof: signApiRequestProof({
        accountId: 'account-1',
        chatbotId: 'chatbot-1',
        nodeId: 'api-node',
        fingerprint,
        testedAt,
        statusCode: 200,
        bodyType: 'json',
        contract: config.capture.contract,
        responseHeaders: config.capture.availableResponseHeaders,
      }),
    },
  };
  return config;
};

const flow = (): ChatbotFlowData => ({
  chatbot_id: 'chatbot-1',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'api-node',
      type: 'apiRequest',
      position: { x: 1, y: 0 },
      data: { apiRequest: testedConfig() },
    },
    { id: 'success', type: 'finish', position: { x: 2, y: 0 }, data: {} },
    { id: 'failure', type: 'finish', position: { x: 2, y: 1 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'api-node' },
    {
      id: 'e2',
      source: 'api-node',
      sourceHandle: 'success',
      target: 'success',
      targetHandle: 'target',
    },
    {
      id: 'e3',
      source: 'api-node',
      sourceHandle: 'failure',
      target: 'failure',
      targetHandle: 'target',
    },
  ],
});

const useCase = new ChatbotFlowSaverUseCase(
  {
    hasOfficialOnlineChannel: jest.fn(),
    hasNonOfficialLinkedChannel: jest.fn(),
  } as never,
  { existsAccountById: jest.fn(async () => true) } as never,
  {} as never,
  {} as never
);

describe('ChatbotFlowSaver API Request contract', () => {
  it('accepts a signed tested request with both mandatory branches', async () => {
    const input = flow();
    await expect(
      useCase.validate(t, input, { request: input }, 'account-1')
    ).resolves.toBeUndefined();
  });

  it('accepts a tested contract after optional false flags are normalized', async () => {
    const input = flow();
    const apiRequest = input.nodes.find((node) => node.id === 'api-node')?.data
      .apiRequest;
    if (!apiRequest?.test.evidence) {
      throw new Error('Expected api-node to have test evidence');
    }

    apiRequest.capture.contract = [
      {
        path: 'data.results[].name',
        type: 'string',
        nullable: false,
        projectedFromArray: false,
      },
    ];

    await expect(
      useCase.validate(t, input, { request: input }, 'account-1')
    ).resolves.toBeUndefined();
  });

  it('rejects a proof after the request changes', async () => {
    const input = flow();
    const apiRequest = input.nodes.find((node) => node.id === 'api-node')?.data
      .apiRequest;
    if (!apiRequest) {
      throw new Error('Expected api-node to have an apiRequest config');
    }
    apiRequest.url = 'https://example.com/changed';
    await expect(
      useCase.validate(t, input, { request: input }, 'account-1')
    ).rejects.toThrow('chatbot_flow_validation_api_test_invalid');
  });

  it('stores apiRequest as an opaque Elasticsearch object', () => {
    const mapping = chatbotFlowMappings() as any;
    expect(
      mapping.mappings.properties.nodes.properties.data.properties.apiRequest
    ).toEqual({ type: 'object', enabled: false });
  });
});
