import { injectable, inject } from 'tsyringe';
import { FinancialReportListerRepository } from '@core/repositories/financialReport/FinancialReportLister.repository';
import { ListFinancialReportRequest } from '@core/schema/financialReport/listFinancialReport/request.schema';
import { ListFinancialReportResponse } from '@core/schema/financialReport/listFinancialReport/response.schema';

@injectable()
export class FinancialReportService {
  constructor(
    @inject(FinancialReportListerRepository)
    private readonly financialReportListerRepository: FinancialReportListerRepository
  ) {}

  listFinancialReport = async (
    query: ListFinancialReportRequest
  ): Promise<ListFinancialReportResponse> => {
    return this.financialReportListerRepository.listFinancialReport(query);
  };
}
