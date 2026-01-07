import { uuid, pgTable, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import {
  account,
  permissionAssignment,
  permissionRoleAction,
} from '@core/models';
import { relations } from 'drizzle-orm';

export const permissionRole = pgTable(
  'permission_role',
  {
    permission_role_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    name: varchar({ length: 200 }).notNull(),
    description: varchar({ length: 500 }),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp({ mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('permission_role_account_id_idx').on(table.account_id),
    index('permission_role_deleted_at_idx').on(table.deleted_at),
    index('permission_role_account_id_deleted_at_idx').on(
      table.account_id,
      table.deleted_at
    ),
    index('permission_role_name_idx').on(table.name),
  ]
);

export const permissionRoleRelations = relations(
  permissionRole,
  ({ many }) => ({
    ppa: many(permissionAssignment),
    pra: many(permissionRoleAction),
  })
);
