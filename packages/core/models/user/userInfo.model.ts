import { pgTable, timestamp, smallint, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const userInfo = pgTable('user_info', {
  user_info_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  user_id: smallint()
    .references(() => user.user_id)
    .notNull(),
  phone_ddi: varchar({ length: 5 }).notNull(),
  phone: varchar({ length: 500 }).notNull(),
  phone_partial: varchar({ length: 15 }).notNull(),
  photo: varchar({ length: 255 }),
  name: varchar({ length: 100 }).notNull(),
  last_name: varchar({ length: 100 }).notNull(),
  birth_date: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  deleted_at: timestamp({ mode: 'string', withTimezone: true }),
});

export const userInfoRelations = relations(userInfo, ({ one }) => ({
  uud: one(user, {
    fields: [userInfo.user_id],
    references: [user.user_id],
  }),
}));
