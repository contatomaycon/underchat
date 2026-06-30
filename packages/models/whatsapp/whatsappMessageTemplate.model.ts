import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  account,
  worker,
  workerWhatsappOfficialConnection,
} from '@core/models';

export type WhatsappMessageTemplateComponent = {
  type: string;
  [key: string]: unknown;
};
export type WhatsappMessageTemplateMetaPayload = Record<string, unknown>;

export const whatsappMessageTemplate = pgTable(
  'whatsapp_message_template',
  {
    whatsapp_message_template_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    worker_id: uuid()
      .references(() => worker.worker_id)
      .notNull(),
    worker_whatsapp_official_connection_id: uuid().references(
      () =>
        workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id
    ),
    waba_id: varchar({ length: 255 }).notNull(),
    meta_template_id: varchar({ length: 255 }),
    name: varchar({ length: 512 }).notNull(),
    language: varchar({ length: 50 }).notNull(),
    category: varchar({ length: 80 }).notNull(),
    sub_category: varchar({ length: 120 }),
    parameter_format: varchar({ length: 40 }),
    components: jsonb().$type<WhatsappMessageTemplateComponent[]>().notNull(),
    status: varchar({ length: 80 }).notNull(),
    quality_score: varchar({ length: 80 }),
    rejected_reason: text(),
    message_send_ttl_seconds: integer(),
    meta_payload: jsonb().$type<WhatsappMessageTemplateMetaPayload>(),
    origin: varchar({ length: 40 }).notNull().default('underchat'),
    sync_state: varchar({ length: 40 }).notNull().default('draft'),
    is_active: boolean().notNull().default(true),
    last_synced_at: timestamp({ mode: 'string', withTimezone: true }),
    last_error: text(),
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
    uniqueIndex('whatsapp_message_template_worker_meta_template_uidx').on(
      table.worker_id,
      table.meta_template_id
    ),
    index('whatsapp_message_template_account_worker_idx').on(
      table.account_id,
      table.worker_id
    ),
    index('whatsapp_message_template_worker_status_idx').on(
      table.worker_id,
      table.status
    ),
    index('whatsapp_message_template_worker_category_idx').on(
      table.worker_id,
      table.category
    ),
    index('whatsapp_message_template_name_language_idx').on(
      table.worker_id,
      table.name,
      table.language
    ),
    index('whatsapp_message_template_deleted_at_idx').on(table.deleted_at),
  ]
);

export const whatsappMessageTemplateRelations = relations(
  whatsappMessageTemplate,
  ({ one }) => ({
    account: one(account, {
      fields: [whatsappMessageTemplate.account_id],
      references: [account.account_id],
    }),
    worker: one(worker, {
      fields: [whatsappMessageTemplate.worker_id],
      references: [worker.worker_id],
    }),
    officialConnection: one(workerWhatsappOfficialConnection, {
      fields: [whatsappMessageTemplate.worker_whatsapp_official_connection_id],
      references: [
        workerWhatsappOfficialConnection.worker_whatsapp_official_connection_id,
      ],
    }),
  })
);
