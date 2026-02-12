import { injectable, inject } from 'tsyringe';
import { ReportConversationHistoryPdfDeleterRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfDeleter.repository';
import { ReportConversationHistoryPdfViewerRepository } from '@core/repositories/reportConversationHistory/ReportConversationHistoryPdfViewer.repository';
import { ReportConversationHistoryPdfService } from '@core/services/reportConversationHistoryPdf.service';
import { DeleteReportConversationHistoryPdfResponse } from '@core/schema/reportConversationHistory/deleteReportConversationHistoryPdf/response.schema';

@injectable()
export class ReportConversationHistoryPdfDeleterUseCase {
  constructor(
    @inject(ReportConversationHistoryPdfDeleterRepository)
    private readonly pdfDeleterRepository: ReportConversationHistoryPdfDeleterRepository,
    @inject(ReportConversationHistoryPdfViewerRepository)
    private readonly pdfViewerRepository: ReportConversationHistoryPdfViewerRepository,
    @inject(ReportConversationHistoryPdfService)
    private readonly pdfService: ReportConversationHistoryPdfService
  ) {}

  async execute(
    accountId: string,
    chatId: string
  ): Promise<DeleteReportConversationHistoryPdfResponse | null> {
    const pdf = await this.pdfViewerRepository.viewPdfByAccountAndChat(
      accountId,
      chatId
    );

    if (!pdf) {
      return null;
    }

    await this.pdfService.deletePdf(pdf.url_pdf);

    const deleted = await this.pdfDeleterRepository.deletePdfByAccountAndChat(
      accountId,
      chatId
    );

    if (!deleted) {
      return null;
    }

    return {
      deleted: true,
    };
  }
}
