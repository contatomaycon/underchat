import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { accountPayment } from '@core/models';

export const paymentStatus = pgTable('payment_status', {
  payment_status_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 50 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const paymentStatusRelations = relations(paymentStatus, ({ many }) => ({
  apm: many(accountPayment),
}));
