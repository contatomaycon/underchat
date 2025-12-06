import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { accountPayment } from '@core/models';
import { accountPaymentNfSeStatus } from './accountPaymentNfSeStatus.model';

export const accountPaymentNfSe = pgTable('account_payment_nfse', {
  account_payment_nfse_id: uuid().primaryKey().notNull(),
  account_payment_id: uuid()
    .references(() => accountPayment.account_payment_id)
    .notNull(),
  reference: varchar({ length: 100 }).notNull(),
  account_payment_nfse_status_id: uuid()
    .references(() => accountPaymentNfSeStatus.account_payment_nfse_status_id)
    .notNull(),
  type: varchar({ length: 50 }),
  status_description: varchar({ length: 500 }),
  pdf_url: varchar({ length: 1000 }),
  xml_url: varchar({ length: 1000 }),
  rps_serie: varchar({ length: 50 }),
  number: varchar({ length: 100 }),
  validation_code: varchar({ length: 200 }),
  value: numeric({ precision: 10, scale: 2 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const accountPaymentNfSeRelations = relations(
  accountPaymentNfSe,
  ({ one }) => ({
    apa: one(accountPayment, {
      fields: [accountPaymentNfSe.account_payment_id],
      references: [accountPayment.account_payment_id],
    }),
    aps: one(accountPaymentNfSeStatus, {
      fields: [accountPaymentNfSe.account_payment_nfse_status_id],
      references: [accountPaymentNfSeStatus.account_payment_nfse_status_id],
    }),
  })
);
