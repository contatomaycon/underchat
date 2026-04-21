import 'reflect-metadata';
import { GeminiSummaryProvider } from '@core/services/summary/geminiSummaryProvider.service';

describe('GeminiSummaryProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('calls v1beta endpoint and returns generated text', async () => {
    const fetchMock = jest.fn<any, any>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Resumo final' }] } }],
      }),
    }));
    global.fetch = fetchMock as never;

    const service = new GeminiSummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.test/v1',
        'api-key',
        'gemini-pro'
      )
    ).resolves.toBe('Resumo final');

    const firstCallUrl = (fetchMock.mock.calls as any[][])[0]?.[0] as string;
    expect(firstCallUrl).toContain('/v1beta/models/gemini-pro:generateContent');
  });

  it('retries fetch failures and returns fallback message when text is missing', async () => {
    const fetchMock = jest
      .fn<any, any>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ candidates: [] }),
      });

    global.fetch = fetchMock as never;
    jest.spyOn(global, 'setTimeout').mockImplementation((fn: any) => {
      fn();
      return 0 as never;
    });

    const service = new GeminiSummaryProvider();

    await expect(
      service.generateSummary('prompt', 'https://api.test', 'api-key', 'model')
    ).resolves.toBe('Erro ao gerar sumário.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws with masked api key when response is not ok', async () => {
    const fetchMock = jest.fn<any, any>(async () => ({
      ok: false,
      status: 400,
      text: async () => 'invalid request',
    }));
    global.fetch = fetchMock as never;

    const service = new GeminiSummaryProvider();

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.test/v1',
        'secret-key',
        'model'
      )
    ).rejects.toThrow('Gemini API error: 400 - invalid request');

    await expect(
      service.generateSummary(
        'prompt',
        'https://api.test/v1',
        'secret-key',
        'model'
      )
    ).rejects.not.toThrow('secret-key');
  });
});
