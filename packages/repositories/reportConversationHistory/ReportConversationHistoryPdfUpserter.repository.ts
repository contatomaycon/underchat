import * as schema from '@core/models';
import { reportConversationHistoryPdf } from '@core/models';
import { and, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inject, injectable } from 'tsyringe';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';

@injectable()
export class ReportConversationHistoryPdfUpserterRepository {
  constructor(
    @inject('Database') private readonly db: NodePgDatabase<typeof schema>
  ) {}

  upsertPdf = async (
    accountId: string,
    chatId: string
  ): Promise<{ id: string; status: EReportConversationHistoryPdfStatus }> => {
    const existing = await this.findByAccountAndChat(accountId, chatId);

    if (existing) {
      if (existing.status === EReportConversationHistoryPdfStatus.done) {
        return {
          id: existing.id,
          status: existing.status,
        };
      }

      return await this.updateToPending(existing.id);
    }

    return await this.createPdf(accountId, chatId);
  };

  private findByAccountAndChat = async (
    accountId: string,
    chatId: string
  ): Promise<{
    id: string;
    status: EReportConversationHistoryPdfStatus;
  } | null> => {
    const result = await this.db
      .select({
        id: reportConversationHistoryPdf.id,
        status: reportConversationHistoryPdf.status,
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

  private createPdf = async (
    accountId: string,
    chatId: string
  ): Promise<{ id: string; status: EReportConversationHistoryPdfStatus }> => {
    const created = await this.db
      .insert(reportConversationHistoryPdf)
      .values({
        account_id: accountId,
        chat_id: chatId,
        status: EReportConversationHistoryPdfStatus.pending,
        requested_at: new Date().toISOString(),
      })
      .returning({
        id: reportConversationHistoryPdf.id,
        status: reportConversationHistoryPdf.status,
      })
      .execute();

    return {
      id: created[0].id,
      status: created[0].status,
    };
  };

  private updateToPending = async (
    pdfId: string
  ): Promise<{ id: string; status: EReportConversationHistoryPdfStatus }> => {
    const updated = await this.db
      .update(reportConversationHistoryPdf)
      .set({
        status: EReportConversationHistoryPdfStatus.pending,
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(eq(reportConversationHistoryPdf.id, pdfId))
      .returning({
        id: reportConversationHistoryPdf.id,
        status: reportConversationHistoryPdf.status,
      })
      .execute();

    return {
      id: updated[0].id,
      status: updated[0].status,
    };
  };
}
