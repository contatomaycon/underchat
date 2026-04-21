import 'reflect-metadata';

const mockMammothExtractRawText = jest.fn();
const mockPdfGetText = jest.fn();
const mockPdfDestroy = jest.fn();
const PDFParseMock = jest.fn().mockImplementation(() => ({
  getText: mockPdfGetText,
  destroy: mockPdfDestroy,
}));
const mockWordExtract = jest.fn();
const WordExtractorMock = jest.fn().mockImplementation(() => ({
  extract: mockWordExtract,
}));

jest.mock('mammoth', () => ({
  __esModule: true,
  default: {
    extractRawText: mockMammothExtractRawText,
  },
}));

jest.mock('pdf-parse', () => ({
  PDFParse: PDFParseMock,
}));

jest.mock('word-extractor', () => ({
  __esModule: true,
  default: WordExtractorMock,
}));

import { PromptDocumentExtractorService } from '@core/services/promptDocumentExtractor.service';

describe('PromptDocumentExtractorService', () => {
  const originalFetch = global.fetch;

  const makeResponse = (input: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    body: Uint8Array;
  }) => ({
    ok: input.ok ?? true,
    status: input.status ?? 200,
    headers: {
      get: (key: string) =>
        key.toLowerCase() === 'content-type'
          ? (input.contentType ?? null)
          : null,
    },
    arrayBuffer: async () => input.body.buffer.slice(0),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn() as never;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extracts markdown/csv/json as text sources with normalized content-type', async () => {
    const service = new PromptDocumentExtractorService();

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType: 'text/markdown; charset=utf-8',
        body: new TextEncoder().encode('  # Hello  '),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.md')
    ).resolves.toEqual({
      text: '# Hello',
      contentType: 'text/markdown',
      source: 'markdown',
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType: 'text/csv',
        body: new TextEncoder().encode('a,b'),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.csv')
    ).resolves.toEqual({
      text: 'a,b',
      contentType: 'text/csv',
      source: 'csv',
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType: 'application/octet-stream',
        body: new TextEncoder().encode('{"name":"Ana"}'),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.json')
    ).resolves.toEqual({
      text: '{\n  "name": "Ana"\n}',
      contentType: 'application/octet-stream',
      source: 'json',
    });
  });

  it('extracts pdf/docx/doc through dedicated parsers', async () => {
    const service = new PromptDocumentExtractorService();

    mockPdfGetText.mockResolvedValueOnce({ text: '  pdf content  ' });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType: 'application/pdf',
        body: new Uint8Array([1, 2, 3]),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.pdf')
    ).resolves.toEqual({
      text: 'pdf content',
      contentType: 'application/pdf',
      source: 'pdf',
    });
    expect(PDFParseMock).toHaveBeenCalled();
    expect(mockPdfDestroy).toHaveBeenCalledTimes(1);

    mockMammothExtractRawText.mockResolvedValueOnce({
      value: '  docx content  ',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        body: new Uint8Array([4, 5, 6]),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.docx')
    ).resolves.toEqual({
      text: 'docx content',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      source: 'docx',
    });

    mockWordExtract.mockResolvedValueOnce({
      getBody: () => '  doc content  ',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType: 'application/msword',
        body: new Uint8Array([7, 8, 9]),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.doc')
    ).resolves.toEqual({
      text: 'doc content',
      contentType: 'application/msword',
      source: 'doc',
    });
    expect(WordExtractorMock).toHaveBeenCalled();
  });

  it('supports fallback extraction, unsupported type errors and non-200 download status', async () => {
    const service = new PromptDocumentExtractorService();

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType: 'application/octet-stream',
        body: new TextEncoder().encode('fallback plain text'),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.bin', {
        allowLegacyOfficeFormats: false,
      })
    ).resolves.toEqual({
      text: 'fallback plain text',
      contentType: 'application/octet-stream',
      source: 'fallback',
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        contentType: 'application/octet-stream',
        body: new Uint8Array([0, 0, 0, 0, 1, 2, 3, 4]),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/file.unknown')
    ).rejects.toThrow('Tipo de arquivo não suportado');

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 404,
        body: new Uint8Array([]),
      })
    );

    await expect(
      service.extractTextFromUrl('https://example.com/missing.txt')
    ).rejects.toThrow('Falha ao baixar arquivo: 404');
  });

  it('covers helper branches for extension parsing and text probability checks', () => {
    const service = new PromptDocumentExtractorService();

    expect((service as any).normalizeContentType(null)).toBeNull();
    expect(
      (service as any).normalizeContentType(' TEXT/PLAIN ; charset=utf-8 ')
    ).toBe('text/plain');

    expect(
      (service as any).getExtensionFromUrl('https://example.com/a.docx')
    ).toBe('.docx');
    expect(
      (service as any).getExtensionFromUrl('https://example.com/noext')
    ).toBeNull();
    expect((service as any).getExtensionFromUrl('not a valid url')).toBeNull();

    expect((service as any).resolveTextSource('text/plain', null)).toBe('text');
    expect((service as any).resolveTextSource(null, '.tsv')).toBe('csv');

    expect((service as any).isProbablyText('')).toBe(false);
    expect((service as any).isProbablyText('normal readable string')).toBe(
      true
    );

    const binaryString = String.fromCharCode(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    expect((service as any).isProbablyText(binaryString)).toBe(false);
  });

  it('extractTextFromPdf always destroys parser even when getText fails', async () => {
    const service = new PromptDocumentExtractorService();

    mockPdfGetText.mockRejectedValueOnce(new Error('pdf-failure'));

    await expect(
      (service as any).extractTextFromPdf(new Uint8Array([1, 2]).buffer)
    ).rejects.toThrow('pdf-failure');

    expect(mockPdfDestroy).toHaveBeenCalledTimes(1);
  });
});
