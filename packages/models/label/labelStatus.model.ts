import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { labelTemplate } from '@core/models';

export const labelStatus = pgTable(
  'label_status',
  {
    label_status_id: uuid().primaryKey().notNull(),
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
  (table) => [index('label_status_name_idx').on(table.name)]
);

export const labelStatusRelations = relations(labelStatus, ({ many }) => ({
  lst: many(labelTemplate),
}));
