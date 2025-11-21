import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sector, permissionRole } from '@core/models';

export const sectorRole = pgTable('sector_role', {
  sector_role_id: uuid().primaryKey().notNull(),
  sector_id: uuid()
    .references(() => sector.sector_id)
    .notNull(),
  permission_role_id: uuid()
    .references(() => permissionRole.permission_role_id)
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
});

export const sectorRoleRelations = relations(sectorRole, ({ one }) => ({
  sst: one(sector, {
    fields: [sectorRole.sector_id],
    references: [sector.sector_id],
  }),
  spr: one(permissionRole, {
    fields: [sectorRole.permission_role_id],
    references: [permissionRole.permission_role_id],
  }),
}));
