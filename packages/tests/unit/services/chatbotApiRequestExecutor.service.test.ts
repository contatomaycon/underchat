import {
  CHATBOT_API_REQUEST_MAX_HTTP_ATTEMPTS,
  CHATBOT_API_REQUEST_MAX_ITEMS,
  ChatbotApiRequestExecutorService,
} from '@core/services/chatbotApiRequestExecutor.service';
import type { ApiRequestConfig } from '@core/schema/chatbot/chatbotFlow.schema';
import type {
  ExecuteSafeOutboundHttpInput,
  SafeOutboundHttpFailure,
  SafeOutboundHttpResponse,
} from '@core/common/functions/safeOutboundHttp';

const makeConfig = (): ApiRequestConfig => ({
  version: 1,
  outputKey: 'api_1',
  method: 'GET',
  url: 'https://api.example.com/resource',
  queryParams: [],
  headers: [],
  auth: {
    type: 'none',
    bearer: { token: { id: 'bearer-token', value: '' } },
    apiKey: {
      placement: 'header',
      name: 'X-Api-Key',
      value: { id: 'api-key', value: '' },
    },
    basic: {
      username: { id: 'basic-user', value: '' },
      password: { id: 'basic-password', value: '' },
    },
  },
  body: {
    id: 'body',
    type: 'none',
    contentType: '',
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

const response = (
  statusCode: number,
  body: unknown = { ok: true },
  headers: Record<string, string | string[]> = {
    'content-type': 'application/json',
  }
): SafeOutboundHttpResponse => ({
  kind: 'response',
  statusCode,
  headers,
  body: Buffer.isBuffer(body)
    ? body
    : Buffer.from(
        typeof body === 'string' ? body : JSON.stringify(body),
        'utf8'
      ),
  finalUrl: 'https://api.example.com/resource',
  redirectCount: 0,
  durationMs: 2,
});

const transportFailure = (
  code: SafeOutboundHttpFailure['code'] = 'network_error'
): SafeOutboundHttpFailure => ({
  kind: 'failure',
  code,
  message: 'Outbound HTTP request failed',
  retryable: true,
  isTimeout: code === 'timeout',
  durationMs: 2,
});

describe('ChatbotApiRequestExecutorService', () => {
  it('serializes URL/query/header templates, bearer auth and selected response data', async () => {
    const config = makeConfig();
    config.url = 'https://api.example.com/users/{{ userId }}?existing=yes';
    config.queryParams = [
      {
        id: 'query-1',
        enabled: true,
        key: 'tag',
        value: '{{ tags }}',
        sensitive: false,
      },
    ];
    config.headers = [
      {
        id: 'header-1',
        enabled: true,
        key: 'X-Tenant',
        value: '{{ tenant }}',
        sensitive: false,
      },
    ];
    config.auth.type = 'bearer';
    config.auth.bearer.token.value = '{{ auth.token }}';
    config.capture.mode = 'fields';
    config.capture.paths = ['data.id'];
    config.capture.responseHeaders = ['X-Request-Id'];
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(
        200,
        { data: { id: 7, hidden: true }, ignored: true },
        {
          'content-type': 'application/json',
          'x-request-id': 'request-1',
          'x-ignored': 'ignored',
        }
      )
    );
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const result = await service.execute({
      config,
      variables: {
        userId: 'a/b',
        tags: ['one', 'two'],
        tenant: 42,
        auth: { token: 'token-1' },
      },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).toHaveBeenCalledTimes(1);
    const request = executeHttp.mock.calls[0]?.[0];
    expect(request?.url).toBe(
      'https://api.example.com/users/a/b?existing=yes&tag=one&tag=two'
    );
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer token-1',
      'x-tenant': '42',
    });
    expect(request?.sensitiveHeaderNames).toEqual(['authorization']);
    expect(result).toMatchObject({
      mode: 'once',
      ok: true,
      body: { data: { id: 7 } },
      response: {
        status: 200,
        headers: { 'x-request-id': 'request-1' },
      },
    });
  });

  it('rejects variables in URL scheme/host/port before any HTTP call', async () => {
    const config = makeConfig();
    config.url = 'https://{{ host }}/resource';
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(200)
    );
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const result = await service.execute({
      config,
      variables: { host: 'api.example.com' },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      response: {
        attempts: 0,
        error: { code: 'invalid_url_template' },
      },
    });
  });

  it('preserves native template types in JSON and decrypts protected fields', async () => {
    const config = makeConfig();
    config.method = 'POST';
    config.body.type = 'json';
    config.body.json =
      '{"customer":"{{ customerId }}","payload":"{{ payload }}"}';
    config.execution.idempotencyKey = 'create-order';
    config.headers = [
      {
        id: 'protected-header',
        enabled: true,
        key: 'X-Private',
        sensitive: true,
        hasValue: true,
        ciphertext: 'encrypted-private',
      },
    ];
    const decrypt = jest.fn(() => 'private-value');
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(201)
    );
    const service = new ChatbotApiRequestExecutorService({
      executeHttp,
      secretDecryptor: { decrypt },
    });

    const result = await service.execute({
      config,
      variables: { customerId: 7, payload: { lines: [1, 2] } },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    const request = executeHttp.mock.calls[0]?.[0];
    expect(JSON.parse(request?.body?.toString('utf8') ?? '')).toEqual({
      customer: 7,
      payload: { lines: [1, 2] },
    });
    expect(request?.headers).toMatchObject({
      'content-type': 'application/json',
      'idempotency-key': 'create-order',
      'x-private': 'private-value',
    });
    expect(request?.sensitiveHeaderNames).toContain('x-private');
    expect(decrypt).toHaveBeenCalledWith('encrypted-private');
    expect(result.ok).toBe(true);
  });

  it('serializes raw buffers, form fields, API-key query and Basic auth', async () => {
    const rawConfig = makeConfig();
    rawConfig.method = 'PUT';
    rawConfig.body.type = 'raw';
    rawConfig.body.raw = '{{ binary }}';
    rawConfig.body.contentType = 'application/octet-stream';
    rawConfig.auth.type = 'apiKey';
    rawConfig.auth.apiKey.placement = 'query';
    rawConfig.auth.apiKey.name = 'access_key';
    rawConfig.auth.apiKey.value.value = 'key-1';

    const formConfig = makeConfig();
    formConfig.method = 'POST';
    formConfig.body.type = 'formUrlEncoded';
    formConfig.body.formFields = [
      {
        id: 'field-1',
        enabled: true,
        key: 'role',
        value: '{{ roles }}',
        sensitive: false,
      },
    ];
    formConfig.auth.type = 'basic';
    formConfig.auth.basic.username.value = 'user';
    formConfig.auth.basic.password.value = 'pass';

    const requests: ExecuteSafeOutboundHttpInput[] = [];
    const executeHttp = jest.fn(async (input: ExecuteSafeOutboundHttpInput) => {
      requests.push(input);
      return response(200);
    });
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    await service.execute({
      config: rawConfig,
      variables: { binary: Buffer.from([0, 1, 255]) },
      isProduction: true,
      allowLocalhostHttp: false,
    });
    await service.execute({
      config: formConfig,
      variables: { roles: ['admin', 'support'] },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(requests[0]?.url).toBe(
      'https://api.example.com/resource?access_key=key-1'
    );
    expect(requests[0]?.body).toEqual(Buffer.from([0, 1, 255]));
    expect(requests[0]?.headers).toMatchObject({
      'content-type': 'application/octet-stream',
    });
    expect(requests[1]?.body?.toString('utf8')).toBe('role=admin&role=support');
    expect(requests[1]?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('user:pass').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    });
  });

  it('builds multipart text and descriptor-backed file parts', async () => {
    const config = makeConfig();
    config.method = 'POST';
    config.execution.idempotencyKey = 'upload';
    config.body.type = 'multipart';
    config.body.multipart = [
      {
        id: 'text-1',
        enabled: true,
        name: 'description',
        type: 'text',
        value: '{{ description }}',
        fileName: '',
        contentType: '',
        sensitive: false,
      },
      {
        id: 'file-1',
        enabled: true,
        name: 'attachment',
        type: 'file',
        value: '{{ file }}',
        fileName: '',
        contentType: '',
        sensitive: false,
      },
    ];
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(200)
    );
    const service = new ChatbotApiRequestExecutorService({
      executeHttp,
      createMultipartBoundary: () => 'test-boundary',
    });

    await service.execute({
      config,
      variables: {
        description: 'invoice',
        file: {
          base64: Buffer.from('pdf-bytes').toString('base64'),
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
        },
      },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    const request = executeHttp.mock.calls[0]?.[0];
    expect(request?.headers).toMatchObject({
      'content-type': 'multipart/form-data; boundary=test-boundary',
    });
    const multipart = request?.body?.toString('utf8') ?? '';
    expect(multipart).toContain('name="description"\r\n\r\ninvoice');
    expect(multipart).toContain('name="attachment"; filename="invoice.pdf"');
    expect(multipart).toContain('Content-Type: application/pdf');
    expect(multipart).toContain('pdf-bytes');
    expect(multipart.endsWith('--test-boundary--\r\n')).toBe(true);
  });

  it('retries only transient transport/status outcomes and honors Retry-After', async () => {
    const config = makeConfig();
    config.execution.retry.maxAttempts = 3;
    config.execution.retry.initialDelayMs = 100;
    const results = [
      transportFailure(),
      response(503, { unavailable: true }, { 'retry-after': '1' }),
      response(200, { done: true }),
    ];
    const executeHttp = jest.fn(
      async (_input: ExecuteSafeOutboundHttpInput) =>
        results.shift() ?? response(500)
    );
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const service = new ChatbotApiRequestExecutorService({
      executeHttp,
      sleep,
      random: () => 0,
    });

    const result = await service.execute({
      config,
      variables: {},
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 50);
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000);
    expect(result).toMatchObject({
      ok: true,
      response: { attempts: 3, status: 200 },
    });
  });

  it.each(['POST', 'PATCH'] as const)(
    'does not retry %s without an idempotency key',
    async (method) => {
      const config = makeConfig();
      config.method = method;
      config.execution.retry.maxAttempts = 3;
      const executeHttp = jest.fn(
        async (_input: ExecuteSafeOutboundHttpInput) => transportFailure()
      );
      const sleep = jest.fn(async (_milliseconds: number) => undefined);
      const service = new ChatbotApiRequestExecutorService({
        executeHttp,
        sleep,
      });

      const result = await service.execute({
        config,
        variables: {},
        isProduction: true,
        allowLocalhostHttp: false,
      });

      expect(executeHttp).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
      expect(result).toMatchObject({ ok: false, response: { attempts: 1 } });
    }
  );

  it.each([408, 425, 429, 500, 502, 503, 504])(
    'retries configured transient HTTP status %s',
    async (status) => {
      const config = makeConfig();
      config.execution.retry.maxAttempts = 2;
      const executeHttp = jest
        .fn()
        .mockResolvedValueOnce(response(status))
        .mockResolvedValueOnce(response(200));
      const service = new ChatbotApiRequestExecutorService({
        executeHttp,
        sleep: async () => undefined,
      });

      const result = await service.execute({
        config,
        variables: {},
        isProduction: true,
        allowLocalhostHttp: false,
      });

      expect(executeHttp).toHaveBeenCalledTimes(2);
      expect(result.ok).toBe(true);
    }
  );

  it('does not retry other 5xx statuses and treats only 2xx as success', async () => {
    const config = makeConfig();
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(501, { error: 'not implemented' })
    );
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const result = await service.execute({
      config,
      variables: {},
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      body: { error: 'not implemented' },
      response: {
        status: 501,
        attempts: 1,
        error: { code: 'http_status', retryable: false },
      },
    });
  });

  it('runs for-each with bounded concurrency, ordered output and collected errors', async () => {
    const config = makeConfig();
    config.url = 'https://api.example.com/items/{{ item.id }}';
    config.execution.mode = 'forEach';
    config.execution.itemsExpression = '{{ source }}';
    config.execution.concurrency = 2;
    config.execution.failurePolicy = 'collectErrors';
    config.execution.retry.maxAttempts = 1;
    let active = 0;
    let maximumActive = 0;
    const executeHttp = jest.fn(async (input: ExecuteSafeOutboundHttpInput) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const id = Number(new URL(input.url).pathname.split('/').at(-1));
      await new Promise<void>((resolve) =>
        setTimeout(resolve, id % 2 === 0 ? 15 : 1)
      );
      active -= 1;
      return response(id === 2 ? 400 : 200, { id });
    });
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const result = await service.execute({
      config,
      variables: {
        source: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
      },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).toHaveBeenCalledTimes(5);
    expect(maximumActive).toBe(2);
    expect(result).toMatchObject({
      mode: 'forEach',
      ok: false,
      body: [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }],
    });
    expect(result.items.map((item) => item.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.items[2]?.response.status).toBe(400);
  });

  it('stops scheduling after fail-fast and marks remaining positions as skipped', async () => {
    const config = makeConfig();
    config.url = 'https://api.example.com/items/{{ index }}';
    config.execution.mode = 'forEach';
    config.execution.itemsExpression = '{{ source }}';
    config.execution.concurrency = 1;
    config.execution.failurePolicy = 'failFast';
    config.execution.retry.maxAttempts = 1;
    const executeHttp = jest.fn(async (input: ExecuteSafeOutboundHttpInput) => {
      const index = Number(new URL(input.url).pathname.split('/').at(-1));
      return response(index === 1 ? 400 : 200, { index });
    });
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const result = await service.execute({
      config,
      variables: { source: ['a', 'b', 'c', 'd'] },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(4);
    expect(result.items[2]?.response.error?.code).toBe('skipped_fail_fast');
    expect(result.items[3]?.response.error?.code).toBe('skipped_fail_fast');
  });

  it('creates a stable idempotency key per for-each item and attempt', async () => {
    const config = makeConfig();
    config.method = 'POST';
    config.execution.mode = 'forEach';
    config.execution.itemsExpression = '{{ source }}';
    config.execution.failurePolicy = 'collectErrors';
    config.execution.idempotencyKey = 'batch-key';
    config.execution.retry.maxAttempts = 2;
    const keys: string[] = [];
    const attemptsByKey = new Map<string, number>();
    const executeHttp = jest.fn(async (input: ExecuteSafeOutboundHttpInput) => {
      const key = String(input.headers?.['idempotency-key']);
      keys.push(key);
      const attempts = (attemptsByKey.get(key) ?? 0) + 1;
      attemptsByKey.set(key, attempts);
      return attempts === 1 ? transportFailure() : response(200);
    });
    const service = new ChatbotApiRequestExecutorService({
      executeHttp,
      sleep: async () => undefined,
    });

    const result = await service.execute({
      config,
      variables: { source: ['a', 'b'] },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(keys).toEqual([
      'batch-key:0',
      'batch-key:0',
      'batch-key:1',
      'batch-key:1',
    ]);
    expect(result.ok).toBe(true);
    expect(result.items.map((item) => item.response.attempts)).toEqual([2, 2]);
  });

  it('rejects non-array and oversized for-each inputs without network calls', async () => {
    const config = makeConfig();
    config.execution.mode = 'forEach';
    config.execution.itemsExpression = '{{ source }}';
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(200)
    );
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const invalid = await service.execute({
      config,
      variables: { source: 'not-an-array' },
      isProduction: true,
      allowLocalhostHttp: false,
    });
    const oversized = await service.execute({
      config,
      variables: {
        source: Array.from(
          { length: CHATBOT_API_REQUEST_MAX_ITEMS + 1 },
          (_, index) => index
        ),
      },
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).not.toHaveBeenCalled();
    expect(invalid.error?.code).toBe('invalid_items');
    expect(oversized.error?.code).toBe('too_many_items');
  });

  it('fails closed when a masked secret has no ciphertext available', async () => {
    const config = makeConfig();
    config.auth.type = 'bearer';
    config.auth.bearer.token = { id: 'token', value: '', hasValue: true };
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(200)
    );
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const result = await service.execute({
      config,
      variables: {},
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      response: { error: { code: 'missing_secret' } },
    });
  });

  it('sanitizes a thrown HTTP dependency error and applies the retry policy', async () => {
    const config = makeConfig();
    config.execution.retry.maxAttempts = 2;
    const executeHttp = jest
      .fn()
      .mockRejectedValueOnce(new Error('https://secret.example/token'))
      .mockResolvedValueOnce(response(200));
    const service = new ChatbotApiRequestExecutorService({
      executeHttp,
      sleep: async () => undefined,
    });

    const result = await service.execute({
      config,
      variables: {},
      isProduction: true,
      allowLocalhostHttp: false,
    });

    expect(executeHttp).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, response: { attempts: 2 } });
    expect(JSON.stringify(result)).not.toContain('secret.example');
  });

  it('uses a shared HTTP-attempt budget without hiding the last real response', async () => {
    const config = makeConfig();
    config.execution.retry.maxAttempts = 3;
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(503)
    );
    const sleep = jest.fn(async (_milliseconds: number) => undefined);
    const service = new ChatbotApiRequestExecutorService({
      executeHttp,
      sleep,
    });

    const result = await service.execute({
      config,
      variables: {},
      isProduction: true,
      allowLocalhostHttp: false,
      maxHttpAttempts: 1,
    });

    expect(executeHttp).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: false,
      response: {
        status: 503,
        attempts: 1,
        error: { code: 'http_status' },
      },
    });
  });

  it('shares the HTTP-attempt budget across concurrent for-each items', async () => {
    const config = makeConfig();
    config.execution.mode = 'forEach';
    config.execution.itemsExpression = '{{ source }}';
    config.execution.concurrency = 3;
    config.execution.failurePolicy = 'collectErrors';
    const executeHttp = jest.fn(async (_input: ExecuteSafeOutboundHttpInput) =>
      response(200)
    );
    const service = new ChatbotApiRequestExecutorService({ executeHttp });

    const result = await service.execute({
      config,
      variables: { source: ['a', 'b', 'c', 'd', 'e'] },
      isProduction: true,
      allowLocalhostHttp: false,
      maxHttpAttempts: 2,
    });

    expect(CHATBOT_API_REQUEST_MAX_HTTP_ATTEMPTS).toBe(30);
    expect(executeHttp).toHaveBeenCalledTimes(2);
    expect(
      result.items.reduce((sum, item) => sum + item.response.attempts, 0)
    ).toBe(2);
    expect(
      result.items.filter(
        (item) => item.response.error?.code === 'http_attempt_budget_exhausted'
      )
    ).toHaveLength(3);
  });
});
