import { injectable } from 'tsyringe';
import { listReportConversationHistory } from './methods/listReportConversationHistory';
import { listReportConversationHistoryMessages } from './methods/listReportConversationHistoryMessages';

@injectable()
class ReportConversationHistoryController {
  public listReportConversationHistory = listReportConversationHistory;
  public listReportConversationHistoryMessages =
    listReportConversationHistoryMessages;
}

export default ReportConversationHistoryController;
