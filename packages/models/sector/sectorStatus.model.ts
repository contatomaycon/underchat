import { pgTable, timestamp, varchar, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sector } from '@core/models';

export const sectorStatus = pgTable(
  'sector_status',
  {
    sector_status_id: uuid().primaryKey().notNull(),
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
  (table) => [index('sector_status_name_idx').on(table.name)]
);

export const sectorStatusRelations = relations(sectorStatus, ({ many }) => ({
  sss: many(sector),
}));
