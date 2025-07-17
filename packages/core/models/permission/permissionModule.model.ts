import { relations } from 'drizzle-orm';
import { pgTable, timestamp, varchar, integer } from 'drizzle-orm/pg-core';
import { permissionAction } from '@core/models';

export const permissionModule = pgTable('permission_module', {
  module_id: integer().primaryKey().generatedByDefaultAsIdentity().notNull(),
  module: varchar({ length: 100 }).notNull(),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const permissionModuleRelations = relations(
  permissionModule,
  ({ many }) => ({
    permission_action: many(permissionAction),
  })
);
