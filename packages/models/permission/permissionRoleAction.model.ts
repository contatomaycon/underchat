import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { permissionAction, permissionRole } from '@core/models';
import { relations } from 'drizzle-orm';

export const permissionRoleAction = pgTable('permission_role_action', {
  permission_role_action_id: uuid().primaryKey().notNull(),
  permission_action_id: uuid()
    .references(() => permissionAction.permission_action_id)
    .notNull(),
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
});

export const permissionRoleActionRelations = relations(
  permissionRoleAction,
  ({ one }) => ({
    ppa: one(permissionAction, {
      fields: [permissionRoleAction.permission_action_id],
      references: [permissionAction.permission_action_id],
    }),
    ppr: one(permissionRole, {
      fields: [permissionRoleAction.permission_role_id],
      references: [permissionRole.permission_role_id],
    }),
  })
);
