import { pgTable, timestamp, varchar, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const twoFactor = pgTable('two_factor', {
  two_factor_id: uuid().primaryKey().notNull(),
  user_id: uuid().references(() => user.user_id),
  phone_ddi: varchar({ length: 5 }),
  phone: varchar({ length: 500 }),
  phone_partial: varchar({ length: 15 }),
  phone_c: varchar({ length: 500 }),
  email: varchar({ length: 500 }),
  email_partial: varchar({ length: 50 }),
  email_c: varchar({ length: 500 }),
  code: varchar({ length: 8 }).notNull(),
  token: varchar({ length: 255 }).notNull(),
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

export const twoFactorRelations = relations(twoFactor, ({ one }) => ({
  uud: one(user, {
    fields: [twoFactor.user_id],
    references: [user.user_id],
  }),
}));
