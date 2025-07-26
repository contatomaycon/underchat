import {
  pgTable,
  integer,
  timestamp,
  varchar,
  uuid,
} from 'drizzle-orm/pg-core';
import { serverStatus, serverSsh, worker } from '@core/models';
import { relations } from 'drizzle-orm';

export const server = pgTable('server', {
  server_id: uuid().primaryKey().notNull(),
  server_status_id: uuid()
    .references(() => serverStatus.server_status_id)
    .notNull(),
  name: varchar({ length: 200 }).notNull(),
  quantity_workers: integer().notNull(),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  deleted_at: timestamp('deleted_at', { mode: 'string', withTimezone: true }),
});

export const serverRelations = relations(server, ({ one, many }) => ({
  ssv: one(serverStatus, {
    fields: [server.server_status_id],
    references: [serverStatus.server_status_id],
  }),
  sss: one(serverSsh, {
    fields: [server.server_id],
    references: [serverSsh.server_id],
  }),
  swk: many(worker),
}));
