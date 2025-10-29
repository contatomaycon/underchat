import { pgTable, uuid, timestamp, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sectorStatus, account, sectorRole } from '@core/models';

export const sector = pgTable('sector', {
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
});

export const sectorRelations = relations(sector, ({ one, many }) => ({
  sst: one(sectorStatus, {
    fields: [sector.sector_status_id],
    references: [sectorStatus.sector_status_id],
  }),
  sac: one(account, {
    fields: [sector.account_id],
    references: [account.account_id],
  }),
  sro: many(sectorRole),
}));
