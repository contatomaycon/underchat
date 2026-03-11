import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { EServerBuildType } from '@core/common/enums/EServerBuildType';
import { EServerBuildJobItemStatus } from '@core/common/enums/EServerBuildJobItemStatus';
import { relations } from 'drizzle-orm';
import { serverBuildJob } from './serverBuildJob.model';

export const serverBuildJobItem = pgTable(
  'server_build_job_item',
  {
    server_build_job_item_id: uuid().primaryKey().notNull(),
    server_build_job_id: uuid()
      .references(() => serverBuildJob.server_build_job_id)
      .notNull(),
    build_type: varchar('build_type', { length: 50 })
      .$type<EServerBuildType>()
      .notNull(),
    status: varchar({ length: 50 })
      .$type<EServerBuildJobItemStatus>()
      .notNull(),
    image_reference: varchar({ length: 1000 }),
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
    uniqueIndex('server_build_job_item_job_id_build_type_uq').on(
      table.server_build_job_id,
      table.build_type
    ),
    index('server_build_job_item_job_id_idx').on(table.server_build_job_id),
    index('server_build_job_item_status_idx').on(table.status),
  ]
);

export const serverBuildJobItemRelations = relations(
  serverBuildJobItem,
  ({ one }) => ({
    job: one(serverBuildJob, {
      fields: [serverBuildJobItem.server_build_job_id],
      references: [serverBuildJob.server_build_job_id],
    }),
  })
);
