import {
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { EServerBuildJobStatus } from '@core/common/enums/EServerBuildJobStatus';
import { relations } from 'drizzle-orm';
import { user } from '@core/models';
import { serverBuildJobItem } from './serverBuildJobItem.model';

export const serverBuildJob = pgTable(
  'server_build_job',
  {
    server_build_job_id: uuid().primaryKey().notNull(),
    requested_by: uuid('requested_by').references(() => user.user_id),
    version: varchar({ length: 120 }).notNull(),
    status: varchar({ length: 50 }).$type<EServerBuildJobStatus>().notNull(),
    error_message: text('error_message'),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    started_at: timestamp('started_at', {
      mode: 'string',
      withTimezone: true,
    }),
    finished_at: timestamp('finished_at', {
      mode: 'string',
      withTimezone: true,
    }),
  },
  (table) => [
    index('server_build_job_status_idx').on(table.status),
    index('server_build_job_created_at_idx').on(table.created_at),
    index('server_build_job_requested_by_idx').on(table.requested_by),
  ]
);

export const serverBuildJobRelations = relations(
  serverBuildJob,
  ({ many }) => ({
    items: many(serverBuildJobItem),
  })
);
