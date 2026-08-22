import { getChatbotApiRequestTestVariablePaths } from '@core/common/functions/chatbotApiRequestSampleVariables';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';

const configuration = (): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_2',
  method: 'POST',
  url: 'https://example.com/customers/{{ data_1.cpf }}',
  queryParams: [
    {
      id: 'query-1',
      enabled: true,
      key: 'filter-{{ index }}',
      value: '{{ message_1.text }}',
      sensitive: false,
    },
    {
      id: 'query-disabled',
      enabled: false,
      key: 'ignored',
      value: '{{ ignored.query }}',
      sensitive: false,
    },
  ],
  headers: [
    {
      id: 'header-1',
      enabled: true,
      key: 'X-Account',
      value: '{{ account_name }}',
      sensitive: false,
    },
  ],
  auth: {
    type: 'apiKey',
    bearer: {
      token: { id: 'bearer', value: '{{ ignored.bearer }}' },
    },
    apiKey: {
      placement: 'header',
      name: 'X-Key-{{ channel_name }}',
      value: { id: 'api-key', value: '{{ api_1.token }}' },
    },
    basic: {
      username: { id: 'username', value: '{{ ignored.username }}' },
      password: { id: 'password', value: '{{ ignored.password }}' },
    },
  },
  body: {
    id: 'body',
    type: 'multipart',
    json: '{"ignored":"{{ ignored.json }}"}',
    raw: '{{ ignored.raw }}',
    contentType: 'text/plain',
    sensitive: false,
    formFields: [],
    multipart: [
      {
        id: 'part-1',
        enabled: true,
        name: 'document-{{ protocol }}',
        type: 'file',
        value: '{{ api_1.document }}',
        fileName: '{{ data_1.cpf }}.pdf',
        contentType: '{{ api_1.mime }}',
        sensitive: false,
      },
      {
        id: 'part-disabled',
        enabled: false,
        name: 'ignored',
        type: 'text',
        value: '{{ ignored.multipart }}',
        fileName: '',
        contentType: '',
        sensitive: false,
      },
    ],
  },
  execution: {
    mode: 'forEach',
    itemsExpression: '{{ api_1.items }}',
    concurrency: 1,
    failurePolicy: 'failFast',
    timeoutMs: 10_000,
    retry: { maxAttempts: 1, initialDelayMs: 100 },
    idempotencyKey: 'customer-{{ data_1.cpf }}',
  },
  capture: {
    mode: 'fields',
    paths: ['{{ ignored.capture }}'],
    responseHeaders: [],
    contract: [],
    availableResponseHeaders: [],
  },
  test: { state: 'untested', evidence: null },
});

describe('getChatbotApiRequestTestVariablePaths', () => {
  it('collects only values serialized by the one-call probe', () => {
    expect(getChatbotApiRequestTestVariablePaths(configuration())).toEqual([
      'account_name',
      'api_1.document',
      'api_1.mime',
      'api_1.token',
      'channel_name',
      'data_1.cpf',
      'index',
      'message_1.text',
      'protocol',
    ]);
  });

  it('ignores body variables for methods that do not serialize a body', () => {
    const config = configuration();
    config.method = 'GET';

    expect(getChatbotApiRequestTestVariablePaths(config)).not.toEqual(
      expect.arrayContaining(['api_1.document', 'api_1.mime', 'protocol'])
    );
    expect(getChatbotApiRequestTestVariablePaths(config)).toContain(
      'data_1.cpf'
    );
  });

  it('uses only the active authentication branch', () => {
    const config = configuration();
    config.auth.type = 'none';

    expect(getChatbotApiRequestTestVariablePaths(config)).not.toEqual(
      expect.arrayContaining(['api_1.token', 'channel_name', 'ignored.bearer'])
    );
  });
});
