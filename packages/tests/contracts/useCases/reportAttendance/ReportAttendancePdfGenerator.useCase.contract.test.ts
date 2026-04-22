import 'reflect-metadata';

jest.mock(
  '@core/useCases/reportAttendance/ReportAttendanceLister.useCase',
  () => ({
    ReportAttendanceListerUseCase: class {},
  })
);
jest.mock('@core/services/reportAttendancePdf.service', () => ({
  ReportAttendancePdfService: class {},
}));

import { ReportAttendancePdfGeneratorUseCase } from '@core/useCases/reportAttendance/ReportAttendancePdfGenerator.useCase';

describe('ReportAttendancePdfGeneratorUseCase', () => {
  it('generates pdf using lister response and query filters', async () => {
    const listerResponse = {
      results: [{ period: '01/2026', total: 5 }],
    };
    const reportAttendanceListerUseCase = {
      execute: jest.fn(async () => listerResponse),
    };
    const pdfBuffer = Buffer.from('pdf');
    const reportAttendancePdfService = {
      generatePdf: jest.fn(async () => pdfBuffer),
    };
    const useCase = new ReportAttendancePdfGeneratorUseCase(
      reportAttendanceListerUseCase as never,
      reportAttendancePdfService as never
    );
    const t = jest.fn((key: string) => key);
    const query = {
      report_type: 'queue',
      period: 'day',
      start_date: '2026-01-01',
      end_date: '2026-01-31',
    };

    await expect(
      useCase.execute(t as never, 'acc-1', query as never)
    ).resolves.toBe(pdfBuffer);
    expect(reportAttendanceListerUseCase.execute).toHaveBeenCalledWith(
      'acc-1',
      query
    );
    expect(reportAttendancePdfService.generatePdf).toHaveBeenCalledWith(
      t,
      listerResponse.results,
      query.report_type,
      query.period,
      query.start_date,
      query.end_date
    );
  });
});
