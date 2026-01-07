import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { notifications } from '@core/models';

export const notificationType = pgTable(
  'notification_type',
  {
    notification_type_id: uuid().primaryKey().notNull(),
    name: varchar({ length: 50 }).notNull(),
    created_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp({
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('notification_type_name_idx').on(table.name)]
);

export const notificationTypeRelations = relations(
  notificationType,
  ({ many }) => ({
    nnt: many(notifications),
  })
);
