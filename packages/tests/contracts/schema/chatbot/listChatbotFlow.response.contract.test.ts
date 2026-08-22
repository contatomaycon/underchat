import fastJson from 'fast-json-stringify';
import { listChatbotFlowSchema } from '@core/schema/chatbot/listChatbotFlow';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';

const apiRequestConfig = (proof: string): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_1',
  method: 'GET',
  url: 'https://example.com/customers',
  queryParams: [],
  headers: [],
  auth: {
    type: 'none',
    bearer: { token: { id: 'bearer', hasValue: false } },
    apiKey: {
      placement: 'header',
      name: 'X-API-Key',
      value: { id: 'api-key', hasValue: false },
    },
    basic: {
      username: { id: 'username', hasValue: false },
      password: { id: 'password', hasValue: false },
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
    timeoutMs: 15_000,
    retry: { maxAttempts: 1, initialDelayMs: 500 },
    idempotencyKey: '',
  },
  capture: {
    mode: 'full',
    paths: [],
    responseHeaders: [],
    contract: [{ path: 'data.id', type: 'string' }],
    availableResponseHeaders: ['content-type'],
  },
  test: {
    state: 'tested',
    evidence: {
      proof,
      fingerprint: 'fingerprint',
      testedAt: '2026-07-12T21:44:58.319Z',
      statusCode: 200,
      durationMs: 5,
      bodyType: 'json',
    },
  },
});

describe('listChatbotFlow response contract', () => {
  it('serializes an API Request evidence proof larger than the legacy 512 byte limit', () => {
    const proof = 'signed-proof-segment'.repeat(128);
    const serialize = fastJson(listChatbotFlowSchema.response[200] as never);

    const response = JSON.parse(
      serialize({
        status: true,
        message: 'Flow listed successfully',
        data: {
          chatbot_flow_id: 'flow-1',
          chatbot_id: 'chatbot-1',
          account_id: 'account-1',
          nodes: [
            {
              id: 'api-node',
              type: 'apiRequest',
              position: { x: 0, y: 0 },
              data: { apiRequest: apiRequestConfig(proof) },
            },
          ],
          edges: [],
        },
      })
    ) as {
      data: {
        nodes: Array<{
          data: { apiRequest: ApiRequestConfig };
        }>;
      };
    };

    expect(response.data.nodes[0]?.data.apiRequest.test.evidence?.proof).toBe(
      proof
    );
  });

  it('round-trips the official template parameter format', () => {
    const serialize = fastJson(listChatbotFlowSchema.response[200] as never);

    const response = JSON.parse(
      serialize({
        status: true,
        message: 'Flow listed successfully',
        data: {
          chatbot_flow_id: 'flow-1',
          chatbot_id: 'chatbot-1',
          account_id: 'account-1',
          nodes: [
            {
              id: 'official-node',
              type: 'officialTemplate',
              position: { x: 0, y: 0 },
              data: {
                templateName: 'service_update',
                templateLanguage: 'pt_BR',
                templateParameterFormat: 'NAMED',
              },
            },
          ],
          edges: [],
        },
      })
    ) as {
      data: {
        nodes: Array<{
          data: { templateParameterFormat?: string };
        }>;
      };
    };

    expect(response.data.nodes[0]?.data.templateParameterFormat).toBe('NAMED');
  });
});
