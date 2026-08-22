import 'reflect-metadata';
import type Redis from 'ioredis';
import type { AiAgentService } from '@core/services/aiAgent.service';

jest.mock('@core/common/functions/safeOutboundHttp', () => ({
  executeSafeOutboundHttp: jest.fn(),
}));

jest.mock('@core/common/functions/withLock', () => ({
  withLock: jest.fn(
    async (_redis: unknown, _key: string, callback: () => Promise<unknown>) =>
      callback()
  ),
}));

import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';
import { OpenAIAssistantService } from '@core/services/openaiAssistant.service';
import { EAiAgentStatus } from '@core/common/enums/EAiAgentStatus';

const executeSafeOutboundHttpMock = jest.mocked(executeSafeOutboundHttp);

const createService = (
  redis: object = {},
  aiAgentService: object = {}
): OpenAIAssistantService =>
  new OpenAIAssistantService(
    redis as unknown as Redis,
    aiAgentService as unknown as AiAgentService
  );

const responseResult = (
  statusCode: number,
  body?: unknown,
  finalUrl = 'https://api.openai.com/v1/test'
) =>
  ({
    kind: 'response',
    statusCode,
    headers: {},
    body:
      body === undefined
        ? Buffer.alloc(0)
        : Buffer.from(JSON.stringify(body), 'utf8'),
    finalUrl,
    redirectCount: 0,
    durationMs: 1,
  }) as const;

const completedResponse = (text = 'Resposta') =>
  responseResult(200, {
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    ],
  });

