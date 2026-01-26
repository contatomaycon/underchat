import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { account, permissionAssignment, worker } from '@core/models';
import { relations } from 'drizzle-orm';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';

export const apiKey = pgTable(
  'api_key',
  {
    api_key_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    worker_id: uuid().references(() => worker.worker_id),
    key: varchar({ length: 32 }).notNull(),
    name: varchar({ length: 200 }).notNull(),
    status: varchar({ length: 20 })
      .notNull()
      .$type<EStatusApiKey>()
      .default(EStatusApiKey.active),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp('deleted_at', { mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('api_key_account_id_idx').on(table.account_id),
    index('api_key_key_idx').on(table.key),
    index('api_key_deleted_at_idx').on(table.deleted_at),
    index('api_key_account_id_deleted_at_idx').on(
      table.account_id,
      table.deleted_at
    ),
    index('api_key_key_deleted_at_idx').on(table.key, table.deleted_at),
    index('api_key_worker_id_idx').on(table.worker_id),
    index('api_key_worker_id_deleted_at_idx').on(
      table.worker_id,
      table.deleted_at
    ),
    index('api_key_worker_id_account_id_idx').on(
      table.worker_id,
      table.account_id
    ),
    index('api_key_worker_id_account_id_deleted_at_idx').on(
      table.worker_id,
      table.account_id,
      table.deleted_at
    ),
  ]
);

export const apiKeyRelations = relations(apiKey, ({ many, one }) => ({
  apa: many(permissionAssignment),
  aac: one(account, {
    fields: [apiKey.account_id],
    references: [account.account_id],
  }),
  awo: one(worker, {
    fields: [apiKey.worker_id],
    references: [worker.worker_id],
  }),
}));
