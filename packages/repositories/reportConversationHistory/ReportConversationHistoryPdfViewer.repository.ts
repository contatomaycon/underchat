import * as schema from '@core/models';
import { reportConversationHistoryPdf } from '@core/models';
import { and, eq, inArray } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { IReportConversationHistoryPdfView } from '@core/common/interfaces/IReportConversationHistoryPdfView';

@injectable()
export class ReportConversationHistoryPdfViewerRepository {
  constructor(
    @inject('DatabaseRo') private readonly dbRo: NodePgDatabase<typeof schema>
  ) {}

  viewPdfByAccountAndChat = async (
    accountId: string,
    chatId: string
  ): Promise<IReportConversationHistoryPdfView | null> => {
    const result = await this.dbRo
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

  listPdfsByAccountAndChatIds = async (
    accountId: string,
    chatIds: string[]
  ): Promise<Map<string, string>> => {
    if (chatIds.length === 0) {
      return new Map();
    }

    const result = await this.dbRo
      .select({
        chat_id: reportConversationHistoryPdf.chat_id,
        status: reportConversationHistoryPdf.status,
      })
      .from(reportConversationHistoryPdf)
      .where(
        and(
          eq(reportConversationHistoryPdf.account_id, accountId),
          inArray(reportConversationHistoryPdf.chat_id, chatIds)
        )
      )
      .execute();

    const statusMap = new Map<string, string>();
    for (const item of result) {
      statusMap.set(item.chat_id, item.status);
    }

    return statusMap;
  };
}
