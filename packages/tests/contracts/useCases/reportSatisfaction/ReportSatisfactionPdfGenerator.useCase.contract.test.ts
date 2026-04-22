import 'reflect-metadata';

jest.mock(
  '@core/useCases/reportSatisfaction/ReportSatisfactionLister.useCase',
  () => ({
    ReportSatisfactionListerUseCase: class {},
  })
);
jest.mock('@core/services/reportSatisfactionPdf.service', () => ({
  ReportSatisfactionPdfService: class {},
}));

import { ReportSatisfactionPdfGeneratorUseCase } from '@core/useCases/reportSatisfaction/ReportSatisfactionPdfGenerator.useCase';

describe('ReportSatisfactionPdfGeneratorUseCase', () => {
  it('generates pdf with summary and results from lister', async () => {
    const listerResponse = {
      summary: { total_responses: 4, unique_satisfactions: 2 },
      results: [{ period: '01/2026', total: 4 }],
    };
    const reportSatisfactionListerUseCase = {
      execute: jest.fn(async () => listerResponse),
    };
    const pdfBuffer = Buffer.from('pdf');
    const reportSatisfactionPdfService = {
      generatePdf: jest.fn(async () => pdfBuffer),
    };
    const useCase = new ReportSatisfactionPdfGeneratorUseCase(
      reportSatisfactionListerUseCase as never,
      reportSatisfactionPdfService as never
    );
    const t = jest.fn((key: string) => key);
    const query = {
      report_type: 'general',
      period: 'day',
      start_date: '2026-01-01',
      end_date: '2026-01-31',
    };

    await expect(
      useCase.execute(t as never, 'acc-1', query as never)
    ).resolves.toBe(pdfBuffer);
    expect(reportSatisfactionListerUseCase.execute).toHaveBeenCalledWith(
      'acc-1',
      query
    );
    expect(reportSatisfactionPdfService.generatePdf).toHaveBeenCalledWith(
      t,
      listerResponse.summary,
      listerResponse.results,
      query.report_type,
      query.period,
      query.start_date,
      query.end_date
    );
  });
});
