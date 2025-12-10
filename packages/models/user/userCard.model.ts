import {
  pgTable,
  uuid,
  timestamp,
  varchar,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';

export const userCard = pgTable('user_card', {
  user_card_id: uuid().primaryKey().notNull(),
  user_id: uuid()
    .references(() => user.user_id)
    .notNull(),
  token: varchar({ length: 500 }).notNull(),
  holder_name: varchar({ length: 500 }).notNull(),
  last_number: varchar({ length: 10 }).notNull(),
  brand: varchar({ length: 50 }).notNull(),
  default: boolean('default').notNull().default(false),
  created_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  deleted_at: timestamp({
    mode: 'string',
    withTimezone: true,
  }),
});

export const userCardRelations = relations(userCard, ({ one }) => ({
  ucu: one(user, {
    fields: [userCard.user_id],
    references: [user.user_id],
  }),
}));
