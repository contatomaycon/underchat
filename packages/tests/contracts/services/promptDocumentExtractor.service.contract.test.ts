import 'reflect-metadata';

jest.mock('@core/common/functions/safeOutboundHttp', () => ({
  SAFE_OUTBOUND_HTTP_MAX_RESPONSE_BYTES: 16 * 1024 * 1024,
  executeSafeOutboundHttp: jest.fn(),
}));

import { executeSafeOutboundHttp } from '@core/common/functions/safeOutboundHttp';
import { PromptDocumentExtractorService } from '@core/services/promptDocumentExtractor.service';

const executeSafeOutboundHttpMock = jest.mocked(executeSafeOutboundHttp);

describe('PromptDocumentExtractorService outbound contracts', () => {
  beforeEach(() => {
    executeSafeOutboundHttpMock.mockReset();
  });

  it('downloads prompt documents through the SSRF-safe bounded client', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue({
      kind: 'response',
      statusCode: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
      },
      body: Buffer.from('Base de conhecimento segura'),
      finalUrl: 'https://cdn.example.com/prompt.txt',
      redirectCount: 0,
      durationMs: 4,
    });
    const service = new PromptDocumentExtractorService();

    await expect(
      service.extractTextFromUrl('https://cdn.example.com/prompt.txt')
    ).resolves.toMatchObject({
      text: 'Base de conhecimento segura',
      contentType: 'text/plain',
      source: 'text',
      buffer: Buffer.from('Base de conhecimento segura'),
    });

    expect(executeSafeOutboundHttpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://cdn.example.com/prompt.txt',
        method: 'GET',
        timeoutMs: 20_000,
        responseLimitBytes: 16 * 1024 * 1024,
      })
    );
  });

  it('rejects a URL blocked by the outbound security policy', async () => {
    executeSafeOutboundHttpMock.mockResolvedValue({
      kind: 'failure',
      code: 'dns_blocked_address',
      message: 'blocked',
      retryable: false,
      isTimeout: false,
      durationMs: 1,
    });
    const service = new PromptDocumentExtractorService();

    await expect(
      service.extractTextFromUrl('https://127.0.0.1/internal')
    ).rejects.toThrow('dns_blocked_address');
  });
});
