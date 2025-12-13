import * as schema from '@core/models';
import { reportConversationHistoryPdf } from '@core/models';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';

@injectable()
export class ReportConversationHistoryPdfUpdaterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  updateStatus = async (
    pdfId: string,
    status: EReportConversationHistoryPdfStatus
  ): Promise<void> => {
    await this.db
      .update(reportConversationHistoryPdf)
      .set({
        status,
        updated_at: new Date().toISOString(),
      })
      .where(eq(reportConversationHistoryPdf.id, pdfId))
      .execute();
  };

  updatePdfUrl = async (
    pdfId: string,
    url: string,
    status: EReportConversationHistoryPdfStatus
  ): Promise<void> => {
    await this.db
      .update(reportConversationHistoryPdf)
      .set({
        url_pdf: url,
        status,
        generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(eq(reportConversationHistoryPdf.id, pdfId))
      .execute();
  };
}
