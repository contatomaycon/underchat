import { injectable } from 'tsyringe';
import { FinancialReportListerRepository } from '@core/repositories/financial/FinancialReportLister.repository';
import { ListFinancialReportRequest } from '@core/schema/financial/listFinancialReport/request.schema';
import {
  FinancialReportAnnual,
  FinancialReportItem,
} from '@core/schema/financial/listFinancialReport/response.schema';

@injectable()
export class FinancialService {
  constructor(
    private readonly financialReportListerRepository: FinancialReportListerRepository
  ) {}

  getAnnualReport = async (
    query: ListFinancialReportRequest
  ): Promise<FinancialReportAnnual> => {
    return this.financialReportListerRepository.getAnnualReport(query);
  };

  getMonthlyReport = async (
    query: ListFinancialReportRequest
  ): Promise<FinancialReportItem[]> => {
    return this.financialReportListerRepository.getMonthlyReport(query);
  };

  getDailyReport = async (
    query: ListFinancialReportRequest
  ): Promise<FinancialReportItem[]> => {
    return this.financialReportListerRepository.getDailyReport(query);
  };
}
