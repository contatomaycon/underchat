import {
  assignStableApiRequestOutputKeys,
  computeChatbotFlowDominators,
  validateChatbotApiVariableDependencies,
} from '@core/common/functions/chatbotApiGraph';
import type {
  ApiRequestConfig,
  ChatbotFlowData,
} from '@core/schema/chatbot/chatbotFlow.schema';

const apiConfig = (outputKey: string): ApiRequestConfig => ({
  version: 1,
  outputKey,
  method: 'GET',
  url: 'https://example.com',
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
      username: { id: 'username', value: '', hasValue: false },
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
    retry: { maxAttempts: 1, initialDelayMs: 100 },
    idempotencyKey: '',
  },
  capture: {
    mode: 'full',
    paths: [],
    responseHeaders: ['x-token'],
    contract: [{ path: 'data.results[].name', type: 'string' }],
    availableResponseHeaders: ['x-token'],
  },
  test: { state: 'untested', evidence: null },
});

const flow = (): ChatbotFlowData => ({
  chatbot_id: 'chatbot-1',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'api-a',
      type: 'apiRequest',
      position: { x: 1, y: 0 },
      data: { apiRequest: apiConfig('api_1') },
    },
    {
      id: 'message',
      type: 'message',
      position: { x: 2, y: 0 },
      data: { text: 'Nomes: {{ api_1.data.results.name }}' },
    },
    { id: 'finish', type: 'finish', position: { x: 3, y: 0 }, data: {} },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'api-a' },
    {
      id: 'e2',
      source: 'api-a',
      target: 'message',
      sourceHandle: 'success',
    },
    {
      id: 'e3',
      source: 'api-a',
      target: 'finish',
      sourceHandle: 'failure',
    },
    { id: 'e4', source: 'message', target: 'finish' },
  ],
});

describe('chatbot API graph dependencies', () => {
  it('recognizes a guaranteed upstream API and projected array path', () => {
    expect(validateChatbotApiVariableDependencies(flow())).toEqual([]);
    expect(computeChatbotFlowDominators(flow()).get('message')).toContain(
      'api-a'
    );
  });

  it('rejects an API value that is available on only one branch', () => {
    const input = flow();
    input.nodes.push({
      id: 'bypass',
      type: 'message',
      position: { x: 1, y: 1 },
      data: { text: 'bypass' },
    });
    input.edges.push(
      { id: 'b1', source: 'start', target: 'bypass' },
      { id: 'b2', source: 'bypass', target: 'message' }
    );
    expect(validateChatbotApiVariableDependencies(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ambiguous_api_dependency' }),
      ])
    );
  });

  it('keeps rejecting a request that references its own output', () => {
    const input = flow();
    const config = input.nodes.find((node) => node.id === 'api-a')?.data
      .apiRequest;
    if (config) config.url = 'https://example.com/{{ api_1.data.id }}';

    expect(validateChatbotApiVariableDependencies(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ambiguous_api_dependency',
          nodeId: 'api-a',
          sourceNodeId: 'api-a',
        }),
      ])
    );
  });

  it('preserves existing prefixes and assigns the next key to a new node', () => {
    const previous = flow();
    const input = flow();
    input.nodes.push({
      id: 'api-b',
      type: 'apiRequest',
      position: { x: 2, y: 1 },
      data: { apiRequest: apiConfig('api_1') },
    });
    const assigned = assignStableApiRequestOutputKeys(input, previous);
    expect(
      assigned.nodes.find((node) => node.id === 'api-a')?.data.apiRequest
        ?.outputKey
    ).toBe('api_1');
    expect(
      assigned.nodes.find((node) => node.id === 'api-b')?.data.apiRequest
        ?.outputKey
    ).toBe('api_2');
  });

  it('reserves removed API keys while preserving a valid new session key', () => {
    const previous = flow();
    previous.nodes.push({
      id: 'api-removed',
      type: 'apiRequest',
      position: { x: 1, y: 1 },
      data: { apiRequest: apiConfig('api_2') },
    });

    const input = flow();
    input.nodes.push({
      id: 'api-new',
      type: 'apiRequest',
      position: { x: 1, y: 1 },
      data: { apiRequest: apiConfig('api_2') },
    });
    const assigned = assignStableApiRequestOutputKeys(input, previous);

    expect(
      assigned.nodes.find((node) => node.id === 'api-a')?.data.apiRequest
        ?.outputKey
    ).toBe('api_1');
    expect(
      assigned.nodes.find((node) => node.id === 'api-new')?.data.apiRequest
        ?.outputKey
    ).toBe('api_3');

    const firstSave = flow();
    firstSave.nodes.push({
      id: 'api-session',
      type: 'apiRequest',
      position: { x: 1, y: 1 },
      data: { apiRequest: apiConfig('api_9') },
    });
    expect(
      assignStableApiRequestOutputKeys(firstSave).nodes.find(
        (node) => node.id === 'api-session'
      )?.data.apiRequest?.outputKey
    ).toBe('api_9');
  });
});
