import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  numeric,
  boolean,
  integer,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { accountPaymentNfSe } from '@core/models';

export const nfse = pgTable('nfse', {
  nfse_id: uuid().primaryKey().notNull(),
  external_id: integer(),
  name: varchar({ length: 500 }).notNull(),
  municipal_service_description_field: varchar({ length: 500 }),
  municipal_service_code: varchar({ length: 50 }),
  retain_iss: boolean().notNull().default(false),
  iss_value: numeric({ precision: 10, scale: 5 }),
  cofins_value: numeric({ precision: 10, scale: 5 }),
  csll_value: numeric({ precision: 10, scale: 5 }),
  inss_value: numeric({ precision: 10, scale: 5 }),
  ir_value: numeric({ precision: 10, scale: 5 }),
  pis_value: numeric({ precision: 10, scale: 5 }),
  deductions: numeric({ precision: 10, scale: 5 }),
  default_product: boolean().notNull().default(false),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const nfseRelations = relations(nfse, ({ many }) => ({
  apn: many(accountPaymentNfSe),
}));
