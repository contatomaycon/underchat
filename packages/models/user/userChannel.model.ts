import { pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from './user.model';
import { worker } from '../worker/worker.model';
import { account } from '../account/account.model';

export const userChannel = pgTable(
  'user_channel',
  {
    user_channel_id: uuid().primaryKey().notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    channel_id: uuid()
      .references(() => worker.worker_id)
      .notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('user_channel_user_id_idx').on(table.user_id),
    index('user_channel_channel_id_idx').on(table.channel_id),
    index('user_channel_account_id_idx').on(table.account_id),
    index('user_channel_user_id_channel_id_idx').on(
      table.user_id,
      table.channel_id
    ),
    index('user_channel_user_id_account_id_idx').on(
      table.user_id,
      table.account_id
    ),
    index('user_channel_account_id_channel_id_idx').on(
      table.account_id,
      table.channel_id
    ),
  ]
);

export const userChannelRelations = relations(userChannel, ({ one }) => ({
  ucu: one(user, {
    fields: [userChannel.user_id],
    references: [user.user_id],
  }),
  ucw: one(worker, {
    fields: [userChannel.channel_id],
    references: [worker.worker_id],
  }),
  uca: one(account, {
    fields: [userChannel.account_id],
    references: [account.account_id],
  }),
}));
