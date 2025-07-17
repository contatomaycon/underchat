import { pgTable, timestamp, varchar, smallint } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const userStatus = pgTable('user_status', {
  user_status_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  name: varchar({ length: 20 }).notNull(),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const userStatusRelations = relations(userStatus, ({ many }) => ({
  uus: many(user),
}));
