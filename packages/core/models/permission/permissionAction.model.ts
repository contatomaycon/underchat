import { relations } from 'drizzle-orm';
import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { permissionModule, permissionRoleAction } from '@core/models';

export const permissionAction = pgTable('permission_action', {
  permission_action_id: uuid().primaryKey().notNull(),
  permission_module_id: uuid()
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
    ppm: one(permissionModule, {
      fields: [permissionAction.permission_module_id],
      references: [permissionModule.module_id],
    }),
    pra: many(permissionRoleAction),
  })
);
