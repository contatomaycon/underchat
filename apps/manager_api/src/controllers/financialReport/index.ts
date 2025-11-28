import { injectable } from 'tsyringe';
import { listFinancialReport } from './methods/listFinancialReport';

@injectable()
class FinancialReportController {
  public listFinancialReport = listFinancialReport;
}

export default FinancialReportController;
