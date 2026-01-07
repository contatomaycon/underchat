import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { accountPaymentNfSe } from '@core/models';

export const accountPaymentNfSeStatus = pgTable(
  'account_payment_nfse_status',
  {
    account_payment_nfse_status_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 50 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('account_payment_nfse_status_name_idx').on(table.name)]
);

export const accountPaymentNfSeStatusRelations = relations(
  accountPaymentNfSeStatus,
  ({ many }) => ({
    apn: many(accountPaymentNfSe),
  })
);
