import 'reflect-metadata';

jest.mock('@core/common/functions/safeOutboundHttp', () => ({
  executeSafeOutboundHttp: jest.fn(),
}));

import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';
import { OpenAISummaryProvider } from '@core/services/summary/openAiSummaryProvider.service';

const executeSafeOutboundHttpMock = jest.mocked(executeSafeOutboundHttp);

const responseResult = (statusCode: number, body: unknown) =>
  ({
    kind: 'response',
    statusCode,
    headers: {},
    body: Buffer.from(JSON.stringify(body), 'utf8'),
    finalUrl: 'https://api.openai.com/v1/chat/completions',
    redirectCount: 0,
    durationMs: 1,
  }) as const;

const failureResult = (input: {
  code: 'timeout' | 'network_error';
  retryable: boolean;
  isTimeout: boolean;
}) =>
  ({
    kind: 'failure',
    code: input.code,
    message: 'sanitized transport failure',
    retryable: input.retryable,
    isTimeout: input.isTimeout,
    durationMs: 1,
  }) as const;

describe('OpenAISummaryProvider', () => {
  const originalAppEnvironment = process.env.APP_ENVIRONMENT;

  beforeEach(() => {
    process.env.APP_ENVIRONMENT = 'prod';
    executeSafeOutboundHttpMock.mockReset();
  });

  afterAll(() => {
    if (originalAppEnvironment === undefined) {
      delete process.env.APP_ENVIRONMENT;
    } else {
      process.env.APP_ENVIRONMENT = originalAppEnvironment;
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses max_completion_tokens and the production-safe outbound policy', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      responseResult(200, {
        choices: [{ message: { content: 'ok' } }],
      })
    );
    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.openai.com/v1/',
        'k',
        'gpt-5-mini'
      )
    ).resolves.toBe('ok');

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
    const request = executeSafeOutboundHttpMock.mock.calls[0]?.[0];
    const body = JSON.parse(String(request?.body)) as {
      max_completion_tokens?: number;
      max_tokens?: number;
      temperature?: number;
    };

    expect(request).toMatchObject({
      url: 'https://api.openai.com/v1/chat/completions',
      method: 'POST',
      isProduction: true,
      allowLocalhostHttp: false,
      timeoutMs: 30000,
      sensitiveHeaderNames: ['authorization', 'x-goog-api-key'],
    });
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it('retries an explicit 429 response', async () => {
    executeSafeOutboundHttpMock
      .mockResolvedValueOnce(responseResult(429, {}))
      .mockResolvedValueOnce(
        responseResult(200, {
          choices: [{ message: { content: 'retry-ok' } }],
        })
      );
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });
    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.openai.com/v1',
        'k',
        'gpt-4o-mini'
      )
    ).resolves.toBe('retry-ok');

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403])(
    'does not retry status %s and does not expose key, prompt, or response body',
    async (status) => {
      executeSafeOutboundHttpMock.mockResolvedValue(
        responseResult(status, {
          error:
            'secret-key sensitive-prompt unsupported_parameter provider-details',
        })
      );
      const service = new OpenAISummaryProvider();
      const result = service.generateSummary(
        'sensitive-prompt',
        'https://api.openai.com/v1',
        'secret-key',
        'gpt-4o-mini'
      );

      await expect(result).rejects.toThrow(
        `OpenAI API request failed with status ${status}.`
      );
      await expect(result).rejects.not.toThrow(
        /secret-key|sensitive-prompt|provider-details/
      );
      expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects an empty provider response', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      responseResult(200, {
        choices: [{ message: { content: '   ' } }],
      })
    );
    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.openai.com/v1',
        'k',
        'gpt-4o-mini'
      )
    ).rejects.toThrow('OpenAI API returned an empty summary.');
  });

  it('retries 5xx responses and sanitizes the final error', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      responseResult(500, {
        error: 'secret-key sensitive-prompt fatal-provider-details',
      })
    );
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });
    const service = new OpenAISummaryProvider();
    const result = service.generateSummary(
      'sensitive-prompt',
      'https://api.openai.com/v1',
      'secret-key',
      'gpt-4o-mini'
    );

    await expect(result).rejects.toThrow(
      'OpenAI API request failed with status 500.'
    );
    await expect(result).rejects.not.toThrow(
      /secret-key|sensitive-prompt|fatal-provider-details/
    );
    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(3);
  });

  it('retries full-request timeouts and returns a sanitized error', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      failureResult({
        code: 'timeout',
        retryable: true,
        isTimeout: true,
      })
    );
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });
    const service = new OpenAISummaryProvider();
    const result = service.generateSummary(
      'sensitive-prompt',
      'https://api.openai.com/v1',
      'secret-key',
      'gpt-4o-mini'
    );

    await expect(result).rejects.toThrow('OpenAI API request timed out.');
    await expect(result).rejects.not.toThrow(/secret-key|sensitive-prompt/);
    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-timeout transport failures', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      failureResult({
        code: 'network_error',
        retryable: true,
        isTimeout: false,
      })
    );
    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'sensitive-prompt',
        'https://api.openai.com/v1',
        'secret-key',
        'gpt-4o-mini'
      )
    ).rejects.toThrow('OpenAI API request failed.');
    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
  });
});
