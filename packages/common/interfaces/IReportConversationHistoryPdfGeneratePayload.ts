export interface IReportConversationHistoryPdfGeneratePayload {
  account_id: string;
  chat_id: string;
  pdf_record_id: string;
  requested_at: string;
  old_url_pdf?: string | null;
}
