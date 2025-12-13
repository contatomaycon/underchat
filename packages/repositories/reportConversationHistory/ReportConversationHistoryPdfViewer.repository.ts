import * as schema from '@core/models';
import { reportConversationHistoryPdf } from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IReportConversationHistoryPdfView } from '@core/common/interfaces/IReportConversationHistoryPdfView';

@injectable()
export class ReportConversationHistoryPdfViewerRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  viewPdfByAccountAndChat = async (
    accountId: string,
    chatId: string
  ): Promise<IReportConversationHistoryPdfView | null> => {
    const result = await this.db
      .select({
        id: reportConversationHistoryPdf.id,
        url_pdf: reportConversationHistoryPdf.url_pdf,
        status: reportConversationHistoryPdf.status,
        requested_at: reportConversationHistoryPdf.requested_at,
        generated_at: reportConversationHistoryPdf.generated_at,
      })
      .from(reportConversationHistoryPdf)
      .where(
        and(
          eq(reportConversationHistoryPdf.account_id, accountId),
          eq(reportConversationHistoryPdf.chat_id, chatId)
        )
      )
      .limit(1)
      .execute();

    if (!result.length) {
      return null;
    }

    return result[0];
  };
}
