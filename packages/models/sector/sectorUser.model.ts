import { pgTable, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sector, user } from '@core/models';

export const sectorUser = pgTable(
  'sector_user',
  {
    sector_user_id: uuid().primaryKey().notNull(),
    sector_id: uuid()
      .references(() => sector.sector_id)
      .notNull(),
    user_id: uuid()
      .references(() => user.user_id)
      .notNull(),
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
    index('sector_user_sector_id_idx').on(table.sector_id),
    index('sector_user_user_id_idx').on(table.user_id),
    index('sector_user_deleted_at_idx').on(table.deleted_at),
  ]
);

export const sectorUserRelations = relations(sectorUser, ({ one }) => ({
  sus: one(sector, {
    fields: [sectorUser.sector_id],
    references: [sector.sector_id],
  }),
  suu: one(user, {
    fields: [sectorUser.user_id],
    references: [user.user_id],
  }),
}));
