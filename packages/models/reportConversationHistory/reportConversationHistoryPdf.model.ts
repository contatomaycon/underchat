import { pgTable, uuid, timestamp, text, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';
import { EReportConversationHistoryPdfStatus } from '@core/common/enums/EReportConversationHistoryPdfStatus';

export const reportConversationHistoryPdf = pgTable(
  'report_conversation_history_pdf',
  {
    id: uuid().primaryKey().notNull().defaultRandom(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    chat_id: uuid().notNull(),
    url_pdf: text(),
    status: varchar({ length: 20 })
      .notNull()
      .$type<EReportConversationHistoryPdfStatus>()
      .default(EReportConversationHistoryPdfStatus.pending),
    requested_at: timestamp('requested_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    generated_at: timestamp('generated_at', {
      mode: 'string',
      withTimezone: true,
    }),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  }
);

export const reportConversationHistoryPdfRelations = relations(
  reportConversationHistoryPdf,
  ({ one }) => ({
    rch: one(account, {
      fields: [reportConversationHistoryPdf.account_id],
      references: [account.account_id],
    }),
  })
);
