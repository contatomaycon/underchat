import { injectable } from 'tsyringe';
import { listReportConversationHistory } from './methods/listReportConversationHistory';
import { listReportConversationHistoryMessages } from './methods/listReportConversationHistoryMessages';
import { listReportConversationHistorySectors } from './methods/listReportConversationHistorySectors';
import { listReportConversationHistoryUsers } from './methods/listReportConversationHistoryUsers';

@injectable()
class ReportConversationHistoryController {
  public listReportConversationHistory = listReportConversationHistory;
  public listReportConversationHistoryMessages =
    listReportConversationHistoryMessages;
  public listReportConversationHistorySectors =
    listReportConversationHistorySectors;
  public listReportConversationHistoryUsers =
    listReportConversationHistoryUsers;
}

export default ReportConversationHistoryController;
