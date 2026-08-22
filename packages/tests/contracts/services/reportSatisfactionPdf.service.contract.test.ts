import 'reflect-metadata';

jest.mock('@core/services/reportSatisfactionPdf/ReportSatisfactionPdfRenderer', () => ({
  drawSatisfactionReport: jest.fn(),
}));

jest.mock('pdfkit', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import PDFDocument from 'pdfkit';
import { drawSatisfactionReport } from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfRenderer';
import { ReportSatisfactionPdfService } from '@core/services/reportSatisfactionPdf.service';

class FakePDFDocument {
  public y: number;
  public autoData: Buffer | null = null;
  public autoError: Error | null = null;
  private handlers: Record<string, (...args: any[]) => void> = {};

  constructor(initialY: number = 0) {
    this.y = initialY;
  }

  on(event: string, callback: (...args: any[]) => void): this {
    this.handlers[event] = callback;
    return this;
  }

  addPage(): this {
    this.y = 0;
    return this;
  }

  end(): void {
    if (this.autoError) {
      this.handlers.error?.(this.autoError);
      return;
    }

    if (this.autoData) {
      this.handlers.data?.(this.autoData);
    }

    this.handlers.end?.();
  }

  emitData(chunk: Buffer): void {
    this.handlers.data?.(chunk);
  }

  emitError(error: Error): void {
    this.handlers.error?.(error);
  }
}

describe('ReportSatisfactionPdfService', () => {
  const service = new ReportSatisfactionPdfService();

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('generates the report through the composed renderer', async () => {
    const doc = new FakePDFDocument();
    const dataChunk = Buffer.from('pdf-bytes');
    doc.autoData = dataChunk;
    (PDFDocument as unknown as jest.Mock).mockImplementation(() => doc);

    const outputPromise = service.generatePdf(
      ((key: string) => key) as never,
      { score_average: 5, total: 1 } as never,
      [{ score: 5 }] as never,
      'general' as never,
      'daily' as never,
      '2026-01-01',
      '2026-01-31'
    );

    await expect(outputPromise).resolves.toEqual(dataChunk);
    expect(drawSatisfactionReport).toHaveBeenCalledWith(
      doc,
      expect.any(Function),
      { score_average: 5, total: 1 },
      [{ score: 5 }],
      'general',
      'daily',
      '2026-01-01',
      '2026-01-31'
    );
  });

  it('rejects with normalized Error when constructor throws non-error', async () => {
    (PDFDocument as unknown as jest.Mock).mockImplementation(() => {
      throw 'constructor-fail';
    });

    await expect(
      service.generatePdf(
        ((key: string) => key) as never,
        { score_average: 0, total: 0 } as never,
        [] as never,
        'general' as never,
        'daily' as never,
        '2026-01-01',
        '2026-01-31'
      )
    ).rejects.toThrow('constructor-fail');
  });

  it('rejects with same Error instance when constructor throws Error', async () => {
    const originalError = new Error('constructor-error-instance');
    (PDFDocument as unknown as jest.Mock).mockImplementation(() => {
      throw originalError;
    });

    await expect(
      service.generatePdf(
        ((key: string) => key) as never,
        { score_average: 0, total: 0 } as never,
        [] as never,
        'general' as never,
        'daily' as never,
        '2026-01-01',
        '2026-01-31'
      )
    ).rejects.toBe(originalError);
  });

  it('rejects when pdf document emits error event', async () => {
    const doc = new FakePDFDocument();
    doc.autoError = new Error('stream-fail');
    (PDFDocument as unknown as jest.Mock).mockImplementation(() => doc);

    const outputPromise = service.generatePdf(
      ((key: string) => key) as never,
      { score_average: 1, total: 1 } as never,
      [] as never,
      'general' as never,
      'daily' as never,
      '2026-01-01',
      '2026-01-31'
    );

    await expect(outputPromise).rejects.toThrow('stream-fail');
  });
});
