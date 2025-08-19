import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import {
  userStatus,
  userAddress,
  userInfo,
  userDocument,
  account,
  permissionAssignment,
  chatUser,
} from '@core/models';

export const user = pgTable('user', {
  user_id: uuid().primaryKey().notNull(),
  account_id: uuid()
    .references(() => account.account_id)
    .notNull(),
  user_status_id: uuid()
    .references(() => userStatus.user_status_id)
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
  aac: one(account, {
    fields: [user.account_id],
    references: [account.account_id],
  }),
  uus: one(userStatus, {
    fields: [user.user_status_id],
    references: [userStatus.user_status_id],
  }),
  uua: one(userAddress, {
    fields: [user.user_id],
    references: [userAddress.user_id],
  }),
  uui: one(userInfo, {
    fields: [user.user_id],
    references: [userInfo.user_id],
  }),
  uud: one(userDocument, {
    fields: [user.user_id],
    references: [userDocument.user_id],
  }),
  upa: one(permissionAssignment, {
    fields: [user.user_id],
    references: [permissionAssignment.user_id],
  }),
  ucu: one(chatUser, {
    fields: [user.user_id],
    references: [chatUser.user_id],
  }),
}));
