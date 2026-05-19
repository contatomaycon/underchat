import {
  check,
  index,
  pgTable,
  smallint,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { account, zipcodeCity, zipcodeState } from '@core/models';

export const chatbotHoliday = pgTable(
  'chatbot_holiday',
  {
    chatbot_holiday_id: uuid().primaryKey().notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    scope: varchar({ length: 20 }).notNull(),
    name: varchar({ length: 250 }).notNull(),
    month: smallint().notNull(),
    day: smallint().notNull(),
    state_id: uuid().references(() => zipcodeState.id_zipcode_state),
    city_id: uuid().references(() => zipcodeCity.id_zipcode_city),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index('chatbot_holiday_account_id_idx').on(table.account_id),
    index('chatbot_holiday_scope_idx').on(table.scope),
    index('chatbot_holiday_month_day_idx').on(table.month, table.day),
    index('chatbot_holiday_state_id_idx').on(table.state_id),
    index('chatbot_holiday_city_id_idx').on(table.city_id),
    check(
      'chatbot_holiday_scope_check',
      sql`${table.scope} IN ('state', 'municipal')`
    ),
    check('chatbot_holiday_month_check', sql`${table.month} BETWEEN 1 AND 12`),
    check('chatbot_holiday_day_check', sql`${table.day} BETWEEN 1 AND 31`),
  ]
);

export const chatbotHolidayRelations = relations(chatbotHoliday, ({ one }) => ({
  cha: one(account, {
    fields: [chatbotHoliday.account_id],
    references: [account.account_id],
  }),
  chs: one(zipcodeState, {
    fields: [chatbotHoliday.state_id],
    references: [zipcodeState.id_zipcode_state],
  }),
  chc: one(zipcodeCity, {
    fields: [chatbotHoliday.city_id],
    references: [zipcodeCity.id_zipcode_city],
  }),
}));
