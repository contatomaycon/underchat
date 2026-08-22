import { assignStableChatbotNodeOutputKeys } from '@core/common/functions/chatbotNodeOutputs';
import {
  computeChatbotFlowDominators,
  extractChatbotNodeTemplatePaths,
  getUpstreamApiContracts,
  validateChatbotApiVariableDependencies,
} from '@core/common/functions/chatbotApiGraph';
import { createApiRequestFingerprint } from '@core/common/functions/chatbotApiRequestSecurity';
import { resolveChatbotTemplate } from '@core/common/functions/chatbotApiVariables';
import type {
  ApiRequestConfig,
  ChatbotFlowData,
} from '@core/schema/chatbot/chatbotFlow.schema';

const apiConfig = (): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_1',
  method: 'POST',
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
    type: 'json',
    json: JSON.stringify({ reply: '{{ message_1.text }}' }),
    raw: '',
    contentType: 'application/json',
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
    contract: [],
    availableResponseHeaders: [],
  },
  test: { state: 'untested', evidence: null },
});

const linearCaptureFlow = (): ChatbotFlowData => ({
  chatbot_id: 'chatbot-1',
  nodes: [
    { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: {} },
    {
      id: 'data-node',
      type: 'data',
      position: { x: 1, y: 0 },
      data: { dataType: 'email', outputKey: 'data_1' },
    },
    {
      id: 'message-node',
      type: 'message',
      position: { x: 2, y: 0 },
      data: { continueType: 'after_response', outputKey: 'message_1' },
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

describe('captured Data and Message output foundations', () => {
  it('resolves the agreed typed runtime shapes in API-compatible templates', () => {
    const scope = {
      data_1: { value: 'maycon@example.com', email: 'maycon@example.com' },
      message_1: { text: 'Pode continuar' },
    };

    expect(resolveChatbotTemplate('{{ data_1.value }}', scope)).toBe(
      'maycon@example.com'
    );
    expect(resolveChatbotTemplate('{{ data_1.email }}', scope)).toBe(
      'maycon@example.com'
    );
    expect(resolveChatbotTemplate('{{ message_1.text }}', scope)).toBe(
      'Pode continuar'
    );
  });

  it('extracts captured-output dependencies from every API config field', () => {
    const apiNode = linearCaptureFlow().nodes.find(
      (node) => node.id === 'api-node'
    );

    if (!apiNode) {
      throw new Error('Expected api-node fixture to exist');
    }
    expect(extractChatbotNodeTemplatePaths(apiNode)).toEqual([
      'data_1.value',
      'message_1.text',
    ]);
  });

  it('recognizes linear Data and Message producers as guaranteed upstream', () => {
    const dominators = computeChatbotFlowDominators(linearCaptureFlow());

    expect([...(dominators.get('api-node') ?? [])]).toEqual(
      expect.arrayContaining(['start', 'data-node', 'message-node', 'api-node'])
    );
    expect(dominators.get('api-node')).toContain('data-node');
    expect(dominators.get('api-node')).toContain('message-node');
  });

  it('does not guarantee either producer when a path bypasses both', () => {
    const flow = linearCaptureFlow();
    flow.edges.push({ id: 'bypass', source: 'start', target: 'api-node' });

    const apiDominators = computeChatbotFlowDominators(flow).get('api-node');

    expect(apiDominators).not.toContain('data-node');
    expect(apiDominators).not.toContain('message-node');
  });

  it('accepts captured-output references only when both producers dominate the API', () => {
    expect(validateChatbotApiVariableDependencies(linearCaptureFlow())).toEqual(
      []
    );

    const bypassed = linearCaptureFlow();
    bypassed.edges.push({
      id: 'bypass',
      source: 'start',
      target: 'api-node',
    });

    expect(validateChatbotApiVariableDependencies(bypassed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ambiguous_output_dependency',
          path: 'data_1.value',
          sourceNodeId: 'data-node',
        }),
        expect.objectContaining({
          code: 'ambiguous_output_dependency',
          path: 'message_1.text',
          sourceNodeId: 'message-node',
        }),
      ])
    );
  });

  it('rejects ambiguous roots when multiple nodes claim the same output key', () => {
    const flow = linearCaptureFlow();
    flow.nodes.push({
      id: 'duplicate-data-node',
      type: 'data',
      position: { x: 1, y: 1 },
      data: { dataType: 'email', outputKey: 'data_1' },
    });

    expect(validateChatbotApiVariableDependencies(flow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ambiguous_output_dependency',
          path: 'data_1.value',
        }),
      ])
    );
  });

  it('rejects a Data alias after its semantic type changes', () => {
    const emailFlow = linearCaptureFlow();
    const emailApi = emailFlow.nodes.find((node) => node.id === 'api-node')
      ?.data.apiRequest;
    if (emailApi) {
      emailApi.url = 'https://example.com/customers/{{ data_1.email }}';
    }
    expect(validateChatbotApiVariableDependencies(emailFlow)).toEqual([]);

    const cpfFlow = structuredClone(emailFlow);
    const dataNode = cpfFlow.nodes.find((node) => node.id === 'data-node');
    if (dataNode) dataNode.data.dataType = 'cpf';

    expect(validateChatbotApiVariableDependencies(cpfFlow)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'uncaptured_output_path',
          path: 'data_1.email',
          sourceNodeId: 'data-node',
        }),
      ])
    );
  });

  it('preserves valid requested keys and their tags for nodes created in one session', () => {
    const flow = linearCaptureFlow();
    const dataNode = flow.nodes.find((node) => node.id === 'data-node');
    const messageNode = flow.nodes.find((node) => node.id === 'message-node');
    const api = flow.nodes.find((node) => node.id === 'api-node')?.data
      .apiRequest;
    if (dataNode) dataNode.data.outputKey = 'data_9';
    if (messageNode) messageNode.data.outputKey = 'message_7';
    if (api) {
      api.url = 'https://example.com/customers/{{ data_9.value }}';
      api.body.type = 'json';
      api.body.json = JSON.stringify({ reply: '{{ message_7.text }}' });
    }

    const assigned = assignStableChatbotNodeOutputKeys(flow);

    expect(
      assigned.nodes.find((node) => node.id === 'data-node')?.data.outputKey
    ).toBe('data_9');
    expect(
      assigned.nodes.find((node) => node.id === 'message-node')?.data.outputKey
    ).toBe('message_7');
    expect(validateChatbotApiVariableDependencies(assigned)).toEqual([]);
  });

  it('does not retarget a historical tag when its producer is replaced', () => {
    const previous = linearCaptureFlow();
    const submitted = linearCaptureFlow();
    submitted.nodes = submitted.nodes.filter((node) => node.id !== 'data-node');
    submitted.edges = submitted.edges.filter(
      (edge) => edge.source !== 'data-node' && edge.target !== 'data-node'
    );
    submitted.nodes.push({
      id: 'replacement-data',
      type: 'data',
      position: { x: 1, y: 0 },
      data: { dataType: 'email', outputKey: 'data_1' },
    });
    submitted.edges.push(
      { id: 'replacement-in', source: 'start', target: 'replacement-data' },
      {
        id: 'replacement-out',
        source: 'replacement-data',
        target: 'message-node',
      }
    );

    const assigned = assignStableChatbotNodeOutputKeys(submitted, previous);

    expect(
      assigned.nodes.find((node) => node.id === 'replacement-data')?.data
        .outputKey
    ).toBe('data_2');
    expect(validateChatbotApiVariableDependencies(assigned)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_output_origin',
          path: 'data_1.value',
        }),
      ])
    );
  });

  it('includes captured contracts in the API fingerprint inputs', () => {
    const original = linearCaptureFlow();
    const apiNode = original.nodes.find((node) => node.id === 'api-node');
    const config = apiNode?.data.apiRequest;
    if (!config) {
      throw new Error(
        'Expected api-node fixture to have an API request config'
      );
    }

    const originalUpstream = getUpstreamApiContracts(original, 'api-node');
    expect(originalUpstream).toEqual(
      expect.objectContaining({
        data_1: expect.objectContaining({
          type: 'data',
          contract: expect.arrayContaining([
            { path: 'value', type: 'string' },
            { path: 'email', type: 'string' },
          ]),
        }),
        message_1: expect.objectContaining({
          type: 'message',
          contract: expect.arrayContaining([
            { path: 'text', type: 'string' },
            { path: 'type', type: 'string' },
            {
              path: 'media.url',
              type: 'string',
              nullable: true,
            },
          ]),
        }),
      })
    );
    const originalFingerprint = createApiRequestFingerprint(
      config,
      originalUpstream
    );

    const changedDataType = structuredClone(original);
    const dataNode = changedDataType.nodes.find(
      (node) => node.id === 'data-node'
    );
    if (dataNode) dataNode.data.dataType = 'cpf';
    expect(
      createApiRequestFingerprint(
        config,
        getUpstreamApiContracts(changedDataType, 'api-node')
      )
    ).not.toBe(originalFingerprint);

    const inactiveMessage = structuredClone(original);
    const messageNode = inactiveMessage.nodes.find(
      (node) => node.id === 'message-node'
    );
    if (messageNode) messageNode.data.continueType = 'automatic';
    expect(
      createApiRequestFingerprint(
        config,
        getUpstreamApiContracts(inactiveMessage, 'api-node')
      )
    ).not.toBe(originalFingerprint);
  });
});
