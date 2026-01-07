import { pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import {
  permissionAction,
  permissionRole,
  permissionActionGroup,
} from '@core/models';
import { relations } from 'drizzle-orm';

export const permissionRoleAction = pgTable(
  'permission_role_action',
  {
    permission_role_action_id: uuid().primaryKey().notNull(),
    permission_action_id: uuid().references(
      () => permissionAction.permission_action_id
    ),
    permission_action_group_id: uuid().references(
      () => permissionActionGroup.permission_action_group_id
    ),
    permission_role_id: uuid()
      .references(() => permissionRole.permission_role_id)
      .notNull(),
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
    index('permission_role_action_permission_action_id_idx').on(
      table.permission_action_id
    ),
    index('permission_role_action_permission_action_group_id_idx').on(
      table.permission_action_group_id
    ),
    index('permission_role_action_permission_role_id_idx').on(
      table.permission_role_id
    ),
    index(
      'permission_role_action_permission_role_id_permission_action_group_id_idx'
    ).on(table.permission_role_id, table.permission_action_group_id),
  ]
);

export const permissionRoleActionRelations = relations(
  permissionRoleAction,
  ({ one }) => ({
    ppa: one(permissionAction, {
      fields: [permissionRoleAction.permission_action_id],
      references: [permissionAction.permission_action_id],
    }),
    pag: one(permissionActionGroup, {
      fields: [permissionRoleAction.permission_action_group_id],
      references: [permissionActionGroup.permission_action_group_id],
    }),
    ppr: one(permissionRole, {
      fields: [permissionRoleAction.permission_role_id],
      references: [permissionRole.permission_role_id],
    }),
  })
);
