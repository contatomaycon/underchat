import { pgTable, timestamp, smallint, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { userStatus, userType, userAddress, userInfo } from '@core/models';

export const user = pgTable('user', {
  user_id: smallint().primaryKey().generatedByDefaultAsIdentity().notNull(),
  user_status_id: smallint()
    .references(() => userStatus.user_status_id)
    .notNull(),
  user_type_id: smallint()
    .references(() => userType.user_type_id)
    .notNull(),
  username: varchar({ length: 50 }),
  email: varchar({ length: 500 }).notNull(),
  email_partial: varchar({ length: 25 }).notNull(),
  password: varchar({ length: 255 }).notNull(),
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

export const userRelations = relations(user, ({ one }) => ({
  uus: one(userStatus, {
    fields: [user.user_status_id],
    references: [userStatus.user_status_id],
  }),
  uut: one(userType, {
    fields: [user.user_type_id],
    references: [userType.user_type_id],
  }),
  uua: one(userAddress, {
    fields: [user.user_id],
    references: [userAddress.user_id],
  }),
  uui: one(userInfo, {
    fields: [user.user_id],
    references: [userInfo.user_id],
  }),
}));
