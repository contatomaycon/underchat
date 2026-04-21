import 'reflect-metadata';
import { OpenAISummaryProvider } from '@core/services/summary/openAiSummaryProvider.service';

describe('OpenAISummaryProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uses max_completion_tokens for gpt-5 models', async () => {
    const fetchMock = jest.fn<any, any>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    }));
    global.fetch = fetchMock as never;

    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.openai.com/v1',
        'k',
        'gpt-5-mini'
      )
    ).resolves.toBe('ok');

    const firstCallOptions = (fetchMock.mock.calls as any[][])[0]?.[1] as {
      body: string;
    };
    const body = JSON.parse(firstCallOptions.body);
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_tokens).toBeUndefined();
  });

  it('retries with fallback token parameter when unsupported_parameter is returned', async () => {
    const fetchMock = jest
      .fn<any, any>()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: { code: 'unsupported_parameter', param: 'max_tokens' },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'retry-ok' } }] }),
      });

    global.fetch = fetchMock as never;

    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.openai.com/v1',
        'k',
        'gpt-4o-mini'
      )
    ).resolves.toBe('retry-ok');

    const secondCallOptions = (fetchMock.mock.calls as any[][])[1]?.[1] as {
      body: string;
    };
    const secondBody = JSON.parse(secondCallOptions.body);
    expect(secondBody.max_completion_tokens).toBe(2048);
    expect(secondBody.max_tokens).toBeUndefined();
  });

  it('applies temperature fallback to 1 for unsupported_value', async () => {
    const fetchMock = jest
      .fn<any, any>()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({
            error: {
              code: 'unsupported_value',
              param: 'temperature',
              message: 'use default (1)',
            },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'ok-temp' } }] }),
      });

    global.fetch = fetchMock as never;

    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.openai.com/v1',
        'k',
        'gpt-4o-mini'
      )
    ).resolves.toBe('ok-temp');

    const secondCallOptions = (fetchMock.mock.calls as any[][])[1]?.[1] as {
      body: string;
    };
    const secondBody = JSON.parse(secondCallOptions.body);
    expect(secondBody.temperature).toBe(1);
  });

  it('throws when no fallback is available', async () => {
    const fetchMock = jest.fn<any, any>(async () => ({
      ok: false,
      status: 500,
      text: async () => 'fatal',
    }));
    global.fetch = fetchMock as never;

    const service = new OpenAISummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.openai.com/v1',
        'k',
        'gpt-4o-mini'
      )
    ).rejects.toThrow('OpenAI API error: 500 - fatal');
  });
});
