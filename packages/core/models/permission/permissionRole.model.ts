import { integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';
import { permissionAssignment, permissionRoleAction } from '@core/models';
import { relations } from 'drizzle-orm';

export const permissionRole = pgTable('permission_role', {
  permission_role_id: integer()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  name: varchar({ length: 200 }).notNull(),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const permissionRoleRelations = relations(
  permissionRole,
  ({ many }) => ({
    permission_assignment: many(permissionAssignment),
    permission_role_action: many(permissionRoleAction),
  })
);
