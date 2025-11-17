import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';

export const permissionActionGroup = pgTable('permission_action_groups', {
  permission_action_group_id: uuid().primaryKey().notNull(),
  name: varchar({ length: 200 }).notNull(),
  description: varchar({ length: 500 }),
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
