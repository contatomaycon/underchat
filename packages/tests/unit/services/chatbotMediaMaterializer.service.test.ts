import 'reflect-metadata';
import * as safeHttp from '@core/common/functions/safeOutboundHttp';
import {
  ChatbotMediaMaterializationError,
  ChatbotMediaMaterializerService,
} from '@core/services/chatbotMediaMaterializer.service';

describe('ChatbotMediaMaterializerService', () => {
  const uploadTemporaryChatbotApiFile = jest.fn(
    async (
      buffer: Buffer,
      _accountId: string,
      options?: { mimetype?: string }
    ) => ({
      url: 'https://storage.example/chatbot-api-temporary/file.pdf',
      name: 'file.pdf',
      extension: 'pdf',
      size: buffer.byteLength,
      mimetype: options?.mimetype || 'application/pdf',
      width: null,
      height: null,
      expires_at: '2026-07-19T12:00:00.000Z',
    })
  );
  const service = new ChatbotMediaMaterializerService({
    uploadTemporaryChatbotApiFile,
  } as never);
  const options = {
    accountId: 'account-1',
    kind: 'document' as const,
    isProduction: true,
    allowLocalhostHttp: false,
  };

  beforeEach(() => uploadTemporaryChatbotApiFile.mockClear());
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['buffer', Buffer.from('%PDF-test')],
    [
      'data URI',
      `data:application/pdf;base64,${Buffer.from('%PDF-test').toString('base64')}`,
    ],
    [
      'base64 descriptor',
      {
        base64: Buffer.from('%PDF-test').toString('base64'),
        contentType: 'application/pdf',
      },
    ],
    [
      'Node buffer descriptor',
      { type: 'Buffer', data: [...Buffer.from('%PDF-test')] },
    ],
  ])(
    'materializes a %s variable into temporary storage',
    async (_label, value) => {
      const result = await service.materialize(value, options);
      expect(result.url).toContain('chatbot-api-temporary');
      expect(result.sizeBytes).toBeGreaterThan(0);
      expect(uploadTemporaryChatbotApiFile).toHaveBeenCalledTimes(1);
    }
  );

  it('downloads external URLs only through the safe outbound client', async () => {
    jest.spyOn(safeHttp, 'executeSafeOutboundHttp').mockResolvedValue({
      kind: 'response',
      statusCode: 200,
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from('%PDF-url'),
      finalUrl: 'https://files.example/report.pdf',
      redirectCount: 0,
      durationMs: 5,
    });
    await service.materialize('https://files.example/report.pdf', options);
    expect(safeHttp.executeSafeOutboundHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://files.example/report.pdf',
        responseLimitBytes: 16 * 1024 * 1024,
      })
    );
  });

  it('rejects MIME that does not match the selected message kind', async () => {
    await expect(
      service.materialize(Buffer.from('%PDF-test'), {
        ...options,
        kind: 'image',
      })
    ).rejects.toBeInstanceOf(ChatbotMediaMaterializationError);
  });

  it('rejects media larger than 16 MiB before upload', async () => {
    await expect(
      service.materialize(Buffer.alloc(16 * 1024 * 1024 + 1), options)
    ).rejects.toMatchObject({ code: 'media_too_large' });
  });
});
