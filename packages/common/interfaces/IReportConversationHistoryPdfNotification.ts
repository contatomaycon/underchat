import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';

export interface IReportConversationHistoryPdfNotification {
  chat_id: string;
  pdf_id: string;
  status: EReportConversationHistoryPdfStatus;
  url_pdf?: string | null;
}
