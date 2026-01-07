import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const userInfo = pgTable(
  'user_info',
  {
    user_info_id: uuid().primaryKey().notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
    phone_ddi: varchar({ length: 5 }),
    phone: varchar({ length: 500 }),
    phone_partial: varchar({ length: 15 }),
    phone_c: varchar({ length: 500 }),
    phone_jid: varchar({ length: 500 }),
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
  },
  (table) => [
    index('user_info_user_id_idx').on(table.user_id),
    index('user_info_phone_partial_idx').on(table.phone_partial),
    index('user_info_deleted_at_idx').on(table.deleted_at),
    index('user_info_user_id_deleted_at_idx').on(
      table.user_id,
      table.deleted_at
    ),
    index('user_info_phone_c_deleted_at_idx').on(
      table.phone_c,
      table.deleted_at
    ),
  ]
);

export const userInfoRelations = relations(userInfo, ({ one }) => ({
  uud: one(user, {
    fields: [userInfo.user_id],
    references: [user.user_id],
  }),
}));
