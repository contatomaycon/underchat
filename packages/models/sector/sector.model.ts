import { pgTable, uuid, timestamp, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sectorStatus, account } from '@core/models';

export const sector = pgTable(
  'sector',
  {
    sector_id: uuid().primaryKey().notNull(),
    sector_status_id: uuid()
      .references(() => sectorStatus.sector_status_id)
      .notNull(),
    account_id: uuid()
      .references(() => account.account_id)
      .notNull(),
    name: varchar({ length: 20 }).notNull(),
    color: varchar({ length: 20 }).notNull(),
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
    index('sector_sector_status_id_idx').on(table.sector_status_id),
    index('sector_account_id_idx').on(table.account_id),
    index('sector_deleted_at_idx').on(table.deleted_at),
    index('sector_account_id_deleted_at_idx').on(
      table.account_id,
      table.deleted_at
    ),
  ]
);

export const sectorRelations = relations(sector, ({ one }) => ({
  sst: one(sectorStatus, {
    fields: [sector.sector_status_id],
    references: [sectorStatus.sector_status_id],
  }),
  sac: one(account, {
    fields: [sector.account_id],
    references: [account.account_id],
  }),
}));
