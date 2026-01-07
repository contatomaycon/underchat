import { pgTable, uuid, numeric, timestamp, index } from 'drizzle-orm/pg-core';

export const creditCardFee = pgTable(
  'credit_card_fee',
  {
    credit_card_fee_id: uuid().primaryKey().notNull(),
    installment_1_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_2_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_3_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_4_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_5_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_6_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_7_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_8_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_9_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_10_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_11_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    installment_12_rate: numeric({ precision: 5, scale: 2 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
  },
  (table) => [index('credit_card_fee_deleted_at_idx').on(table.deleted_at)]
);
