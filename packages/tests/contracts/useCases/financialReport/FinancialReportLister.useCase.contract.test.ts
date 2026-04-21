import 'reflect-metadata';
jest.mock('@core/services/financialReport.service', () => ({
  FinancialReportService: class {},
}));
import { FinancialReportListerUseCase } from '@core/useCases/financialReport/FinancialReportLister.useCase';

describe('FinancialReportListerUseCase', () => {
  it('delegates listing to financial report service with query', async () => {
    const query = { from: '2026-01-01', to: '2026-01-31' } as never;
    const result = {
      pagings: {
        current_page: 1,
        per_page: 10,
        total_pages: 1,
        count: 1,
        total: 1,
      },
      results: [{ id: 'fr-1' }],
    };
    const service = {
      listFinancialReport: jest.fn(async () => result),
    };
    const useCase = new FinancialReportListerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, query)).resolves.toEqual(
      result
    );
    expect(service.listFinancialReport).toHaveBeenCalledWith(query);
  });

  it('propagates service errors', async () => {
    const serviceError = new Error('report failed');
    const service = {
      listFinancialReport: jest.fn(async () => {
        throw serviceError;
      }),
    };
    const useCase = new FinancialReportListerUseCase(service as never);

    await expect(useCase.execute(jest.fn() as never, {} as never)).rejects.toBe(
      serviceError
    );
  });
});
