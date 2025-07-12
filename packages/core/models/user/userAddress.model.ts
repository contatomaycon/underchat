import { pgTable, timestamp, smallint, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const userAddress = pgTable('user_address', {
  user_address_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  user_id: smallint()
    .references(() => user.user_id)
    .notNull(),
  zip_code: varchar({ length: 10 }).notNull(),
  street: varchar({ length: 100 }).notNull(),
  number: varchar({ length: 10 }).notNull(),
  neighborhood: varchar({ length: 50 }).notNull(),
  city: varchar({ length: 50 }).notNull(),
  state: varchar({ length: 50 }).notNull(),
  complement: varchar({ length: 100 }),
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

export const userAddressRelations = relations(userAddress, ({ one }) => ({
  uud: one(user, {
    fields: [userAddress.user_id],
    references: [user.user_id],
  }),
}));
