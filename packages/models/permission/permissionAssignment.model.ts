import { pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { permissionRole, user, account } from '@core/models';
import { relations } from 'drizzle-orm';

export const permissionAssignment = pgTable(
  'permission_assignment',
  {
    permission_assignment_id: uuid().primaryKey().notNull(),
    permission_role_id: uuid()
      .references(() => permissionRole.permission_role_id)
      .notNull(),
    user_id: uuid().references(() => user.user_id),
    account_id: uuid().references(() => account.account_id),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('permission_assignment_permission_role_id_idx').on(
      table.permission_role_id
    ),
    index('permission_assignment_user_id_idx').on(table.user_id),
    index('permission_assignment_account_id_idx').on(table.account_id),
    index('permission_assignment_user_id_permission_role_id_idx').on(
      table.user_id,
      table.permission_role_id
    ),
    index('permission_assignment_account_id_permission_role_id_idx').on(
      table.account_id,
      table.permission_role_id
    ),
  ]
);

export const permissionAssignmentRelations = relations(
  permissionAssignment,
  ({ one }) => ({
    ppr: one(permissionRole, {
      fields: [permissionAssignment.permission_role_id],
      references: [permissionRole.permission_role_id],
    }),
    pus: one(user, {
      fields: [permissionAssignment.user_id],
      references: [user.user_id],
    }),
    pac: one(account, {
      fields: [permissionAssignment.account_id],
      references: [account.account_id],
    }),
  })
);
