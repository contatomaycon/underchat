import { injectable } from 'tsyringe';
import { listReportSatisfaction } from './methods/listReportSatisfaction';
import { downloadReportSatisfactionPdf } from './methods/downloadReportSatisfactionPdf';

@injectable()
class ReportSatisfactionController {
  public listReportSatisfaction = listReportSatisfaction;
  public downloadReportSatisfactionPdf = downloadReportSatisfactionPdf;
}

export default ReportSatisfactionController;
