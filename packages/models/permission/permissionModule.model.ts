import { relations } from 'drizzle-orm';
import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { permissionAction } from '@core/models';

export const permissionModule = pgTable('permission_module', {
  module_id: uuid().primaryKey().notNull(),
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
    ppa: many(permissionAction),
  })
);
