import {
  pgTable,
  uuid,
  timestamp,
  boolean,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { EMethodPayment } from '@core/common/enums/EMethodPayment';

export const methodPayment = pgTable(
  'method_payment',
  {
    method_payment_id: uuid().primaryKey().notNull(),
    type: varchar({ length: 20 })
      .notNull()
      .$type<EMethodPayment>()
      .default(EMethodPayment.boleto),
    status: boolean().notNull().default(true),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('method_payment_type_idx').on(table.type),
    index('method_payment_status_idx').on(table.status),
    index('method_payment_created_at_idx').on(table.created_at),
  ]
);
