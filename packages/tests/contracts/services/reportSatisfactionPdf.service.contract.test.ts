import 'reflect-metadata';

jest.mock(
  '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfHeader',
  () => ({
    drawHeader: jest.fn(),
  })
);

jest.mock(
  '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfChartDrawer',
  () => ({
    drawChart: jest.fn(),
    drawStackedBarChartByEntity: jest.fn(),
  })
);

jest.mock(
  '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfTableRenderer',
  () => ({
    drawTable: jest.fn(),
  })
);

jest.mock('pdfkit', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import PDFDocument from 'pdfkit';
import { drawHeader } from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfHeader';
import {
  drawChart,
  drawStackedBarChartByEntity,
} from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfChartDrawer';
import { drawTable } from '@core/services/reportSatisfactionPdf/ReportSatisfactionPdfTableRenderer';
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

  it('generates pdf for generic report type using regular chart', async () => {
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
    expect(drawHeader).toHaveBeenCalled();
    expect(drawChart).toHaveBeenCalledWith(doc, expect.any(Function), [
      { score: 5 },
    ]);
    expect(drawStackedBarChartByEntity).not.toHaveBeenCalled();
    expect(drawTable).toHaveBeenCalled();
  });

  it('generates sector report with stacked chart and per-entity charts', async () => {
    const doc = new FakePDFDocument(600);
    const addPageSpy = jest.spyOn(doc, 'addPage');
    (PDFDocument as unknown as jest.Mock).mockImplementation(() => doc);

    const rows = [
      { sector: 'B', score: 2 },
      { sector: 'A', score: 5 },
      { sector: 'A', score: 3 },
      { sector: null, score: 1 },
    ] as never;

    const outputPromise = service.generatePdf(
      ((key: string) => key) as never,
      { score_average: 4, total: 4 } as never,
      rows,
      'sector' as never,
      'monthly' as never,
      '2026-01-01',
      '2026-01-31'
    );

    doc.end();
    await expect(outputPromise).resolves.toEqual(Buffer.alloc(0));

    expect(drawStackedBarChartByEntity).toHaveBeenCalledWith(
      doc,
      expect.any(Function),
      rows,
      'sector'
    );
    expect(drawChart).toHaveBeenCalledTimes(2);
    expect(drawChart).toHaveBeenNthCalledWith(
      1,
      doc,
      expect.any(Function),
      [
        { sector: 'A', score: 5 },
        { sector: 'A', score: 3 },
      ],
      'A'
    );
    expect(drawChart).toHaveBeenNthCalledWith(
      2,
      doc,
      expect.any(Function),
      [{ sector: 'B', score: 2 }],
      'B'
    );
    expect(addPageSpy).toHaveBeenCalled();
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

  it('generates analyst report and uses analyst key grouping', async () => {
    const doc = new FakePDFDocument();
    (PDFDocument as unknown as jest.Mock).mockImplementation(() => doc);

    const rows = [
      { analyst: 'Bruno', score: 3 },
      { analyst: 'Ana', score: 5 },
    ] as never;

    const outputPromise = service.generatePdf(
      ((key: string) => key) as never,
      { score_average: 4, total: 2 } as never,
      rows,
      'analyst' as never,
      'monthly' as never,
      '2026-01-01',
      '2026-01-31'
    );

    doc.end();
    await expect(outputPromise).resolves.toEqual(Buffer.alloc(0));

    expect(drawStackedBarChartByEntity).toHaveBeenCalledWith(
      doc,
      expect.any(Function),
      rows,
      'analyst'
    );
    expect(drawChart).toHaveBeenNthCalledWith(
      1,
      doc,
      expect.any(Function),
      [{ analyst: 'Ana', score: 5 }],
      'Ana'
    );
    expect(drawChart).toHaveBeenNthCalledWith(
      2,
      doc,
      expect.any(Function),
      [{ analyst: 'Bruno', score: 3 }],
      'Bruno'
    );
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
