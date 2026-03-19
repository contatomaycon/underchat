import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  numeric,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { accountPaymentNfSe } from '@core/models';

export const nfse = pgTable(
  'nfse',
  {
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
    integration_enabled: boolean().notNull().default(false),
    integration_base_url: varchar({ length: 500 }),
    integration_uf: varchar({ length: 2 }),
    integration_tenant: varchar({ length: 255 }),
    integration_username: varchar({ length: 255 }),
    integration_password_encrypted: varchar({ length: 4000 }),
    integration_municipality_code: varchar({ length: 7 }),
    integration_rps_series: varchar({ length: 5 }),
    integration_prestador_document: varchar({ length: 14 }),
    integration_prestador_municipal_inscription: varchar({ length: 30 }),
    certificate_bucket: varchar({ length: 255 }),
    certificate_key: varchar({ length: 1000 }),
    certificate_file_name: varchar({ length: 500 }),
    certificate_password_encrypted: varchar({ length: 4000 }),
    certificate_uploaded_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    default_product: boolean().notNull().default(false),
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
    index('nfse_external_id_idx').on(table.external_id),
    index('nfse_default_product_idx').on(table.default_product),
  ]
);

export const nfseRelations = relations(nfse, ({ many }) => ({
  apn: many(accountPaymentNfSe),
}));
