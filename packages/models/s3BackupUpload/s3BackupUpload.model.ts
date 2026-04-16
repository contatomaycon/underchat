import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { account } from '@core/models';
import { ES3BackupMigrationStatus } from '@core/common/enums/ES3BackupMigrationStatus';

export const s3BackupUpload = pgTable(
  's3_backup_upload',
  {
    s3_backup_upload_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    bucket: varchar({ length: 255 }).notNull(),
    object_key: varchar({ length: 2000 }).notNull(),
    file_name: varchar({ length: 255 }),
    content_type: varchar({ length: 255 }),
    size_bytes: integer().notNull(),
    primary_attempts: integer().notNull().default(0),
    backup_attempts: integer().notNull().default(0),
    primary_error: text(),
    backup_error: text(),
    migration_status: varchar({ length: 20 })
      .notNull()
      .$type<ES3BackupMigrationStatus>()
      .default(ES3BackupMigrationStatus.pending),
    migration_attempts: integer().notNull().default(0),
    migration_last_error: text(),
    migrated_at: timestamp({ mode: 'string', withTimezone: true }),
    reprocess_requested_at: timestamp({ mode: 'string', withTimezone: true }),
    created_at: timestamp({ mode: 'string', withTimezone: true }).defaultNow(),
    updated_at: timestamp({ mode: 'string', withTimezone: true }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('s3_backup_upload_account_id_idx').on(table.account_id),
    index('s3_backup_upload_deleted_at_idx').on(table.deleted_at),
    index('s3_backup_upload_migration_status_idx').on(table.migration_status),
    index('s3_backup_upload_migration_status_deleted_at_created_at_idx').on(
      table.migration_status,
      table.deleted_at,
      table.created_at
    ),
    index('s3_backup_upload_account_id_deleted_at_created_at_idx').on(
      table.account_id,
      table.deleted_at,
      table.created_at
    ),
  ]
);

export const s3BackupUploadRelations = relations(s3BackupUpload, ({ one }) => ({
  acc: one(account, {
    fields: [s3BackupUpload.account_id],
    references: [account.account_id],
  }),
}));
