import {
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const downloadArtifactConfig = pgTable(
  'download_artifact_config',
  {
    download_artifact_config_id: uuid().primaryKey().notNull(),
    artifact_key: varchar({ length: 120 }).notNull(),
    url: varchar({ length: 2000 }),
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
    uniqueIndex('download_artifact_config_artifact_key_uidx').on(
      table.artifact_key
    ),
  ]
);
