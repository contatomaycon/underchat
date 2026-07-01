import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const whatsappEmbeddedConfig = pgTable(
  'whatsapp_embedded_config',
  {
    whatsapp_embedded_config_id: uuid().primaryKey().notNull(),
    singleton_key: boolean().default(true).notNull(),
    app_id: varchar({ length: 255 }).notNull(),
    app_secret_encrypted: varchar({ length: 4000 }).notNull(),
    webhook_verify_token_encrypted: varchar({ length: 4000 }),
    configuration_id: varchar({ length: 255 }).notNull(),
    api_version: varchar({ length: 20 }).notNull(),
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
    uniqueIndex('whatsapp_embedded_config_singleton_key_uidx').on(
      table.singleton_key
    ),
    check(
      'whatsapp_embedded_config_singleton_key_check',
      sql`${table.singleton_key} = true`
    ),
  ]
);