describe('OpenAIAssistantService safe outbound contract', () => {
  const originalAppEnvironment = process.env.APP_ENVIRONMENT;

  beforeEach(() => {
    process.env.APP_ENVIRONMENT = 'prod';
    executeSafeOutboundHttpMock.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (originalAppEnvironment === undefined) {
      delete process.env.APP_ENVIRONMENT;
    } else {
      process.env.APP_ENVIRONMENT = originalAppEnvironment;
    }
  });

  it('sends Responses through the production-safe policy with idempotency', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(completedResponse());
    const service = createService();

    await service.createResponseWithFileSearch(
      'test-api-key',
      'https://api.openai.com/v1/',
      'gpt-5.6',
      'System instructions',
      'User question',
      'vs_test',
      undefined,
      'response-idempotency-key'
    );

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
    const request = executeSafeOutboundHttpMock.mock.calls[0]?.[0];
    const body = JSON.parse(String(request?.body)) as {
      store?: boolean;
      model?: string;
    };

    expect(request).toMatchObject({
      url: 'https://api.openai.com/v1/responses',
      method: 'POST',
      isProduction: true,
      allowLocalhostHttp: false,
      timeoutMs: 60000,
      sensitiveHeaderNames: ['authorization', 'openai-beta'],
    });
    expect(request?.headers?.Authorization).toBe('Bearer test-api-key');
    expect(request?.headers?.['Idempotency-Key']).toBe(
      'response-idempotency-key'
    );
    expect(request?.headers?.['OpenAI-Beta']).toBeUndefined();
    expect(body.store).toBe(false);
    expect(body.model).toBe('gpt-5.6');
  });

  it('does not retry a Responses mutation without an idempotency key', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(responseResult(503, {}));
    const service = createService();

    await expect(
      service.createResponseWithFileSearch(
        'test-api-key',
        'https://api.openai.com/v1',
        'gpt-5.6',
        'System instructions',
        'User question',
        'vs_test'
      )
    ).rejects.toThrow('status 503');

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
    expect(
      executeSafeOutboundHttpMock.mock.calls[0]?.[0].headers?.[
        'Idempotency-Key'
      ]
    ).toBeUndefined();
  });

  it('retries retryable Responses statuses only with idempotency', async () => {
    executeSafeOutboundHttpMock
      .mockResolvedValueOnce(responseResult(503, {}))
      .mockResolvedValueOnce(completedResponse('retry-ok'));
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });
    const service = createService();

    await expect(
      service.createResponseWithFileSearch(
        'test-api-key',
        'https://api.openai.com/v1',
        'gpt-5.6',
        'System instructions',
        'User question',
        'vs_test',
        undefined,
        'stable-request-id'
      )
    ).resolves.toMatchObject({ text: 'retry-ok' });

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(2);
  });

  it('concatenates every assistant output_text in response order', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      responseResult(200, {
        status: 'completed',
        output: [
          {
            type: 'reasoning',
            content: [{ type: 'output_text', text: 'Ignore reasoning' }],
          },
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: '  Primeira parte  ' },
              { type: 'refusal', text: 'Ignore refusal' },
              { type: 'output_text', text: 'Segunda parte' },
            ],
          },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'output_text', text: 'Ignore user output' }],
          },
          {
            type: 'message',
            role: 'assistant',
            content: [
              { type: 'output_text', text: 'Terceira parte' },
              { type: 'output_text', text: '   ' },
            ],
          },
        ],
      })
    );
    const service = createService();

    const result = await service.createResponseWithFileSearch(
      'test-api-key',
      'https://api.openai.com/v1',
      'gpt-5.6',
      'System instructions',
      'User question',
      'vs_test'
    );

    expect(result.text).toBe('Primeira parte\nSegunda parte\nTerceira parte');
  });

  it.each([
    ['failed', undefined, 'failed'],
    ['incomplete', 'max_output_tokens', 'max_output_tokens'],
    ['in_progress', undefined, 'in_progress'],
    ['cancelled', undefined, 'cancelled'],
  ])(
    'rejects a Responses result with status %s',
    async (status, incompleteReason, expectedReason) => {
      executeSafeOutboundHttpMock.mockResolvedValue(
        responseResult(200, {
          status,
          incomplete_details: incompleteReason
            ? { reason: incompleteReason }
            : null,
          output: [
            {
              type: 'message',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: 'Text must not be accepted',
                },
              ],
            },
          ],
        })
      );
      const service = createService();

      await expect(
        service.createResponseWithFileSearch(
          'test-api-key',
          'https://api.openai.com/v1',
          'gpt-5.6',
          'System instructions',
          'User question',
          'vs_test'
        )
      ).rejects.toThrow(
        `OpenAI Responses API did not complete: ${expectedReason}.`
      );
    }
  );

  it('does not expose transport details or credentials in failures', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue({
      kind: 'failure',
      code: 'dns_blocked_address',
      message: 'secret-key internal-host sensitive-response',
      retryable: false,
      isTimeout: false,
      durationMs: 1,
    });
    const service = createService();
    const request = service.createResponseWithFileSearch(
      'secret-key',
      'https://internal-host/v1',
      'gpt-5.6',
      'System instructions',
      'User question',
      'vs_test'
    );

    await expect(request).rejects.toThrow(
      'OpenAI API request failed (create response).'
    );
    await expect(request).rejects.not.toThrow(
      /secret-key|internal-host|sensitive-response/
    );
  });

  it('treats vector-store deletion 404 as idempotent success', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(responseResult(404, {}));
    const service = createService();

    await expect(
      service.deleteVectorStore(
        'test-api-key',
        'https://api.openai.com/v1/',
        'vs/id'
      )
    ).resolves.toBeUndefined();

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.openai.com/v1/vector_stores/vs%2Fid',
        method: 'DELETE',
      })
    );
  });

  it('uploads files as bounded multipart data through the safe transport', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      responseResult(200, { id: 'file-new' })
    );
    const service = createService();

    await expect(
      service.uploadFileToOpenAI(
        'test-api-key',
        'https://api.openai.com/v1',
        Buffer.from('document-content'),
        'document\r\n".txt'
      )
    ).resolves.toBe('file-new');

    const request = executeSafeOutboundHttpMock.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      url: 'https://api.openai.com/v1/files',
      method: 'POST',
    });
    expect(Buffer.isBuffer(request?.body)).toBe(true);
    expect(String(request?.headers?.['Content-Type'])).toMatch(
      /^multipart\/form-data; boundary=----underchat-/u
    );
    const multipartBody = (request?.body as Buffer).toString('utf8');
    expect(multipartBody).toContain('document-content');
    expect(multipartBody).not.toContain('\r\n".txt');
  });

  it('rolls back a newly created vector store when persistence is rejected', async () => {
    executeSafeOutboundHttpMock
      .mockResolvedValueOnce(responseResult(200, { id: 'vs-new' }))
      .mockResolvedValueOnce(responseResult(204));
    const aiAgentService = {
      viewAiAgent: jest.fn(async () => null),
      updateAiAgentOpenAIIds: jest.fn(async () => false),
    };
    const service = createService({}, aiAgentService);

    await expect(
      service.ensureVectorStore(
        'agent-1',
        'account-1',
        'test-api-key',
        'https://api.openai.com/v1'
      )
    ).rejects.toThrow('Failed to persist the OpenAI vector store reference.');

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(2);
    expect(executeSafeOutboundHttpMock.mock.calls[1]?.[0]).toMatchObject({
      url: 'https://api.openai.com/v1/vector_stores/vs-new',
      method: 'DELETE',
    });
  });

  it('keeps persistence and rollback failure observable without leaking data', async () => {
    executeSafeOutboundHttpMock
      .mockResolvedValueOnce(responseResult(200, { id: 'vs-new' }))
      .mockResolvedValue(
        responseResult(500, {
          error: 'test-api-key provider-secret',
        })
      );
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const aiAgentService = {
      viewAiAgent: jest.fn(async () => null),
      updateAiAgentOpenAIIds: jest.fn(async () => false),
    };
    const service = createService({}, aiAgentService);
    const result = service.ensureVectorStore(
      'agent-1',
      'account-1',
      'test-api-key',
      'https://api.openai.com/v1'
    );

    await expect(result).rejects.toThrow(
      'Failed to persist and roll back the OpenAI vector store reference.'
    );
    await expect(result).rejects.not.toThrow(/test-api-key|provider-secret/);
    expect(consoleError).toHaveBeenCalledWith(
      '[OpenAIAssistantService] vector store rollback failed after persistence rejection'
    );
  });

  it('propagates vector-store cleanup failures instead of reporting success', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(responseResult(503, {}));
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });
    const service = createService();

    await expect(
      service.removeFileFromVectorStore(
        'test-api-key',
        'https://api.openai.com/v1',
        'vs-current',
        'file-1'
      )
    ).rejects.toThrow('status 503');
  });

  it('keeps a pending cleanup while the active prompt still references the file', async () => {
    const redis = {
      hgetall: jest.fn(async () => ({
        'file-old': JSON.stringify({
          aiAgentPromptId: 'prompt-1',
          vectorStoreId: 'vs-current',
          fileId: 'file-old',
        }),
      })),
      hdel: jest.fn(async () => 1),
    };
    const aiAgentService = {
      viewAiAgentPrompt: jest.fn(async () => ({
        status: EAiAgentStatus.active,
        openai_file_id: 'file-old',
      })),
    };
    const service = createService(redis, aiAgentService);

    await service.cleanupPendingOpenAIFiles(
      'test-api-key',
      'https://api.openai.com/v1',
      'account-1',
      'agent-1'
    );

    expect(executeSafeOutboundHttpMock).not.toHaveBeenCalled();
    expect(redis.hdel).not.toHaveBeenCalled();
  });

  it('removes a pending file only after the prompt reference moved forward', async () => {
    const redis = {
      hgetall: jest.fn(async () => ({
        'file-old': JSON.stringify({
          aiAgentPromptId: 'prompt-1',
          vectorStoreId: 'vs-current',
          fileId: 'file-old',
        }),
      })),
      hdel: jest.fn(async () => 1),
    };
    const aiAgentService = {
      viewAiAgentPrompt: jest.fn(async () => ({
        status: EAiAgentStatus.active,
        openai_file_id: 'file-new',
      })),
    };
    executeSafeOutboundHttpMock.mockResolvedValue(responseResult(204));
    const service = createService(redis, aiAgentService);

    await service.cleanupPendingOpenAIFiles(
      'test-api-key',
      'https://api.openai.com/v1',
      'account-1',
      'agent-1'
    );

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(2);
    expect(redis.hdel).toHaveBeenCalledWith(
      'openai:pending-file-cleanup:account-1:agent-1',
      'file-old'
    );
  });
});
