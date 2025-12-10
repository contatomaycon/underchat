import { injectable } from 'tsyringe';
import { listReportConversationHistory } from './methods/listReportConversationHistory';

@injectable()
class ReportConversationHistoryController {
  public listReportConversationHistory = listReportConversationHistory;
}

export default ReportConversationHistoryController;
