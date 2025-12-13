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
  ): Promise<{
    id: string;
    status: EReportConversationHistoryPdfStatus;
    oldUrlPdf: string | null;
  }> => {
    return this.db.transaction(async (tx) => {
      const existing = await tx
        .select({
          id: reportConversationHistoryPdf.id,
          status: reportConversationHistoryPdf.status,
          url_pdf: reportConversationHistoryPdf.url_pdf,
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

      if (existing.length > 0) {
        const record = existing[0];
        const oldUrlPdf = record.url_pdf;

        const updated = await tx
          .update(reportConversationHistoryPdf)
          .set({
            status: EReportConversationHistoryPdfStatus.pending,
            requested_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .where(eq(reportConversationHistoryPdf.id, record.id))
          .returning({
            id: reportConversationHistoryPdf.id,
            status: reportConversationHistoryPdf.status,
          })
          .execute();

        return {
          id: updated[0].id,
          status: updated[0].status,
          oldUrlPdf,
        };
      }

      const created = await tx
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
        oldUrlPdf: null,
      };
    });
  };
}
