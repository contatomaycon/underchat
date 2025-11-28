import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListFinancialReportRequest } from '@core/schema/financialReport/listFinancialReport/request.schema';
import { ListFinancialReportResponse } from '@core/schema/financialReport/listFinancialReport/response.schema';
import { FinancialReportService } from '@core/services/financialReport.service';

@injectable()
export class FinancialReportListerUseCase {
  constructor(
    private readonly financialReportService: FinancialReportService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    query: ListFinancialReportRequest
  ): Promise<ListFinancialReportResponse> {
    return this.financialReportService.listFinancialReport(query);
  }
}
