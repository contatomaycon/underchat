import { relations } from 'drizzle-orm';
import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import {
  permissionModule,
  permissionRoleAction,
  permissionActionGroup,
} from '@core/models';

export const permissionAction = pgTable('permission_action', {
  permission_action_id: uuid().primaryKey().notNull(),
  permission_module_id: uuid()
    .references(() => permissionModule.module_id)
    .notNull(),
  permission_action_group_id: uuid()
    .references(() => permissionActionGroup.permission_action_group_id)
    .notNull(),
  action: varchar({ length: 100 }).notNull(),
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
});

export const permissionActionRelations = relations(
  permissionAction,
  ({ one, many }) => ({
    ppm: one(permissionModule, {
      fields: [permissionAction.permission_module_id],
      references: [permissionModule.module_id],
    }),
    pag: one(permissionActionGroup, {
      fields: [permissionAction.permission_action_group_id],
      references: [permissionActionGroup.permission_action_group_id],
    }),
    pra: many(permissionRoleAction),
  })
);
