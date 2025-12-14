import { injectable } from 'tsyringe';
import { listReportConversationHistory } from './methods/listReportConversationHistory';
import { listReportConversationHistoryMessages } from './methods/listReportConversationHistoryMessages';
import { listReportConversationHistorySectors } from './methods/listReportConversationHistorySectors';
import { listReportConversationHistoryUsers } from './methods/listReportConversationHistoryUsers';
import { viewContact } from './methods/viewContact';
import { viewContactEmail } from './methods/viewContactEmail';
import { viewContactPhone } from './methods/viewContactPhone';
import { generateReportConversationHistoryPdf } from './methods/generateReportConversationHistoryPdf';
import { viewReportConversationHistoryPdf } from './methods/viewReportConversationHistoryPdf';
import { downloadReportConversationHistoryPdf } from './methods/downloadReportConversationHistoryPdf';
import { deleteReportConversationHistoryPdf } from './methods/deleteReportConversationHistoryPdf';

@injectable()
class ReportConversationHistoryController {
  public listReportConversationHistory = listReportConversationHistory;
  public listReportConversationHistoryMessages =
    listReportConversationHistoryMessages;
  public listReportConversationHistorySectors =
    listReportConversationHistorySectors;
  public listReportConversationHistoryUsers =
    listReportConversationHistoryUsers;
  public viewContact = viewContact;
  public viewContactEmail = viewContactEmail;
  public viewContactPhone = viewContactPhone;
  public generateReportConversationHistoryPdf =
    generateReportConversationHistoryPdf;
  public viewReportConversationHistoryPdf = viewReportConversationHistoryPdf;
  public downloadReportConversationHistoryPdf =
    downloadReportConversationHistoryPdf;
  public deleteReportConversationHistoryPdf =
    deleteReportConversationHistoryPdf;
}

export default ReportConversationHistoryController;
