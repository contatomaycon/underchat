import 'reflect-metadata';
import { FinancialReportService } from '@core/services/financialReport.service';

describe('FinancialReportService', () => {
  it('delegates listFinancialReport to repository', async () => {
    const listFinancialReport = jest.fn(async () => ({ data: [], total: 0 }));
    const service = new FinancialReportService({
      listFinancialReport,
    } as never);

    await expect(service.listFinancialReport({} as never)).resolves.toEqual({
      data: [],
      total: 0,
    });
    expect(listFinancialReport).toHaveBeenCalledWith({});
  });
});
