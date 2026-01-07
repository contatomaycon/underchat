import {
  pgTable,
  timestamp,
  integer,
  varchar,
  uuid,
  index,
} from 'drizzle-orm/pg-core';
import { server } from '@core/models';
import { relations } from 'drizzle-orm';

export const serverSsh = pgTable(
  'server_ssh',
  {
    server_ssh_id: uuid().primaryKey().notNull(),
    server_id: uuid()
      .references(() => server.server_id)
      .notNull(),
    ssh_ip: varchar({ length: 200 }).notNull(),
    ssh_port: integer().notNull(),
    ssh_username: varchar({ length: 1000 }).notNull(),
    ssh_password: varchar({ length: 1000 }).notNull(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    deleted_at: timestamp('deleted_at', { mode: 'string', withTimezone: true }),
  },
  (table) => [
    index('server_ssh_server_id_idx').on(table.server_id),
    index('server_ssh_deleted_at_idx').on(table.deleted_at),
  ]
);

export const serverSshRelations = relations(serverSsh, ({ one }) => ({
  ser: one(server, {
    fields: [serverSsh.server_id],
    references: [server.server_id],
  }),
}));
