import 'reflect-metadata';

jest.mock('@core/common/functions/safeOutboundHttp', () => ({
  executeSafeOutboundHttp: jest.fn(),
}));

import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';
import { GeminiSummaryProvider } from '@core/services/summary/geminiSummaryProvider.service';

const executeSafeOutboundHttpMock = jest.mocked(executeSafeOutboundHttp);

const responseResult = (statusCode: number, body: unknown) =>
  ({
    kind: 'response',
    statusCode,
    headers: {},
    body: Buffer.from(JSON.stringify(body), 'utf8'),
    finalUrl: 'https://api.test/v1beta/models/model:generateContent',
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

describe('GeminiSummaryProvider', () => {
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

  it('normalizes the endpoint and uses production-safe outbound policy', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      responseResult(200, {
        candidates: [
          {
            content: {
              parts: [{ text: 'Resumo' }, { text: 'final' }],
            },
          },
        ],
      })
    );
    const service = new GeminiSummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.test/proxy/v1betabeta/openai/?key=old-key#fragment',
        'api-key',
        '/models/models/gemini-2.5-flash'
      )
    ).resolves.toBe('Resumo\nfinal');

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
    const request = executeSafeOutboundHttpMock.mock.calls[0]?.[0];

    expect(request).toMatchObject({
      url: 'https://api.test/proxy/v1beta/models/gemini-2.5-flash:generateContent',
      method: 'POST',
      isProduction: true,
      allowLocalhostHttp: false,
      timeoutMs: 30000,
    });
    expect(request?.url).not.toContain('api-key');
    expect(request?.url).not.toContain('old-key');
    expect(request?.headers?.['x-goog-api-key']).toBe('api-key');
    expect(request?.headers?.Authorization).toBeUndefined();
  });

  it('retries an explicit 429 response', async () => {
    executeSafeOutboundHttpMock
      .mockResolvedValueOnce(responseResult(429, {}))
      .mockResolvedValueOnce(
        responseResult(200, {
          candidates: [{ content: { parts: [{ text: 'retry-ok' }] } }],
        })
      );
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((callback: () => void) => {
        callback();
        return 0 as never;
      });
    const service = new GeminiSummaryProvider();

    await expect(
      service.generateSummary('prompt', 'https://api.test', 'api-key', 'model')
    ).resolves.toBe('retry-ok');

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403])(
    'does not retry status %s and does not expose key, prompt, or response body',
    async (status) => {
      executeSafeOutboundHttpMock.mockResolvedValue(
        responseResult(status, {
          error: 'secret-key sensitive-prompt provider-details',
        })
      );
      const service = new GeminiSummaryProvider();
      const result = service.generateSummary(
        'sensitive-prompt',
        'https://api.test/v1',
        'secret-key',
        'model'
      );

      await expect(result).rejects.toThrow(
        `Gemini API request failed with status ${status}.`
      );
      await expect(result).rejects.not.toThrow(
        /secret-key|sensitive-prompt|provider-details/
      );
      expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
    }
  );

  it('rejects an empty provider response instead of returning a fallback', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue(
      responseResult(200, { candidates: [] })
    );
    const service = new GeminiSummaryProvider();

    await expect(
      service.generateSummary('prompt', 'https://api.test', 'api-key', 'model')
    ).rejects.toThrow('Gemini API returned an empty summary.');
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
    const service = new GeminiSummaryProvider();
    const result = service.generateSummary(
      'sensitive-prompt',
      'https://api.test',
      'secret-key',
      'model'
    );

    await expect(result).rejects.toThrow('Gemini API request timed out.');
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
    const service = new GeminiSummaryProvider();

    await expect(
      service.generateSummary(
        'sensitive-prompt',
        'https://api.test',
        'secret-key',
        'model'
      )
    ).rejects.toThrow('Gemini API request failed.');
    expect(executeSafeOutboundHttpMock).toHaveBeenCalledTimes(1);
  });
});
