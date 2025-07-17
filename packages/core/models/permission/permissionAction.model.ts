import { relations } from 'drizzle-orm';
import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { permissionModule, permissionRoleAction } from '@core/models';

export const permissionAction = pgTable('permission_action', {
  permission_action_id: integer()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  permission_module_id: integer()
    .references(() => permissionModule.module_id)
    .notNull(),
  action: varchar({ length: 100 }).notNull(),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const permissionActionRelations = relations(
  permissionAction,
  ({ one, many }) => ({
    permission_module: one(permissionModule, {
      fields: [permissionAction.permission_module_id],
      references: [permissionModule.module_id],
    }),
    permission_role_action: many(permissionRoleAction),
  })
);
