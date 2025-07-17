import { pgTable, timestamp, smallint, varchar } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { server } from '@core/models';

export const serverStatus = pgTable('server_status', {
  server_status_id: smallint()
    .primaryKey()
    .generatedByDefaultAsIdentity()
    .notNull(),
  status: varchar({ length: 500 }),
  created_at: timestamp('created_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
  updated_at: timestamp('updated_at', {
    mode: 'string',
    withTimezone: true,
  }).defaultNow(),
});

export const serverStatusRelations = relations(serverStatus, ({ many }) => ({
  server: many(server),
}));
