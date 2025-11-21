import {
  pgTable,
  timestamp,
  integer,
  varchar,
  uuid,
} from 'drizzle-orm/pg-core';
import { server } from '@core/models';
import { relations } from 'drizzle-orm';

export const serverWeb = pgTable('server_web', {
  server_web_id: uuid().primaryKey().notNull(),
  server_id: uuid()
    .references(() => server.server_id)
    .notNull(),
  web_domain: varchar({ length: 200 }).notNull(),
  web_port: integer().notNull(),
  web_protocol: varchar({ length: 10 }).notNull(),
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

export const serverWebRelations = relations(serverWeb, ({ one }) => ({
  server: one(server, {
    fields: [serverWeb.server_id],
    references: [server.server_id],
  }),
}));
