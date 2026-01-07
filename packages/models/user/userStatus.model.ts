import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const userStatus = pgTable(
  'user_status',
  {
    user_status_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 20 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('user_status_name_idx').on(table.name)]
);

export const userStatusRelations = relations(userStatus, ({ many }) => ({
  uus: many(user),
}));
