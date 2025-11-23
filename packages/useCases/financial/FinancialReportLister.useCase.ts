import { TFunction } from 'i18next';
import { injectable } from 'tsyringe';
import { FinancialService } from '@core/services/financial.service';
import { ListFinancialReportRequest } from '@core/schema/financial/listFinancialReport/request.schema';
import { ListFinancialReportResponse } from '@core/schema/financial/listFinancialReport/response.schema';

@injectable()
export class FinancialReportListerUseCase {
  constructor(private readonly financialService: FinancialService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListFinancialReportRequest
  ): Promise<ListFinancialReportResponse> {
    if (query.view_type === 'annual') {
      return this.financialService.getAnnualReport(query);
    }

    if (query.view_type === 'monthly') {
      return this.financialService.getMonthlyReport(query);
    }

    return this.financialService.getDailyReport(query);
  }
}
