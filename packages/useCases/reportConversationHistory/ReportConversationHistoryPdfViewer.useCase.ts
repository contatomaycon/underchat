import { injectable } from 'tsyringe';
import { ReportConversationHistoryPdfViewerRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfViewer.repository';
import { ViewReportConversationHistoryPdfResponse } from '@core/schema/reportConversationHistory/viewReportConversationHistoryPdf/response.schema';

@injectable()
export class ReportConversationHistoryPdfViewerUseCase {
  constructor(
    private readonly pdfViewerRepository: ReportConversationHistoryPdfViewerRepository
  ) {}

  async execute(
    accountId: string,
    chatId: string
  ): Promise<ViewReportConversationHistoryPdfResponse | null> {
    const pdf = await this.pdfViewerRepository.viewPdfByAccountAndChat(
      accountId,
      chatId
    );

    if (!pdf) {
      return null;
    }

    return {
      pdf_id: pdf.id,
      url_pdf: pdf.url_pdf,
      status: pdf.status,
      requested_at: pdf.requested_at,
      generated_at: pdf.generated_at,
    };
  }
}
