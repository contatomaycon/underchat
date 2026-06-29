import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { worker } from '@core/models';

export const workerWhatsappOfficialConnection = pgTable(
  'worker_whatsapp_official_connection',
  {
    worker_whatsapp_official_connection_id: uuid().primaryKey().notNull(),
    worker_id: uuid()
      .references(() => worker.worker_id)
      .notNull(),
    business_id: varchar({ length: 255 }),
    waba_id: varchar({ length: 255 }).notNull(),
    phone_number_id: varchar({ length: 255 }).notNull(),
    display_phone_number: varchar({ length: 50 }),
    verified_name: varchar({ length: 500 }),
    access_token_encrypted: varchar({ length: 4000 }).notNull(),
    token_type: varchar({ length: 50 }),
    expires_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }),
    scope: text(),
    api_version: varchar({ length: 20 }).notNull(),
    connected_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).notNull(),
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
    index('worker_whatsapp_official_connection_worker_id_idx').on(
      table.worker_id
    ),
    index('worker_whatsapp_official_connection_waba_id_idx').on(table.waba_id),
    index('worker_whatsapp_official_connection_phone_number_id_idx').on(
      table.phone_number_id
    ),
    index('worker_whatsapp_official_connection_deleted_at_idx').on(
      table.deleted_at
    ),
    index('worker_whatsapp_official_connection_worker_id_deleted_at_idx').on(
      table.worker_id,
      table.deleted_at
    ),
  ]
);

export const workerWhatsappOfficialConnectionRelations = relations(
  workerWhatsappOfficialConnection,
  ({ one }) => ({
    worker: one(worker, {
      fields: [workerWhatsappOfficialConnection.worker_id],
      references: [worker.worker_id],
    }),
  })
);
