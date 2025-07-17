import { pgTable, timestamp, smallint, integer } from 'drizzle-orm/pg-core';
import { permissionRole, user, apiKey } from '@core/models';
import { relations } from 'drizzle-orm';

export const permissionAssignment = pgTable('permission_assignment', {
  permission_assignment_id: integer()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  permission_role_id: integer()
    .references(() => permissionRole.permission_role_id)
    .notNull(),
  user_id: smallint().references(() => user.user_id),
  api_key_id: smallint().references(() => apiKey.api_key_id),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

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
    pak: one(apiKey, {
      fields: [permissionAssignment.api_key_id],
      references: [apiKey.api_key_id],
    }),
  })
);
