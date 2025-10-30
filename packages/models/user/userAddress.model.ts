import {
  pgTable,
  timestamp,
  varchar,
  uuid,
  smallint,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { country, user } from '@core/models';

export const userAddress = pgTable('user_address', {
  user_address_id: uuid().primaryKey().notNull(),
  user_id: uuid()
    .references(() => user.user_id)
    .notNull(),
  country_id: smallint()
    .references(() => country.country_id)
    .notNull(),
  zip_code: varchar({ length: 10 }).notNull(),
  address1: varchar({ length: 1000 }).notNull(),
  address1_partial: varchar({ length: 200 }).notNull(),
  address2: varchar({ length: 1000 }),
  address2_partial: varchar({ length: 200 }),
  city: varchar({ length: 100 }).notNull(),
  state: varchar({ length: 100 }).notNull(),
  district: varchar({ length: 100 }).notNull(),
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
  uuc: one(country, {
    fields: [userAddress.country_id],
    references: [country.country_id],
  }),
}));
