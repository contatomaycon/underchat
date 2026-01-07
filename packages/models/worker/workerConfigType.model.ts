import { pgTable, timestamp, uuid, varchar, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { workerConfig } from '@core/models';
import { EWorkerConfigType } from '@core/common/enums/EWorkerConfigType';

export const workerConfigType = pgTable(
  'worker_config_type',
  {
    worker_config_type_id: uuid().primaryKey().notNull(),
    type: varchar({ length: 500 }).$type<EWorkerConfigType>(),
    created_at: timestamp('created_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
    updated_at: timestamp('updated_at', {
      mode: 'string',
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [index('worker_config_type_type_idx').on(table.type)]
);

export const workerConfigTypeRelations = relations(
  workerConfigType,
  ({ many }) => ({
    wct: many(workerConfig),
  })
);
