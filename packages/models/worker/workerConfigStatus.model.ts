import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workerConfig } from '@core/models';
import { EWorkerConfigStatus } from '@core/common/enums/EWorkerConfigStatus';

export const workerConfigStatus = pgTable(
  'worker_config_status',
  {
    worker_config_status_id: uuid().primaryKey().notNull(),
    status: varchar({ length: 500 }).$type<EWorkerConfigStatus>(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('worker_config_status_status_idx').on(table.status)]
);

export const workerConfigStatusRelations = relations(
  workerConfigStatus,
  ({ many }) => ({
    wcs: many(workerConfig),
  })
);
