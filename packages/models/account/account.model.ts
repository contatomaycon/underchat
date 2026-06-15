import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  boolean,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  accountInfo,
  accountStatus,
  apiKey,
  permissionAssignment,
  worker,
  sector,
  messageTemplate,
  labelTemplate,
  contact,
  contactGroup,
  planCrossSellAccount,
  planAccount,
  accountPayment,
  reportConversationHistoryPdf,
  schedule,
  planAccountExclusive,
  userChannel,
} from '@core/models';

export const account = pgTable(
  'account',
  {
    account_id: uuid().primaryKey().notNull(),
    account_status_id: uuid()
      .references(() => accountStatus.account_status_id)
      .notNull(),
    name: varchar({ length: 10 }).notNull(),
    generate_invoice: boolean().default(true).notNull(),
    bucket_deleted: boolean().default(false),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('account_account_status_id_idx').on(table.account_status_id),
    index('account_deleted_at_idx').on(table.deleted_at),
    index('account_deleted_at_created_at_idx').on(
      table.deleted_at,
      table.created_at
    ),
    index('account_account_status_id_created_at_idx').on(
      table.account_status_id,
      table.created_at
    ),
  ]
);

export const accountRelations = relations(account, ({ one, many }) => ({
  aac: one(accountStatus, {
    fields: [account.account_status_id],
    references: [accountStatus.account_status_id],
  }),
  aai: one(accountInfo, {
    fields: [account.account_id],
    references: [accountInfo.account_id],
  }),
  apa: one(permissionAssignment, {
    fields: [account.account_id],
    references: [permissionAssignment.account_id],
  }),
  apc: many(planAccount),
  aak: many(apiKey),
  swk: many(worker),
  sct: many(sector),
  amt: many(messageTemplate),
  alt: many(labelTemplate),
  ctc: many(contact),
  ctg: many(contactGroup),
  pca: many(planCrossSellAccount),
  apm: many(accountPayment),
  rch: many(reportConversationHistoryPdf),
  sch: many(schedule),
  pae: many(planAccountExclusive),
  uch: many(userChannel),
}));
