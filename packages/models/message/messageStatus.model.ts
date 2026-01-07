import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { messageTemplate } from '@core/models';

export const messageStatus = pgTable(
  'message_status',
  {
    message_status_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 20 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('message_status_name_idx').on(table.name)]
);

export const messageStatusRelations = relations(messageStatus, ({ many }) => ({
  mms: many(messageTemplate),
}));
