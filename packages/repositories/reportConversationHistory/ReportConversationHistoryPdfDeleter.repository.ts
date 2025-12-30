import * as schema from '@core/models';
import { reportConversationHistoryPdf } from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ReportConversationHistoryPdfDeleterRepository {
  constructor(
    @inject('DatabaseRw') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  deletePdfByAccountAndChat = async (
    accountId: string,
    chatId: string
  ): Promise<boolean> => {
    const result = await this.db
      .delete(reportConversationHistoryPdf)
      .where(
        and(
          eq(reportConversationHistoryPdf.account_id, accountId),
          eq(reportConversationHistoryPdf.chat_id, chatId)
        )
      )
      .execute();

    return (result.rowCount ?? 0) > 0;
  };
}
