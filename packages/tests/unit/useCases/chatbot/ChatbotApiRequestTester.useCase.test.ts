import 'reflect-metadata';
import { ChatbotApiRequestTesterUseCase } from '@core/useCases/chatbot/ChatbotApiRequestTester.useCase';
import { ChatbotApiRequestExecutorService } from '@core/services/chatbotApiRequestExecutor.service';
import { PasswordEncryptorService } from '@core/services/passwordEncryptor.service';
import { ChatbotApiRequestTestError } from '@core/common/exceptions/ChatbotApiRequestTestError';
import { verifyApiRequestProof } from '@core/common/functions/chatbotApiRequestSecurity';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';

const configuration = (
  method: ApiRequestConfig['method'] = 'GET'
): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_1',
  method,
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
    retry: { maxAttempts: 3, initialDelayMs: 100 },
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

describe('ChatbotApiRequestTesterUseCase', () => {
  const originalAppEnvironment = process.env.APP_ENVIRONMENT;
  const originalLocalhostFlag =
    process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;
  const redis = {
    incr: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
  };
  const chatbotService = {
    isChatbotActive: jest.fn(async () => true),
    findChatbotFlowByChatbotId: jest.fn(async () => null),
  };
  const useCase = new ChatbotApiRequestTesterUseCase(
    redis as never,
    chatbotService as never,
    new PasswordEncryptorService()
  );

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAppEnvironment === undefined) {
      delete process.env.APP_ENVIRONMENT;
    } else {
      process.env.APP_ENVIRONMENT = originalAppEnvironment;
    }
    if (originalLocalhostFlag === undefined) {
      delete process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;
    } else {
      process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP =
        originalLocalhostFlag;
    }
  });

  it('executes one attempt, infers a contract and returns a verifiable proof', async () => {
    process.env.APP_ENVIRONMENT = 'LOCAL';
    delete process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP;
    const execute = jest
      .spyOn(ChatbotApiRequestExecutorService.prototype, 'execute')
      .mockResolvedValue({
        mode: 'once',
        ok: true,
        outputKey: 'api_1',
        body: { data: { results: [{ name: 'Ada' }] } },
        response: {
          status: 200,
          ok: true,
          headers: { 'x-token': 'response-token' },
          contentType: 'application/json',
          sizeBytes: 42,
          durationMs: 10,
          attempts: 1,
        },
        items: [],
        durationMs: 10,
      });

    const result = await useCase.execute(
      {
        chatbot_id: 'chatbot-1',
        node_id: 'api-node-1',
        configuration: configuration(),
        sample_variables: {
          'data_1.cpf': '12345678901',
          '{{ message_1.text }}': 'Olá',
        },
        upstream_contracts: {},
        confirm_side_effects: false,
      },
      'account-1',
      'user-1'
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        maxHttpAttempts: 1,
        captureAllResponseHeaders: true,
        allowLocalhostHttp: false,
        variables: {
          data_1: { cpf: '12345678901' },
          message_1: { text: 'Olá' },
        },
      })
    );
    expect(result.contract).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'data.results[].name',
          type: 'string',
        }),
      ])
    );
    expect(
      verifyApiRequestProof(result.evidence.proof, {
        accountId: 'account-1',
        chatbotId: 'chatbot-1',
        nodeId: 'api-node-1',
        fingerprint: result.evidence.fingerprint,
        testedAt: result.evidence.testedAt,
        statusCode: 200,
        bodyType: 'json',
        contract: result.contract,
        responseHeaders: ['x-token'],
      })
    ).toBe(true);
  });

  it('passes the dedicated localhost flag to API test execution', async () => {
    process.env.APP_ENVIRONMENT = 'LOCAL';
    process.env.CHATBOT_API_REQUEST_ALLOW_LOCALHOST_HTTP = 'true';
    const execute = jest
      .spyOn(ChatbotApiRequestExecutorService.prototype, 'execute')
      .mockResolvedValue({
        mode: 'once',
        ok: true,
        outputKey: 'api_1',
        body: { ok: true },
        response: {
          status: 200,
          ok: true,
          headers: {},
          contentType: 'application/json',
          sizeBytes: 11,
          durationMs: 2,
          attempts: 1,
        },
        items: [],
        durationMs: 2,
      });

    await useCase.execute(
      {
        chatbot_id: 'chatbot-1',
        node_id: 'api-node-1',
        configuration: configuration(),
        confirm_side_effects: false,
      },
      'account-1',
      'user-1'
    );

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ allowLocalhostHttp: true })
    );
  });

  it('requires explicit confirmation for side-effect methods', async () => {
    await expect(
      useCase.execute(
        {
          chatbot_id: 'chatbot-1',
          node_id: 'api-node-1',
          configuration: configuration('POST'),
          confirm_side_effects: false,
        },
        'account-1',
        'user-1'
      )
    ).rejects.toMatchObject<Partial<ChatbotApiRequestTestError>>({
      code: 'side_effect_confirmation_required',
      httpStatusCode: 400,
    });
  });

  it('returns a typed 400 when a configured variable has no sample value', async () => {
    const config = configuration();
    config.execution.idempotencyKey = '{{ data_1.value }}';

    await expect(
      useCase.execute(
        {
          chatbot_id: 'chatbot-1',
          node_id: 'api-node-1',
          configuration: config,
          sample_variables: {},
          confirm_side_effects: false,
        },
        'account-1',
        'user-1'
      )
    ).rejects.toMatchObject<Partial<ChatbotApiRequestTestError>>({
      code: 'sample_variables_required',
      httpStatusCode: 400,
      message: 'chatbot_api_request_test_sample_variables_required',
    });
  });

  it('rejects unsafe sample variable paths without executing the request', async () => {
    const execute = jest.spyOn(
      ChatbotApiRequestExecutorService.prototype,
      'execute'
    );

    await expect(
      useCase.execute(
        {
          chatbot_id: 'chatbot-1',
          node_id: 'api-node-1',
          configuration: configuration(),
          sample_variables: {
            'data_1.__proto__.polluted': 'yes',
          },
          confirm_side_effects: false,
        },
        'account-1',
        'user-1'
      )
    ).rejects.toMatchObject<Partial<ChatbotApiRequestTestError>>({
      code: 'invalid_api_request',
      httpStatusCode: 400,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('enforces ten tests per minute per account and user', async () => {
    redis.incr.mockResolvedValueOnce(11);
    await expect(
      useCase.execute(
        {
          chatbot_id: 'chatbot-1',
          node_id: 'api-node-1',
          configuration: configuration(),
          confirm_side_effects: false,
        },
        'account-1',
        'user-1'
      )
    ).rejects.toMatchObject<Partial<ChatbotApiRequestTestError>>({
      code: 'test_rate_limit_exceeded',
      httpStatusCode: 429,
    });
  });
});
